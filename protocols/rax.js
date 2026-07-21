const net = require("net");
const fs = require("fs");
const path = require("path");
const pool = require("../config/database");
const { panelConfigCache } = require("../config/routing");
const decoders = require("../decoders");
const decodeSIA = decoders.rax;

// -------------------------------------------------
// 📂 RAX CONFIGURATION MANAGER
// -------------------------------------------------
const configPath = path.join(__dirname, 'rax_config.json');
let raxConfig = {};

try {
  if (fs.existsSync(configPath) && fs.statSync(configPath).size > 0) {
    raxConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    console.log(`✅ Loaded RAX device configuration for ${Object.keys(raxConfig).length} devices.`);
  } else {
    raxConfig = {};
    fs.writeFileSync(configPath, JSON.stringify({}, null, 2));
  }
} catch (err) {
  raxConfig = {};
  fs.writeFileSync(configPath, JSON.stringify({}, null, 2));
}

async function getOrRegisterRAX(account, macId = null) {
  if (raxConfig[account] && !macId) return raxConfig[account];
  if (macId) {
    raxConfig[account] = { mac_id: macId, type: 'rax' };
    fs.writeFileSync(configPath, JSON.stringify(raxConfig, null, 2));
    return raxConfig[account];
  }
  return null;
}

const TCP_PORT = 5501;
const activeSockets = new Map();
const eventLog = [];
const MAX_LOG = 100;
const commandQueue = new Map();
const connectWaiters = new Map();

function buildRaxCommand(commandType, account, mac, zone = "000") {
  const cmd = commandType.toUpperCase();

  // Output control (Relay commands) -> SSTART ... ENDD
  const outputCommands = {
    'EML_OFF': 'OUTPUT010', 'EML_ON': 'OUTPUT011',
    'AC1_OFF': 'OUTPUT020', 'AC1_ON': 'OUTPUT021', 'AC1': 'OUTPUT021',
    'AC2_OFF': 'OUTPUT030', 'AC2_ON': 'OUTPUT031', 'AC2': 'OUTPUT031',
    'LIGHT1_OFF': 'OUTPUT040', 'LIGHT_OFF': 'OUTPUT040',
    'LIGHT1_ON': 'OUTPUT041', 'LIGHT_ON': 'OUTPUT041',
    'LIGHT2_OFF': 'OUTPUT050', 'LIGHT2_ON': 'OUTPUT051',
    'HOOTER': 'OUTPUT008', 'SIREN_ON': 'OUTPUT008',
    'ROUTER_RESET': 'OUTPUT108',
    'DVR_RESET': 'OUTPUT098',
    'SMOKE_RESET': 'OUTPUT118'
  };

  if (outputCommands[cmd]) {
    return `SSTARTACC${account}MAC${mac}${outputCommands[cmd]}ENDD`;
  }

  // Panel Restart -> START ... RESETEND
  if (cmd === 'RESTART' || cmd === 'PANEL_RESTART') {
    return `STARTACC${account}MAC${mac}RESETEND`;
  }

  // Read Port Status -> START ... RPSENDD
  if (cmd === 'READ_PORT_STATUS') {
    return `STARTACC${account}MAC${mac}RPSENDD`;
  }

  // Read Channel Status -> START ... RCSEND
  if (cmd === 'READ_CHANNEL_STATUS') {
    return `STARTACC${account}MAC${mac}RCSEND`;
  }

  // Read Panel ID -> START ... RRLAEND
  if (cmd === 'READ_PANEL_ID') {
    return `STARTACC${account}MAC${mac}RRLAEND`;
  }

  return null;
}

function sendCommandToPanel(socket, commandType, accountNo, zone = "000") {
  if (socket.destroyed) return false;

  const meta = raxConfig[accountNo];
  const mac = meta ? meta.mac_id : "068183208169074154";
  // const mac = meta ? meta.mac_id : "000000000000000000";

  const cmd = buildRaxCommand(commandType, accountNo, mac, zone);
  if (!cmd) return false;

  socket.write(cmd);
  console.log(`\n📤 [RAX] Command Sent [${commandType}]:`);
  console.log(`   Raw Format: ${cmd}`);
  return true;
}

function handleSocketEvents(socket, remoteIp, initialAccount = null) {
  let currentAccount = initialAccount;
  socket.setKeepAlive(true, 30000);
  socket.setTimeout(180000); // Set timeout like RASS

  socket.on("timeout", () => socket.destroy());
  socket.on("data", async (data) => {
    const message = data.toString().trim();
    if (!message) return;

    console.log(`\n📩 [RAX] Raw Data Received:`, message);

    const decoded = decodeSIA(message);

    console.log(`🔓 [RAX] Decoded Meaning:`);
    console.log(JSON.stringify(decoded, null, 2));

    if (decoded.account) {
      currentAccount = decoded.account;
      activeSockets.set(currentAccount, socket);

      if (decoded.macId) {
        getOrRegisterRAX(currentAccount, decoded.macId);
      }

      const waiters = connectWaiters.get(currentAccount);
      if (waiters && waiters.length > 0) {
        for (const resolve of waiters) resolve({ account: currentAccount });
        connectWaiters.set(currentAccount, []);
      }

      if (decoded.code && !decoded.isRaxPlaintext) {
        const alarmCode = decoded.code;
        const receivedtime = new Date().toISOString().slice(0, 19).replace('T', ' ');

        let priority = 'N', level = 0, targetTable = 'alerts';
        const configsArray = panelConfigCache.get('RAX') || panelConfigCache.get('MAYUR');

        if (configsArray) {
          let matchedConfig = null;
          for (const config of configsArray) {
            if (config.alarmCodeArr && config.alarmCodeArr.includes(alarmCode)) {
              matchedConfig = config;
              break;
            }
          }

          if (matchedConfig) {
            if (matchedConfig.destination === 'back') {
              targetTable = 'backalerts';
            } else if (matchedConfig.destination === 'front') {
              targetTable = 'alerts';
              if (matchedConfig.level1Arr && matchedConfig.level1Arr.includes(alarmCode)) { level = 1; priority = 'Y'; }
              else if (matchedConfig.level2Arr && matchedConfig.level2Arr.includes(alarmCode)) { level = 2; priority = 'Y'; }
              else if (matchedConfig.level3Arr && matchedConfig.level3Arr.includes(alarmCode)) { level = 3; priority = 'Y'; }
              else { level = 0; priority = matchedConfig.rowPriority || 'N'; }
            }
          }
        }

        const baseValues = [
          currentAccount, '0000', decoded.zone || '000', alarmCode,
          decoded.formattedDate || receivedtime, decoded.event || ''
        ];

        try {
          await pool.query(`INSERT INTO alerts_copy (panelid, seqno, zone, alarm, createtime, alerttype, status) VALUES (?, ?, ?, ?, ?, ?,'O')`, baseValues);
        } catch (err) {
          console.error("❌ DB Error (alerts_copy):", err.message);
        }

        try {
          await pool.query(`INSERT INTO ${targetTable} (panelid, seqno, zone, alarm, createtime, alerttype, status, priority, level) VALUES (?, ?, ?, ?, ?, ?, 'O', ?, ?)`, [...baseValues, priority, level]);
          console.log(`✅ [RAX] Data successfully saved to ${targetTable} (Alarm: ${alarmCode})`);
        } catch (err) {
          console.error(`❌ DB Error (${targetTable}):`, err.message);
        }
      }
    }

    eventLog.unshift({ ...decoded, raw: message, receivedAt: new Date().toISOString() });
    if (eventLog.length > MAX_LOG) eventLog.pop();

    if (!socket.destroyed) {
      let commandSentFromQueue = false;
      if (currentAccount) {
        const queue = commandQueue.get(currentAccount);
        if (queue && queue.length > 0) {
          const pending = [...queue];
          commandQueue.set(currentAccount, []);
          for (const item of pending) {
            const cmd = buildRaxCommand(item.command, currentAccount, raxConfig[currentAccount] ? raxConfig[currentAccount].mac_id : "000000000000000000", item.zone || '000');
            if (cmd) {
              socket.write(cmd);
              commandSentFromQueue = true;
              if (item.resolve) item.resolve({ sent: true, command: item.command, zone: item.zone || '000', sentAt: new Date().toISOString() });
            } else {
              if (item.resolve) item.resolve({ sent: false, command: item.command });
            }
          }
        }
      }
    }
  });

  socket.on("end", () => { if (currentAccount) activeSockets.delete(currentAccount); });
  socket.on("error", () => { });
  socket.on("close", () => { if (currentAccount) activeSockets.delete(currentAccount); });
}

function initiatePanelConnection(panelId, ip) {
  const OUTGOING_PORT = 5000;
  console.log(`\n⏳ [RAX] Attempting OUTGOING connection to Panel #${panelId} at IP: ${ip}:${OUTGOING_PORT}...`);
  const socket = new net.Socket();

  socket.connect(OUTGOING_PORT, ip, () => {
    console.log(`✅ [RAX] Successfully connected to Panel #${panelId} (${ip})`);
    activeSockets.set(panelId, socket);
    handleSocketEvents(socket, ip, panelId);
  });

  socket.on("error", (err) => {
    console.log(`❌ [RAX] Connection failed to Panel #${panelId} (${ip}): ${err.message}`);
  });

  socket.on("close", () => {
    console.log(`⚠️ [RAX] Connection closed for Panel #${panelId} (${ip}). Retrying in 3 minutes...`);
    setTimeout(() => {
      if (!activeSockets.has(panelId) || activeSockets.get(panelId).destroyed) {
        initiatePanelConnection(panelId, ip);
      }
    }, 180000); // 3 minutes
  });
}

async function connectToAllPanels() {
  try {
    const [rows] = await pool.query("SELECT NewPanelID, dvrip FROM sites WHERE Panel_Make IN ('RAX', 'REX') AND dvrip IS NOT NULL AND dvrip != '' LIMIT 15");
    if (rows && rows.length > 0) {
      console.log(`\n🔄 [RAX] Found ${rows.length} RAX panels with IPs in database. Initiating outgoing connections...`);
      for (const row of rows) {
        const panelId = String(row.NewPanelID).trim();
        const ip = String(row.dvrip).trim();
        if (!activeSockets.has(panelId)) initiatePanelConnection(panelId, ip);
      }
    } else {
      console.log(`\nℹ️ [RAX] No RAX panels found in database with valid IP for outgoing connection.`);
    }
  } catch (err) {
    console.error(`❌ [RAX] Error fetching panels from DB for outgoing connections:`, err.message);
  }
}

// ==========================================
// 1. TCP SERVER
// ==========================================
function startServer() {
  connectToAllPanels();
  setInterval(connectToAllPanels, 600000); // 10 minutes

  const tcpServer = net.createServer((socket) => {
    const remoteIp = socket.remoteAddress ? socket.remoteAddress.replace(/^.*:/, '').trim() : null;
    console.log(`\n📡 [RAX] Incoming TCP Connection Initiated from IP: ${remoteIp}`);
    handleSocketEvents(socket, remoteIp);
  });

  tcpServer.listen(TCP_PORT, () => {
    console.log(`🚀 RAX TCP Server listening for devices on port ${TCP_PORT}`);
  });
}

// ==========================================
// 2. API Handlers
// ==========================================
function checkConnection(account, maxWait = 60000) {
  return new Promise((resolve) => {
    const sock = activeSockets.get(account);
    if (sock && !sock.destroyed) {
      return resolve({ success: true, status: "online" });
    }
    if (!connectWaiters.has(account)) connectWaiters.set(account, []);
    let done = false;
    connectWaiters.get(account).push(() => {
      if (!done) { done = true; resolve({ success: true, status: "online" }); }
    });
    setTimeout(() => {
      if (!done) { done = true; resolve({ success: false, status: "timeout" }); }
    }, maxWait);
  });
}

function queueCommand(account, command, zone, maxWait = 60000) {
  return new Promise((resolve) => {
    const sock = activeSockets.get(account);
    const timeBefore = new Date().toISOString();
    if (sock && !sock.destroyed) {
      const success = sendCommandToPanel(sock, command, account, zone);
      setTimeout(() => {
        const newEvents = eventLog.filter(e => e.account === account && e.receivedAt > timeBefore);
        resolve({ success, status: "sent_immediately", panelResponse: newEvents, responseCount: newEvents.length });
      }, 3000);
    } else {
      if (!commandQueue.has(account)) commandQueue.set(account, []);
      let done = false;
      commandQueue.get(account).push({
        command, zone, queuedAt: timeBefore,
        resolve: (res) => {
          if (!done) {
            done = true;
            setTimeout(() => {
              const newEvents = eventLog.filter(e => e.account === account && e.receivedAt > (res.sentAt || timeBefore));
              resolve({ success: res.sent, status: "sent_from_queue", panelResponse: newEvents, responseCount: newEvents.length });
            }, 3000);
          }
        }
      });
      setTimeout(() => {
        if (!done) {
          done = true;
          resolve({ success: false, status: "timeout", message: "Panel did not connect" });
        }
      }, maxWait);
    }
  });
}

function getEvents(account, limit) {
  let events = account ? eventLog.filter(e => e.account === account) : eventLog;
  if (limit > 0) events = events.slice(0, limit);
  return { success: true, count: events.length, events };
}

function getStatus() {
  const devices = [];
  activeSockets.forEach((sock, acct) => { devices.push({ account: acct, connected: !sock.destroyed }); });
  return { success: true, devices };
}

module.exports = {
  startServer,
  checkConnection,
  queueCommand,
  getEvents,
  getStatus
};
