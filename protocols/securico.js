const net = require("net");
const pool = require("../config/database");
const { panelConfigCache } = require("../config/routing");
const decodeSIA = require("../decoders/securico_decoder");

const TCP_PORT = 5503;

const activeSockets = new Map();   // account -> socket
const eventLog = [];
const MAX_LOG = 100;
const commandQueue = new Map();    // account -> [{ command, zone, resolve, queuedAt }]
const connectWaiters = new Map();  // account -> [resolve]
const rpsBuffer = new Map();       // account -> { parts: [], rawMessages: [], timeout: timerId }
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
  const match = message.match(/"(SIA-DCS|ACK)"(\d{4})(R\w+)(L\w+)#(\w+)/);
  if (match) {
    const prefix = message.substring(0, match.index);
    let crc = "0000";
    let length = "0000";
    if (prefix.length >= 8) {
      crc = prefix.slice(-8, -4);
      length = prefix.slice(-4);
    } else if (prefix.length >= 4) {
      length = prefix.slice(-4);
    }
    return {
      crc,
      length,
      protocol: match[1],
      sequence: match[2],
      receiver: match[3],
      line: match[4],
      account: match[5],
      matchIndex: match.index
    };
  }
  return null;
}

function buildACK(header) {
  // SIA standard ACK format, without the timestamp extension
  const body = `"ACK"${header.sequence}${header.receiver}${header.line}#${header.account}[]`;
  const crc = calculateCRC16(body);
  const len = calculateLength(body);
  return `\n${crc}${len}${body}\r`;
}


const COMMAND_MAP = {
  // Common Panel Controls
  'ARM': 'DCS016|W|000|4',
  'DISARM': 'DCS016|W|000|5',
  'RESET': 'DCS015|W|0',
  'RESTART': 'DCS015|W|0',
  'PANEL_RESTART': 'DCS015|W|0',

  // Hooter/Siren (Relay 1 - External)
  'HOOTER': 'DCS007|W|001|3',
  'SIREN_ON': 'DCS007|W|{ZONE}|3', // {ZONE} logic handles fallback to 002 if 000 is passed
  'SIREN_OFF': 'DCS007|W|{ZONE}|2',

  // EML (Relay 3 - Auto Lock After 10 Sec)
  'EML_OPEN': 'DCS007|W|003|3',
  'EML_ON': 'DCS007|W|003|3',

  // Router Reset (Relay 4 - Auto Restore After 10 Sec)
  'ROUTER_RESET': 'DCS007|W|004|3',

  // GSM Two Way Reset (Relay 5 - Auto Restore After 10 Sec)
  'GSM_RESET': 'DCS007|W|005|3',

  // Fire Reset (Relay 6 - Auto Restore After 10 Sec)
  'FIRE_RESET': 'DCS007|W|006|3',
  'SMOKE_RESET': 'DCS007|W|006|3',

  // DVR Reset (Relay 7 - Auto Restore After 10 Sec)
  'DVR_RESET': 'DCS007|W|007|3',

  // Zone bypass / Un-bypass
  'BYPASS': 'DCS033|W|{ZONE}|0',
  'UNBYPASS': 'DCS033|W|{ZONE}|1',

  // Read Port Status (Zones)
  'READ_PORT_STATUS_1': 'DCS008|R|000', // Zones 1-20
  'READ_PORT_STATUS_2': 'DCS008|R|001', // Zones 21-40
  'READ_PORT_STATUS_3': 'DCS008|R|002', // Zones 41-47

  // Additional Status Commands
  'READ_RELAY_STATUS': 'DCS009|R|000',
  'READ_ARM_STATUS': 'DCS010|R|000',
  'READ_USER_STATUS': 'DCS010|R|000' // Alias
};

function buildSIACommand(commandType, account, zone = "000", receiver = "R000001", line = "L000000") {
  let commandPayload = COMMAND_MAP[commandType.toUpperCase()];
  if (!commandPayload) return null;

  if (commandPayload.includes('{ZONE}')) {
    let finalZone = String(zone).padStart(3, '0');
    // Default to Hooter-2 (002) if zone 000 is passed for SIREN commands
    if (commandType.toUpperCase().startsWith('SIREN') && finalZone === '000') {
      finalZone = '002';
    }
    commandPayload = commandPayload.replace('{ZONE}', finalZone);
  }

  const seq = String(outSequence++).padStart(4, '0');
  if (outSequence > 9999) outSequence = 1;
  const ts = getTimestamp();

  // Securico panels expect a 6-digit account number (e.g., #040205)
  const paddedAccount = String(account).padStart(6, '0');

  // Excel specifies L000001 and a space before bracket for BYPASS commands
  if (commandType.toUpperCase().includes('BYPASS')) {
    line = "L000001";
    var dataWithoutTs = `"SIA-DCS"${seq}${receiver}${line}#${paddedAccount} [#${paddedAccount}|${commandPayload}]`;
  } else {
    // Securico format: [#ACCOUNT|payload]
    var dataWithoutTs = `"SIA-DCS"${seq}${receiver}${line}#${paddedAccount}[#${paddedAccount}|${commandPayload}]`;
  }

  const dataWithTs = dataWithoutTs + '_' + ts;

  const crc = calculateCRC16(dataWithTs);
  const len = calculateLength(dataWithTs);
  const result = `\n${crc}${len}${dataWithTs}\r`;

  console.log(`\n🛠️  [CONSTRUCTED SECURICO SIA COMMAND] Type: ${commandType}, Account: ${paddedAccount}`);
  return result;
}

function sendCommandToPanel(socket, commandType, accountNo, zone = "000") {
  if (socket.destroyed) {
    console.log("❌ SECURICO Connection lost, cannot send command.");
    return false;
  }

  // Handle multi-part commands like READ_PORT_STATUS
  if (commandType.toUpperCase() === 'READ_PORT_STATUS') {
    const cmd1 = buildSIACommand('READ_PORT_STATUS_1', accountNo, zone);
    if (cmd1) socket.write(cmd1);

    console.log(`\n📤 [SECURICO] Command Sent [READ_PORT_STATUS_1] (Starting Sequence)`);
    return true;
  }

  const cmd = buildSIACommand(commandType, accountNo, zone);
  if (!cmd) {
    console.log(`⚠️ SECURICO Unknown Command: ${commandType}`);
    return false;
  }
  socket.write(cmd);
  console.log(`\n📤 [SECURICO] Command Sent [${commandType}]:`);
  console.log(`   Raw Format: ${cmd.replace(/\n/g, '\\n').replace(/\r/g, '\\r')}`);
  return true;
}

// ==========================================
// 1. TCP SERVER
// ==========================================
function handleSocketEvents(socket, remoteIp, initialAccount = null) {
  let currentAccount = initialAccount;
  socket.setKeepAlive(true, 30000);
  socket.setTimeout(60000); // 1 minute timeout

  socket.on("timeout", () => socket.destroy());
  socket.on("data", async (data) => {
    const message = data.toString().trim();
    if (!message) return;

    console.log(`\n📩 [SECURICO] Raw Data Received: ${message}`);

    const header = parseSIAHeader(message);
    const decoded = decodeSIA(message);

    console.log(`🔓 [SECURICO] Decoded Meaning:`);
    console.log(JSON.stringify(decoded, null, 2));

    if (header && !decoded.account) {
      decoded.account = header.account;
    }

    let crcOK = false, lenOK = false;
    if (header) {
      const dataBody = message.substring(header.matchIndex);
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
    }

    // --- SEND ACK OR PENDING COMMANDS IMMEDIATELY ---
    if (header && !socket.destroyed) {
      let commandSentFromQueue = false;
      if (currentAccount) {
        const queue = commandQueue.get(currentAccount);
        if (queue && queue.length > 0) {
          const pending = [...queue];
          commandQueue.set(currentAccount, []);
          for (const item of pending) {
            const success = sendCommandToPanel(socket, item.command, currentAccount, item.zone || '000');
            if (success) {
              commandSentFromQueue = true;
              if (item.resolve) item.resolve({ sent: true, command: item.command, zone: item.zone || '000', sentAt: new Date().toISOString() });
            } else {
              if (item.resolve) item.resolve({ sent: false, command: item.command });
            }
          }
        }
      }
      if (!commandSentFromQueue && !message.includes('"ACK"')) {
        const ackMsg = buildACK(header);
        if (ackMsg) {
          socket.write(ackMsg);
          console.log(`📤 [SECURICO] ACK Sent: ${ackMsg.trim()}`);
        }
      }
    }
    // ------------------------------------------------

    if (decoded.code === "RPS_RES" && decoded.zonesList) {
      if (decoded.event && decoded.event.startsWith("Zone Status Response Part")) {
        if (!rpsBuffer.has(currentAccount)) {
          rpsBuffer.set(currentAccount, {
            parts: [],
            rawMessages: [],
            timeout: setTimeout(() => {
              const buffer = rpsBuffer.get(currentAccount);
              if (buffer) {
                mergeAndPushRPS(currentAccount, buffer, crcOK, remoteIp);
                rpsBuffer.delete(currentAccount);
              }
            }, 15000)
          });
        }
        const buffer = rpsBuffer.get(currentAccount);
        buffer.parts.push(decoded);
        buffer.rawMessages.push(message);

        // Sequential triggering of the next parts via Queue with delay (handles panels that disconnect after replying)
        if (decoded.event.includes("Part 0")) {
          setTimeout(() => {
            console.log(`\n🔄 [SECURICO] Queuing READ_PORT_STATUS_2 for Panel #${currentAccount}...`);
            if (!socket.destroyed) socket.destroy(); // Force new connection for panels that hang
            queueCommand(currentAccount, 'READ_PORT_STATUS_2', "000");
          }, 500);
        } else if (decoded.event.includes("Part 1")) {
          setTimeout(() => {
            console.log(`\n🔄 [SECURICO] Queuing READ_PORT_STATUS_3 for Panel #${currentAccount}...`);
            if (!socket.destroyed) socket.destroy(); // Force new connection for panels that hang
            queueCommand(currentAccount, 'READ_PORT_STATUS_3', "000");
          }, 500);
        }

        if (buffer.parts.length >= 3) {
          clearTimeout(buffer.timeout);
          mergeAndPushRPS(currentAccount, buffer, crcOK, remoteIp);
          rpsBuffer.delete(currentAccount);
        }
        return; // Skip normal pushing to eventLog for parts
      } else {
        // Full 47 char response
        await processRpsDb(decoded, currentAccount, remoteIp);
      }
    } else if (decoded.code === "RLS_RES" && decoded.relayList) {
      try {
        const receivedtime = new Date().toISOString().slice(0, 19).replace('T', ' ');

        let panelName = '';
        let siteId = 0;
        try {
          const [siteRows] = await pool.query("SELECT SN, Panel_Make FROM sites WHERE NewPanelID = ? LIMIT 1", [currentAccount]);
          if (siteRows && siteRows.length > 0) {
            panelName = siteRows[0].Panel_Make || '';
            siteId = siteRows[0].SN || 0;
          }
        } catch (err) { /* ignore */ }

        let columns = ['panelid', 'udate', 'ip'];
        let placeholders = ['?', '?', '?'];
        let values = [currentAccount, receivedtime, remoteIp || ''];
        let setQueryArr = ['udate = ?', 'ip = ?'];
        let setValues = [receivedtime, remoteIp || ''];

        if (panelName) {
          columns.push('panelName');
          placeholders.push('?');
          values.push(panelName);
          setQueryArr.push('panelName = ?');
          setValues.push(panelName);
        }

        decoded.relayList.forEach(r => {
          if (r.relayId >= 1 && r.relayId <= 20) {
            const colName = `relay${r.relayId}`;
            columns.push(colName);
            placeholders.push('?');
            values.push(r.status);
            setQueryArr.push(`${colName} = ?`);
            setValues.push(r.status);
          }
        });

        const [rows] = await pool.query("SELECT id FROM panel_health WHERE panelid = ? LIMIT 1", [currentAccount]);
        if (rows && rows.length > 0) {
          const updateQuery = `UPDATE panel_health SET ${setQueryArr.join(', ')} WHERE panelid = ?`;
          await pool.query(updateQuery, [...setValues, currentAccount]);
          console.log(`✅ [SECURICO] Relay status (with IP/Name) UPDATED in panel_health for Panel #${currentAccount}`);
        } else {
          const insertQuery = `INSERT INTO panel_health (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`;
          console.log(`[DEBUG] Query:`, insertQuery);
          console.log(`[DEBUG] Values length:`, values.length, values);
          await pool.query(insertQuery, values);
          console.log(`✅ [SECURICO] Relay status (with IP/Name) INSERTED into panel_health for Panel #${currentAccount}`);
        }
      } catch (dbErr) {
        console.error(`❌ [SECURICO] DB Error saving relay status to panel_health:`, dbErr.message);
      }
    } else if (decoded.code) {
      const seqno = header ? header.sequence : '0000';
      const alarmCode = decoded.code;
      const receivedtime = new Date().toISOString().slice(0, 19).replace('T', ' ');

      let priority = 'N', level = 0, targetTable = 'alerts';
      const configsArray = panelConfigCache.get('SECURICO');

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
      } catch (err) { }

      try {
        await pool.query(`INSERT INTO ${targetTable} (panelid, seqno, zone, alarm, createtime, alerttype, status, priority, level) VALUES (?, ?, ?, ?, ?, ?, 'O', ?, ?)`, [...baseValues, priority, level]);
        console.log(`✅ [SECURICO] Data successfully saved to ${targetTable} (Alarm: ${alarmCode})`);
      } catch (err) {
        console.error(`❌ DB Error (${targetTable}):`, err.message);
      }
    }

    eventLog.unshift({
      ...decoded,
      raw: message,
      crcValid: crcOK,
      receivedAt: new Date().toISOString()
    });
    if (eventLog.length > MAX_LOG) eventLog.pop();
  });

  socket.on("end", () => { if (currentAccount) activeSockets.delete(currentAccount); });
  socket.on("error", () => { });
  socket.on("close", () => { if (currentAccount) activeSockets.delete(currentAccount); });
}

async function processRpsDb(decoded, currentAccount, remoteIp) {
  try {
    const receivedtime = new Date().toISOString().slice(0, 19).replace('T', ' ');

    let panelName = '';
    let siteId = 0;
    try {
      const [siteRows] = await pool.query("SELECT SN, Panel_Make FROM sites WHERE NewPanelID = ? LIMIT 1", [currentAccount]);
      if (siteRows && siteRows.length > 0) {
        panelName = siteRows[0].Panel_Make || '';
        siteId = siteRows[0].SN || 0;
      }
    } catch (err) { /* ignore */ }

    let columns = ['panelid', 'udate', 'ip'];
    let placeholders = ['?', '?', '?'];
    let values = [currentAccount, receivedtime, remoteIp || ''];
    let setQueryArr = ['udate = ?', 'ip = ?'];
    let setValues = [receivedtime, remoteIp || ''];

    if (panelName) {
      columns.push('panelName');
      placeholders.push('?');
      values.push(panelName);
      setQueryArr.push('panelName = ?');
      setValues.push(panelName);
    }

    decoded.zonesList.forEach(z => {
      if (z.zone >= 1 && z.zone <= 60) {
        const colName = `zon${z.zone}`;
        const finalStatus = z.statusDescription || z.status;
        columns.push(colName);
        placeholders.push('?');
        values.push(finalStatus);
        setQueryArr.push(`${colName} = ?`);
        setValues.push(finalStatus);
      }
    });

    const [rows] = await pool.query("SELECT id FROM panel_health WHERE panelid = ? LIMIT 1", [currentAccount]);
    if (rows && rows.length > 0) {
      const updateQuery = `UPDATE panel_health SET ${setQueryArr.join(', ')} WHERE panelid = ?`;
      await pool.query(updateQuery, [...setValues, currentAccount]);
      console.log(`✅ [SECURICO] Zone status (with IP/Name) UPDATED in panel_health for Panel #${currentAccount}`);
    } else {
        const insertQuery = `INSERT INTO panel_health (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`;
        console.log(`[DEBUG] Query:`, insertQuery);
        console.log(`[DEBUG] Values length:`, values.length, values);
        await pool.query(insertQuery, values);
        console.log(`✅ [SECURICO] Zone status (with IP/Name) INSERTED into panel_health for Panel #${currentAccount}`);
    }
  } catch (dbErr) {
    console.error(`❌ [SECURICO] DB Error saving zone status to panel_health:`, dbErr.message);
  }
}

async function mergeAndPushRPS(account, buffer, crcOK, remoteIp) {
  let allZones = [];
  buffer.parts.forEach(p => {
    allZones = allZones.concat(p.zonesList || []);
  });
  // Sort zones to ensure correct ordering (1 to 47)
  allZones.sort((a, b) => a.zone - b.zone);

  const merged = { ...buffer.parts[0] };
  merged.event = "Zone Status Response";
  merged.zonesList = allZones;
  merged.raw = buffer.rawMessages.join(" || ");

  // Push to eventLog
  eventLog.unshift({
    ...merged,
    crcValid: crcOK,
    receivedAt: new Date().toISOString()
  });
  if (eventLog.length > MAX_LOG) eventLog.pop();

  // Process DB update
  await processRpsDb(merged, account, remoteIp);
  console.log(`✅ [SECURICO] Buffered RPS merged and logged for Panel #${account} with ${allZones.length} zones.`);
}

function initiatePanelConnection(panelId, ip) {
  const OUTGOING_PORT = 5000;
  console.log(`\n⏳ [SECURICO] Attempting OUTGOING connection to Panel #${panelId} at IP: ${ip}:${OUTGOING_PORT}...`);
  const socket = new net.Socket();

  socket.connect(OUTGOING_PORT, ip, () => {
    console.log(`✅ [SECURICO] Successfully connected to Panel #${panelId} (${ip})`);
    activeSockets.set(panelId, socket);
    handleSocketEvents(socket, ip, panelId);

    // Check and process pending commands with a short delay to allow panel readiness
    setTimeout(() => {
      if (socket.destroyed) return;
      const queue = commandQueue.get(panelId);
      if (queue && queue.length > 0) {
        const pending = [...queue];
        commandQueue.set(panelId, []);
        for (const item of pending) {
          const success = sendCommandToPanel(socket, item.command, panelId, item.zone || '000');
          if (item.resolve) {
            item.resolve({ sent: success, command: item.command, zone: item.zone || '000', sentAt: new Date().toISOString() });
          }
        }
      }
    }, 1500); // 1.5 second delay
  });

  socket.on("error", (err) => {
    console.log(`❌ [SECURICO] Connection failed to Panel #${panelId} (${ip}): ${err.message}`);
  });

  socket.on("close", () => {
    console.log(`⚠️ [SECURICO] Connection closed for Panel #${panelId} (${ip}). Retrying in 1 minute...`);
    setTimeout(() => {
      if (!activeSockets.has(panelId) || activeSockets.get(panelId).destroyed) {
        initiatePanelConnection(panelId, ip);
      }
    }, 60000); // 1 minute
  });
}

async function connectToAllPanels() {
  try {
    const [rows] = await pool.query("SELECT NewPanelID, dvrip FROM sites WHERE Panel_Make LIKE '%securico%' AND dvrip IS NOT NULL AND dvrip != '' ");
    if (rows && rows.length > 0) {
      console.log(`\n🔄 [SECURICO] Found ${rows.length} panels with IPs in database. Initiating outgoing connections...`);
      for (const row of rows) {
        const panelId = String(row.NewPanelID).trim();
        const ip = String(row.dvrip).trim();
        if (!activeSockets.has(panelId)) initiatePanelConnection(panelId, ip);
      }
    } else {
      console.log(`\nℹ️ [SECURICO] No securico panels found in database with valid IP for outgoing connection.`);
    }
  } catch (err) {
    console.error(`❌ [SECURICO] Error fetching panels from DB for outgoing connections:`, err.message);
  }
}

function startServer() {
  // connectToAllPanels();
  // setInterval(connectToAllPanels, 180000); // 3 minutes

  const tcpServer = net.createServer((socket) => {
    const remoteIp = socket.remoteAddress ? socket.remoteAddress.replace(/^.*:/, '').trim() : null;
    console.log(`\n📡 [SECURICO] Device TCP Connection Initiated from IP: ${remoteIp}`);
    handleSocketEvents(socket, remoteIp);
  });

  tcpServer.listen(TCP_PORT, () => {
    console.log(`🚀 SECURICO TCP Server listening for devices on port ${TCP_PORT}`);
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
      // Wait 5000ms to allow multi-part commands like READ_PORT_STATUS to complete
      setTimeout(() => {
        const newEvents = eventLog.filter(e => e.account === account && e.receivedAt > timeBefore);
        resolve({ success, status: "sent_immediately", panelResponse: newEvents, responseCount: newEvents.length });
      }, 5000);
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
            }, 5000);
          }
        }
      });

      // Attempt on-demand connection if not already connected
      pool.query("SELECT dvrip FROM sites WHERE NewPanelID = ? AND dvrip IS NOT NULL AND dvrip != '' LIMIT 1", [account])
        .then(([rows]) => {
          if (rows && rows.length > 0) {
            const ip = String(rows[0].dvrip).trim();
            console.log(`\n🔄 [SECURICO] On-Demand connection triggered for Panel #${account} (IP: ${ip})`);
            initiatePanelConnection(account, ip);
          } else {
            console.log(`\n⚠️ [SECURICO] Cannot connect on-demand to Panel #${account}: No valid IP found in DB.`);
          }
        })
        .catch(err => console.error(`\n❌ [SECURICO] DB Error while fetching IP for on-demand connection:`, err.message));

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
