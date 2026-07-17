const http = require("http");
const { URL } = require("url");
const pool = require("./config/database");

// Import protocol handlers
const mayurProtocol = require("./protocols/mayur");
const rassProtocol = require("./protocols/rass");
const smartiProtocol = require("./protocols/smarti");

const fs = require("fs");
const path = require("path");

// Load server configuration for enabling/disabling protocols
let serverConfig = { RUN_MAYUR: true, RUN_RASS: true, RUN_SMARTI: true };
const configPath = path.join(__dirname, 'server_config.json');

try {
  if (fs.existsSync(configPath)) {
    serverConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } else {
    fs.writeFileSync(configPath, JSON.stringify(serverConfig, null, 2));
  }
} catch (err) {
  console.log("⚠️ Could not load server_config.json, running both by default.");
}

// Start TCP Servers and dialers
console.log("\n=================================");
console.log("Starting Protocol Managers...");
console.log("=================================");

if (serverConfig.RUN_MAYUR) {
  console.log("✅ Starting MAYUR Protocol");
  mayurProtocol.startServer();
} else {
  console.log("⏸️ MAYUR Protocol is DISABLED (Check server_config.json)");
}

if (serverConfig.RUN_RASS) {
  console.log("✅ Starting RASS Protocol");
  rassProtocol.startServer();
} else {
  console.log("⏸️ RASS Protocol is DISABLED (Check server_config.json)");
}

if (serverConfig.RUN_SMARTI) {
  console.log("✅ Starting SMARTI Protocol");
  smartiProtocol.startServer();
} else {
  console.log("⏸️ SMARTI Protocol is DISABLED (Check server_config.json)");
}

// ============================================================================
// 🌐 UNIVERSAL HTTP API SERVER
// ============================================================================
const API_PORT = 3500;

const apiServer = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  // Unified routing helper
  const handleRequest = async (account, action) => {
    if (!account) {
      res.writeHead(400);
      return res.end(JSON.stringify({ error: "Missing 'account' parameter." }));
    }

    try {
      let panelMake = null;
      let handler = null;

      // COMMENTED OUT FOR TESTING: sirif safe_smart_sites table use karna hai
      /*
      let [rows] = await pool.query(
        "SELECT Panel_Make FROM sites_zicom WHERE NewPanelID = ? LIMIT 1",
        [account]
      );
      */

      // Sirf safe_smart_sites se fetch kar rahe hain for now
      let [rows] = await pool.query(
        "SELECT Panel_Make FROM safe_smart_sites WHERE NewPanelID = ? LIMIT 1",
        [account]
      );

      if (rows.length > 0) {
        panelMake = (rows[0].Panel_Make || "").toString().trim().toUpperCase();
      } else {
        // Fallback: Check if panel is actively connected OR has recently sent events
        const mayurDevices = mayurProtocol.getStatus().devices;
        const rassDevices = rassProtocol.getStatus().devices;
        const smartiDevices = smartiProtocol.getStatus().devices;

        if (mayurDevices.find(d => d.account === account && d.connected) || mayurProtocol.getEvents(account, 1).count > 0) {
          panelMake = 'MAYUR';
        } else if (rassDevices.find(d => d.account === account && d.connected) || rassProtocol.getEvents(account, 1).count > 0) {
          panelMake = 'RASS';
        } else if (smartiDevices.find(d => d.account === account && d.connected) || smartiProtocol.getEvents(account, 1).count > 0) {
          panelMake = 'SMARTI';
        }
      }

      if (!panelMake) {
        res.writeHead(404);
        return res.end(JSON.stringify({ error: `Panel ID ${account} not found in database and is not actively connected.` }));
      }

      if (panelMake === 'MAYUR') handler = mayurProtocol;
      else if (panelMake === 'RASS') handler = rassProtocol;
      else if (panelMake.includes('SMART') || panelMake.includes('SMAERT')) handler = smartiProtocol;

      if (!handler) {
        res.writeHead(400);
        return res.end(JSON.stringify({ error: `Unsupported Panel Make: ${panelMake}` }));
      }

      await action(handler, panelMake);
    } catch (dbErr) {
      console.error("❌ Database query error:", dbErr.message);
      res.writeHead(500);
      res.end(JSON.stringify({ error: "Database error", details: dbErr.message }));
    }
  };

  // --- /api/check ---
  if (parsedUrl.pathname === '/api/check' && req.method === 'GET') {
    const account = parsedUrl.searchParams.get('account');
    await handleRequest(account, async (handler, make) => {
      const result = await handler.checkConnection(account, 100);
      res.writeHead(200);
      res.end(JSON.stringify({ ...result, panelMake: make }));
    });
  }

  // --- /api/connect ---
  else if (parsedUrl.pathname === '/api/connect' && req.method === 'GET') {
    const account = parsedUrl.searchParams.get('account');
    const wait = parseInt(parsedUrl.searchParams.get('wait') || '60') * 1000;
    await handleRequest(account, async (handler, make) => {
      const result = await handler.checkConnection(account, wait);
      res.writeHead(200);
      res.end(JSON.stringify({ ...result, panelMake: make }));
    });
  }

  // --- /api/command ---
  else if (parsedUrl.pathname === '/api/command' && req.method === 'GET') {
    const account = parsedUrl.searchParams.get('account');
    const command = parsedUrl.searchParams.get('command');
    const zone = parsedUrl.searchParams.get('zone') || '000';
    const wait = parseInt(parsedUrl.searchParams.get('wait') || '60') * 1000;

    if (!command) {
      res.writeHead(400);
      return res.end(JSON.stringify({ error: "Missing 'command' parameter." }));
    }

    await handleRequest(account, async (handler, make) => {
      console.log(`\n🌐 [API] Request routed to ${make} panel #${account} (Cmd: ${command}, Zone: ${zone})`);
      const result = await handler.queueCommand(account, command, zone, wait);
      res.writeHead(result.success ? 200 : (result.status === 'timeout' ? 200 : 500));
      res.end(JSON.stringify({ ...result, panelMake: make }));
    });
  }

  // --- /api/events ---
  else if (parsedUrl.pathname === '/api/events' && req.method === 'GET') {
    const account = parsedUrl.searchParams.get('account');
    const last = parseInt(parsedUrl.searchParams.get('last') || '0');

    if (account) {
      await handleRequest(account, async (handler, make) => {
        const result = handler.getEvents(account, last);
        res.writeHead(200);
        res.end(JSON.stringify({ ...result, panelMake: make }));
      });
    } else {
      // If no account specified, combine events from both
      const mayurEvts = mayurProtocol.getEvents(null, last).events;
      const rassEvts = rassProtocol.getEvents(null, last).events;
      const smartiEvts = smartiProtocol.getEvents(null, last).events;
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, count: mayurEvts.length + rassEvts.length + smartiEvts.length, mayurEvents: mayurEvts, rassEvents: rassEvts, smartiEvents: smartiEvts }));
    }
  }

  // --- /api/status ---
  else if (parsedUrl.pathname === '/api/status' && req.method === 'GET') {
    const mayurStatus = mayurProtocol.getStatus().devices;
    const rassStatus = rassProtocol.getStatus().devices;
    const smartiStatus = smartiProtocol.getStatus().devices;
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, mayur: mayurStatus, rass: rassStatus, smarti: smartiStatus }));
  }

  else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: "Route not found. Supported routes: /api/check, /api/connect, /api/command, /api/events, /api/status" }));
  }
});

apiServer.listen(API_PORT, () => {
  console.log(`\n🚀 Universal API Server running on port ${API_PORT}`);
  console.log(`🌐 Test URL: http://localhost:${API_PORT}/api/command?account=040037&command=ARM&zone=000`);
});
