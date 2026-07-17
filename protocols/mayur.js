const net = require("net");
const pool = require("../config/database");
const { panelConfigCache } = require("../config/routing");
const decoders = require("../decoders");
const decodeSIA = decoders.mayur;

const TCP_PORT = 9999;

const activeSockets = new Map();   // account -> socket
const eventLog = [];
const MAX_LOG = 100;
const commandQueue = new Map();    // account -> [{ command, zone, resolve, queuedAt }]
const connectWaiters = new Map();  // account -> [resolve]
let outSequence = 1;

// =================================================
// SIA DC-09 Protocol Helpers
// =================================================
function calculateCRC16(str) {
  let crc = 0x0000;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i);
    for (let j = 0; j < 8; j++) {
      if (crc & 0x0001) crc = (crc >> 1) ^ 0xA001;
      else crc >>= 1;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function calculateLength(str) {
  return str.length.toString(16).toUpperCase().padStart(4, '0');
}

function getTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())},${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${now.getFullYear()}`;
}

function parseSIAHeader(message) {
  const match = message.match(/^([0-9A-Fa-f]{4})([0-9A-Fa-f]{4})"(.*?)"(\d{4})(R\w+)(L\w+)#(\w+)/);
  if (match) {
    return {
      crc: match[1],
      length: match[2],
      protocol: match[3],
      sequence: match[4],
      receiver: match[5],
      line: match[6],
      account: match[7]
    };
  }
  return null;
}

function buildACK(header) {
  const body = `"ACK"${header.sequence}${header.receiver}${header.line}#${header.account}[]`;
  const crc = calculateCRC16(body);
  const len = calculateLength(body);
  return `\n${crc}${len}${body}\r`;
}

const COMMAND_MAP = {
  'ARM': 'CG',
  'DISARM': 'OG',
  'STAY': 'NL',
  'PERIARM': 'NL',
  'BYPASS': 'BB',
  'UNBYPASS': 'BU',
  'FORCE_ARM': 'CF',
  'CLOSE': 'CL',
  'OPEN': 'OP',
  'AC_FAIL': 'AT',
  'AC_RESTORE': 'AR',
  'SIREN_ON': 'YA',
  'SIREN_OFF': 'YH',
  'FIRE_ON': 'FA',
  'FIRE_OFF': 'FR',
  'LIGHT_ON': 'RC',
  'LIGHT_OFF': 'RO',
  'EML_ON': 'RC',
  'EML_OFF': 'RO',
  'ATM_ON': 'RC',
  'ATM_OFF': 'RO',
  'LC_ON': 'RC',
  'LC_OFF': 'RO',
  'RC': 'RC',
  'RO': 'RO',
  'MODULE_OFF': 'BZ',
};

if (decodeSIA.SIA_EVENTS) {
  for (const [code, desc] of Object.entries(decodeSIA.SIA_EVENTS)) {
    COMMAND_MAP[code.toUpperCase()] = code;
    const key = desc.toUpperCase()
      .replace(/[^A-Z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/(^_|_$)/g, '');
    if (key && !COMMAND_MAP[key]) {
      COMMAND_MAP[key] = code;
    }
  }
}

function buildSIACommand(commandType, account, zone = "000", receiver = "R0", line = "L0") {
  const siaCode = COMMAND_MAP[commandType.toUpperCase()];
  if (!siaCode) return null;

  const seq = String(outSequence++).padStart(4, '0');
  if (outSequence > 9999) outSequence = 1;
  const ts = getTimestamp();

  const dataWithoutTs = `"SIA-DCS"${seq}${receiver}${line}#${account}[#${account}|N${siaCode}${zone}]`;
  const dataWithTs = dataWithoutTs + '_' + ts;
  const crc = calculateCRC16(dataWithTs);
  const len = calculateLength(dataWithTs);
  const result = `\n${crc}${len}${dataWithTs}\r`;

  console.log(`\n🛠️  [CONSTRUCTED MAYUR SIA COMMAND] Type: ${commandType}, Account: ${account}`);
  return result;
}

function sendCommandToPanel(socket, commandType, accountNo, zone = "000") {
  if (socket.destroyed) {
    console.log("❌ MAYUR Connection lost, cannot send command.");
    return false;
  }
  const cmd = buildSIACommand(commandType, accountNo, zone);
  if (!cmd) {
    console.log(`⚠️ MAYUR Unknown Command: ${commandType}`);
    return false;
  }
  socket.write(cmd);
  console.log(`\n📤 [MAYUR] Command Sent [${commandType}]:`);
  console.log(`   Raw Format: ${cmd.replace(/\n/g, '\\n').replace(/\r/g, '\\r')}`);
  return true;
}

// ==========================================
// 1. TCP SERVER
// ==========================================
function startServer() {
  const tcpServer = net.createServer((socket) => {
    console.log("📡 MAYUR Device TCP Connection Initiated");
    let currentAccount = null;
    socket.setKeepAlive(true, 30000);
    socket.setTimeout(0);

    socket.on("data", async (data) => {
      const message = data.toString().trim();
      if (!message) return;

      console.log(`\n📩 [MAYUR] Raw Data Received:`, message);

      const header = parseSIAHeader(message);
      const decoded = decodeSIA(message);

      console.log(`🔓 [MAYUR] Decoded Meaning:`);
      console.log(JSON.stringify(decoded, null, 2));

      if (header && !decoded.account) {
        decoded.account = header.account;
      }

      let crcOK = false, lenOK = false;
      if (header) {
        const dataBody = message.substring(8);
        const calculatedCRC = calculateCRC16(dataBody);
        const calculatedLen = calculateLength(dataBody);
        crcOK = header.crc.toUpperCase() === calculatedCRC.toUpperCase();
        lenOK = header.length.toUpperCase() === calculatedLen.toUpperCase();
      }

      if (decoded.account) {
        currentAccount = decoded.account;
        activeSockets.set(currentAccount, socket);

        const waiters = connectWaiters.get(currentAccount);
        if (waiters && waiters.length > 0) {
          for (const resolve of waiters) resolve({ account: currentAccount });
          connectWaiters.set(currentAccount, []);
        }

        if (decoded.code) {
          const seqno = header ? header.sequence : '0000';
          const alarmCode = decoded.code;
          const receivedtime = new Date().toISOString().slice(0, 19).replace('T', ' ');

          let priority = 'N', level = 0, targetTable = 'alerts';
          const configsArray = panelConfigCache.get('MAYUR');

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
            console.log(`✅ [MAYUR] Data successfully saved to ${targetTable} (Alarm: ${alarmCode})`);
          } catch (err) {
            console.error(`❌ DB Error (${targetTable}):`, err.message);
          }
        }
      }

      eventLog.unshift({
        ...decoded,
        raw: message,
        crcValid: crcOK,
        receivedAt: new Date().toISOString()
      });
      if (eventLog.length > MAX_LOG) eventLog.pop();

      if (header && !socket.destroyed) {
        let commandSentFromQueue = false;
        if (currentAccount) {
          const queue = commandQueue.get(currentAccount);
          if (queue && queue.length > 0) {
            const pending = [...queue];
            commandQueue.set(currentAccount, []);
            for (const item of pending) {
              const cmd = buildSIACommand(item.command, currentAccount, item.zone || '000');
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
        if (!commandSentFromQueue) {
          socket.write(buildACK(header));
        }
      }
    });

    socket.on("end", () => { if (currentAccount) activeSockets.delete(currentAccount); });
    socket.on("error", () => { });
    socket.on("close", () => { if (currentAccount) activeSockets.delete(currentAccount); });
  });

  tcpServer.listen(TCP_PORT, () => {
    console.log(`🚀 MAYUR TCP Server listening for devices on port ${TCP_PORT}`);
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
