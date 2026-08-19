const http = require("http");
const pool = require("../config/database");
const { panelConfigCache } = require("../config/routing");
const decodeIntellitech = require("../decoders/intellitech_decoder");

const HTTP_PORT = 3001;

const activeDevices = new Map();   // account -> last seen timestamp
const eventLog = [];
const MAX_LOG = 100;

// Helper to get formatted date string
function getTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function startServer() {
  const server = http.createServer(async (req, res) => {
    // Only accept POST requests
    if (req.method === 'POST') {
      let body = '';

      req.on('data', chunk => {
        body += chunk.toString();
      });

      req.on('end', async () => {
        try {
          const payload = JSON.parse(body);

          if (!payload.deviceId || !payload.data) {
            res.writeHead(400);
            return res.end(JSON.stringify({ error: "Invalid payload format" }));
          }

          const currentAccount = payload.deviceId;
          const dataDate = payload.dataDate;

          // Update active devices
          activeDevices.set(currentAccount, Date.now());

          // Process status array if present
          if (payload.data.status && Array.isArray(payload.data.status)) {
            for (const item of payload.data.status) {
              const decoded = decodeIntellitech(item, currentAccount, dataDate);

              if (decoded.code !== "XX") {
                const alarmCode = decoded.code;
                const seqno = "0000"; // Webhook doesn't have a sequence number
                const receivedtime = getTimestamp();

                // Route mapping logic (similar to Mayur/RASS)
                let priority = 'N', level = 0, targetTable = 'alerts';
                const configsArray = panelConfigCache.get('INTELLITECH'); // Or use a generic if needed

                if (configsArray) {
                  let matchedConfig = null;
                  for (const config of configsArray) {
                    if (config.alarmCodeArr.includes(alarmCode)) {
                      matchedConfig = config;
                      break;
                    }
                  }

                  if (matchedConfig) {
                    if (matchedConfig.destination === 'back') {
                      targetTable = 'backalerts';
                    } else if (matchedConfig.destination === 'front') {
                      targetTable = 'alerts';
                      if (matchedConfig.level1Arr.includes(alarmCode)) { level = 1; priority = 'Y'; }
                      else if (matchedConfig.level2Arr.includes(alarmCode)) { level = 2; priority = 'Y'; }
                      else if (matchedConfig.level3Arr.includes(alarmCode)) { level = 3; priority = 'Y'; }
                      else { level = 0; priority = matchedConfig.rowPriority; }
                    }
                  }
                }

                const baseValues = [
                  currentAccount, seqno, decoded.zone || '000', alarmCode,
                  decoded.formattedDate || receivedtime, decoded.event || ''
                ];

                try {
                  await pool.query(`INSERT INTO alerts_copy (panelid, seqno, zone, alarm, createtime, alerttype, status) VALUES (?, ?, ?, ?, ?, ?,'O')`, baseValues);
                } catch (err) {
                  console.error("❌ DB Error (alerts_copy):", err.message);
                }

                try {
                  await pool.query(`INSERT INTO ${targetTable} (panelid, seqno, zone, alarm, createtime, alerttype, status, priority, level) VALUES (?, ?, ?, ?, ?, ?, 'O', ?, ?)`, [...baseValues, priority, level]);
                  console.log(`✅ [INTELLITECH] Data successfully saved to ${targetTable} (Alarm: ${alarmCode} Zone: ${decoded.zone})`);
                } catch (err) {
                  console.error(`❌ DB Error (${targetTable}):`, err.message);
                }

                // Add to event log
                eventLog.unshift({
                  ...decoded,
                  receivedAt: new Date().toISOString()
                });
                if (eventLog.length > MAX_LOG) eventLog.pop();
              }
            }
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: "Payload processed" }));

        } catch (err) {
          console.error("❌ Intellitech Webhook Parsing Error:", err.message);
          res.writeHead(500);
          res.end(JSON.stringify({ error: "Internal Server Error" }));
        }
      });
    } else {
      res.writeHead(404);
      res.end("Not Found");
    }
  });

  server.listen(HTTP_PORT, () => {
    console.log(`📡 INTELLITECH Protocol Webhook Server listening on port ${HTTP_PORT}`);
  });
}

// Support functions for universal server
function getEvents(account, lastIndex = 0) {
  let evts = account ? eventLog.filter(e => e.account === account) : eventLog;
  if (lastIndex > 0 && lastIndex < evts.length) {
    evts = evts.slice(0, lastIndex);
  }
  return { success: true, count: evts.length, events: evts };
}

function getStatus() {
  const devices = [];
  const now = Date.now();
  for (const [account, lastSeen] of activeDevices.entries()) {
    devices.push({
      account,
      connected: (now - lastSeen) < 120000, // consider disconnected if no ping for 2 mins
      lastSeen: new Date(lastSeen).toISOString()
    });
  }
  return { success: true, devices };
}

function checkConnection(account, waitMs) {
  return new Promise((resolve) => {
    if (activeDevices.has(account) && (Date.now() - activeDevices.get(account) < 120000)) {
      return resolve({ success: true, status: 'connected', account });
    }
    // Webhook can't actively ping, just return disconnected
    resolve({ success: false, status: 'disconnected', account });
  });
}

function queueCommand(account, command, zone, waitMs) {
  // Webhooks are usually one-way, pushing commands requires an MQTT client or sending HTTP requests to the panel's IP.
  return Promise.resolve({ success: false, status: 'error', message: 'Command queue not supported for Intellitech Webhook yet.' });
}

module.exports = {
  startServer,
  getEvents,
  getStatus,
  checkConnection,
  queueCommand
};
