const net = require("net");
const fs = require("fs");
const path = require("path");
const pool = require("../config/database");
const { panelConfigCache } = require("../config/routing");
const decoders = require("../decoders");
const decodeSIA = decoders.rass;

// -------------------------------------------------
// 📂 RASS CONFIGURATION MANAGER
// -------------------------------------------------
const configPath = path.join(process.cwd(), 'rass_config.json');
let rassConfig = {};

try {
  if (fs.existsSync(configPath) && fs.statSync(configPath).size > 0) {
    rassConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    console.log(`✅ Loaded RASS device configuration for ${Object.keys(rassConfig).length} devices.`);
  } else {
    rassConfig = {};
    fs.writeFileSync(configPath, JSON.stringify({}, null, 2));
  }
} catch (err) {
  rassConfig = {};
  fs.writeFileSync(configPath, JSON.stringify({}, null, 2));
}

async function getOrRegisterRASS(macId, remoteIp = null) {
  if (rassConfig[macId]) return rassConfig[macId];

  let panelId = null;
  const clientId = "000000";

  if (remoteIp) {
    try {
      const [rows] = await pool.query("SELECT NewPanelID FROM sites WHERE dvrip = ? LIMIT 1", [remoteIp]);
      if (rows && rows.length > 0 && rows[0].NewPanelID) {
        panelId = String(rows[0].NewPanelID).trim();
      }
    } catch (err) { }
  }

  if (!panelId) {
    let maxId = 13;
    Object.values(rassConfig).forEach(dev => {
      const pId = parseInt(dev.panel_id, 10);
      if (!isNaN(pId) && pId > maxId) maxId = pId;
    });
    panelId = String(maxId + 1).padStart(6, '0');
  }

  rassConfig[macId] = { client_id: clientId, panel_id: panelId, type: 'rass' };
  fs.writeFileSync(configPath, JSON.stringify(rassConfig, null, 2));
  return rassConfig[macId];
}

const TCP_PORT = 6550;
const activeSockets = new Map();
const panelMetadata = new Map();
const eventLog = [];
const MAX_LOG = 100;
const commandQueue = new Map();
const connectWaiters = new Map();
let outSequence = 1;

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
      crc: match[1], length: match[2], protocol: match[3],
      sequence: match[4], receiver: match[5], line: match[6], account: match[7]
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

function buildRASSRegistrationResponse(seq, macId, clientId, panelId, receiver = "R000001") {
  const ts = getTimestamp();
  const body = `"SIA-DCS"${seq}${receiver}L000000#000000[#000000|NYY002][N|${macId}|${clientId}|${panelId}]_${ts}`;
  const crc = calculateCRC16(body);
  const len = calculateLength(body);
  return `\n${crc}${len}${body}\r`;
}

function buildRASSControlCommand(seq, account, clientLine, commandContent, receiver = "R000001") {
  const ts = getTimestamp();
  const lineStr = clientLine.startsWith('L') ? clientLine : `L${clientLine}`;
  const acctStr = account.startsWith('#') ? account.substring(1) : account;

  let body;
  if (commandContent.startsWith('NYY') || commandContent.startsWith('NCL') || commandContent.startsWith('NOA')) {
    body = `"SIA-DCS"${seq}${receiver}${lineStr}#${acctStr}[#${acctStr}|${commandContent}]_${ts}`;
  } else {
    const nyyCode = commandContent.endsWith('R]') ? 'NYY004' : 'NYY005';
    body = `"SIA-DCS"${seq}${receiver}${lineStr}#${acctStr}[#${acctStr}|${nyyCode}]${commandContent}_${ts}`;
  }

  const crc = calculateCRC16(body);
  const len = calculateLength(body);
  return `\n${crc}${len}${body}\r`;
}

function getRASSCommandContent(commandName, zone = "000") {
  const cmd = commandName.toUpperCase();
  const zoneStr = String(zone).padStart(3, '0');

  if (cmd === 'NYY040' || cmd === 'GET_ZONE_STATUS_1_30' || cmd === 'READ_ZONE_STATUS_1_30' || cmd === 'READ_PORT_STATUS_1') return 'NYY040';
  if (cmd === 'NYY041' || cmd === 'GET_ZONE_STATUS_31_60' || cmd === 'READ_ZONE_STATUS_31_60' || cmd === 'READ_PORT_STATUS_2') return 'NYY041';
  if (cmd === 'READ_PORT_STATUS' || cmd === 'GET_ZONE_STATUS' || cmd === 'READ_ALL_ZONE_STATUS') {
    if (zone === '31_60' || zone === '2' || Number(zone) > 30) return 'NYY041';
    return 'NYY040';
  }

  if (cmd === 'ARM' || cmd === 'ARM_ALL') return '[N|004|A]';
  if (cmd === 'DISARM') return '[N|004|D]';
  if (cmd === 'STAY' || cmd === 'PERIARM') return '[N|004|P]';
  if (cmd === 'SIREN_ON') return '[N|002|1]';
  if (cmd === 'SIREN_OFF') return '[N|002|0]';
  if (cmd === 'SIREN_ENABLE') return '[N|002|2]';
  if (cmd === 'SIREN_DISABLE') return '[N|002|3]';
  if (cmd === 'BYPASS') return `[N|003|${zoneStr}|1]`;
  if (cmd === 'UNBYPASS') return `[N|003|${zoneStr}|0]`;
  if (cmd === 'RESET') return '[N|000]';
  if (cmd === 'PANEL_ENABLE') return '[N|004|E]';
  if (cmd === 'PANEL_DISABLE') return '[N|004|Z]';

  if (cmd === 'READ_ARM_STATUS') return '[N|004|R]';
  if (cmd === 'READ_SIREN_STATUS') return '[N|002|R]';
  if (cmd === 'READ_ZONE_STATUS') {
    if (zone === '000' || zone === '0' || !zone) return 'NYY040';
    return `[N|003|${zoneStr}|R]`;
  }
  if (cmd === 'READ_RELAY_STATUS' || cmd === 'READ_OUTPUT_STATUS' || cmd === 'READ_ALL_RELAYS') {
    const outNum = Number(zone);
    if (outNum > 0) return `[N|005|${String(outNum).padStart(2, '0')}|R]`;
    return `[N|005|01|R]`;
  }
  if (cmd === 'READ_SYSTEM_NAME') return '[N|008|R]';

  const outStr = String(Number(zone)).padStart(2, '0');
  if (cmd === 'OUTPUT_ON' || cmd === 'LIGHT_ON' || cmd === 'DVR_ON' || cmd === 'EML_ON') return `[N|005|${outStr}|1]`;
  if (cmd === 'OUTPUT_OFF' || cmd === 'LIGHT_OFF' || cmd === 'DVR_OFF' || cmd === 'EML_OFF') return `[N|005|${outStr}|0]`;

  return null;
}

function getRASSMetadata(account) {
  for (const [mac, dev] of Object.entries(rassConfig)) {
    if (dev.panel_id === account) return { clientId: dev.client_id, macId: mac };
  }
  return null;
}

function sendSingleCommand(socket, commandType, accountNo, zone = "000") {
  if (!socket || socket.destroyed) return false;

  const meta = getRASSMetadata(accountNo);
  const clientId = meta ? meta.clientId : "011745";
  const rassContent = getRASSCommandContent(commandType, zone);
  if (!rassContent) return false;

  const seq = String(outSequence++).padStart(4, '0');
  if (outSequence > 9999) outSequence = 1;

  const cmd = buildRASSControlCommand(seq, accountNo, clientId, rassContent);
  socket.write(cmd);
  console.log(`\n📤 [RASS] Command Sent [${commandType} - Zone/Output: ${zone}]:`);
  console.log(`   Raw Format: ${cmd.replace(/\n/g, '\\n').replace(/\r/g, '\\r')}`);
  return true;
}

function sendCommandToPanel(socket, commandType, accountNo, zone = "000") {
  if (!socket || socket.destroyed) return false;

  const cmd = commandType.toUpperCase();
  const outNum = Number(zone);

  // If READ_RELAY_STATUS / READ_OUTPUT_STATUS / READ_ALL_RELAYS with zone 0 / 000, trigger all 8 relays sequentially
  if ((cmd === 'READ_RELAY_STATUS' || cmd === 'READ_OUTPUT_STATUS' || cmd === 'READ_ALL_RELAYS') && (!outNum || outNum <= 0)) {
    console.log(`\n🔄 [RASS] Reading all relay/output statuses (Relay 01 to 08) sequentially for Panel #${accountNo}...`);
    for (let i = 1; i <= 8; i++) {
      setTimeout(() => {
        if (socket && !socket.destroyed) {
          sendSingleCommand(socket, 'READ_RELAY_STATUS', accountNo, String(i));
        }
      }, (i - 1) * 600);
    }
    return true;
  }

  return sendSingleCommand(socket, commandType, accountNo, zone);
}

async function getPanelMake(currentAccount, remoteIp = null) {
  let panelName = 'RASS';
  try {
    const rawAcct = String(currentAccount || '').trim();
    const strippedAcct = rawAcct.replace(/^0+/, '');
    const paddedAcct = rawAcct.padStart(6, '0');
    const [siteRows] = await pool.query(
      "SELECT Panel_Make FROM sites WHERE NewPanelID = ? OR NewPanelID = ? OR NewPanelID = ? OR PanelID = ? OR PanelID = ? OR PanelID = ? OR dvrip = ? LIMIT 1",
      [rawAcct, strippedAcct, paddedAcct, rawAcct, strippedAcct, paddedAcct, remoteIp || '']
    );
    if (siteRows && siteRows.length > 0 && siteRows[0].Panel_Make) {
      panelName = siteRows[0].Panel_Make;
    }
  } catch (err) { /* ignore */ }
  return panelName;
}

function handleSocketEvents(socket, remoteIp, initialAccount = null) {
  let currentAccount = initialAccount;
  socket.setKeepAlive(true, 30000);
  socket.setTimeout(180000);

  socket.on("timeout", () => socket.destroy());
  socket.on("data", async (data) => {
    const message = data.toString().trim();
    if (!message) return;

    console.log(`\n📩 [RASS] Raw Data Received:`, message);

    const header = parseSIAHeader(message);
    const decoded = decodeSIA(message);

    console.log(`🔓 [RASS] Decoded Meaning:`);
    console.log(JSON.stringify(decoded, null, 2));

    if (header && !decoded.account) decoded.account = header.account;

    if (decoded.code === 'YY' && decoded.zone === '001' && decoded.macId) {
      const rassDev = await getOrRegisterRASS(decoded.macId, remoteIp);
      currentAccount = rassDev.panel_id;
      activeSockets.set(currentAccount, socket);
      panelMetadata.set(currentAccount, { clientId: rassDev.client_id, macId: decoded.macId });

      const ack = buildACK(header);
      const regResponse = buildRASSRegistrationResponse(header.sequence, decoded.macId, rassDev.client_id, rassDev.panel_id, header.receiver);
      socket.write(ack + regResponse);
      return;
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
        const receivedtime = new Date().toISOString().slice(0, 19).replace('T', ' ');

        let priority = 'N', level = 0, targetTable = 'backalerts';
        const configArr = panelConfigCache.get('RASS');
        if (configArr) {
          let matchedConfig = configArr.find(c => c.alarmCodeArr.includes(decoded.code));
          if (matchedConfig) {
            if (matchedConfig.destination === 'back') targetTable = 'backalerts';
            else if (matchedConfig.destination === 'front') {
              targetTable = 'alerts';
              if (matchedConfig.level1Arr.includes(decoded.code)) { level = 1; priority = 'Y'; }
              else if (matchedConfig.level2Arr.includes(decoded.code)) { level = 2; priority = 'Y'; }
              else if (matchedConfig.level3Arr.includes(decoded.code)) { level = 3; priority = 'Y'; }
              else { priority = matchedConfig.rowPriority; }
            }
          }
        }

        const baseValues = [currentAccount, seqno, decoded.zone || '000', decoded.code, decoded.formattedDate || receivedtime, decoded.event || ''];
        try { await pool.query(`INSERT INTO alerts_copy (panelid, seqno, zone, alarm, createtime, alerttype, status) VALUES (?, ?, ?, ?, ?, ?,'O')`, baseValues); } catch (err) { }
        try { await pool.query(`INSERT INTO ${targetTable} (panelid, seqno, zone, alarm, createtime, alerttype, status, priority, level) VALUES (?, ?, ?, ?, ?, ?, 'O', ?, ?)`, [...baseValues, priority, level]); } catch (err) { }
      }
    }

    // -------------------------------------------------
    // 💾 Save Zone Statuses into panel_health
    // -------------------------------------------------
    const zoneItems = decoded.sensors || decoded.zonesList;
    if (zoneItems && Array.isArray(zoneItems) && zoneItems.length > 0 && currentAccount) {
      try {
        const receivedtime = new Date().toISOString().slice(0, 19).replace('T', ' ');
        const panelName = await getPanelMake(currentAccount, remoteIp);

        let columns = ['panelid', 'udate', 'ip', 'panelName'];
        let placeholders = ['?', '?', '?', '?'];
        let values = [currentAccount, receivedtime, remoteIp || '', panelName];
        let setQueryArr = ['udate = ?', 'ip = ?', 'panelName = ?'];
        let setValues = [receivedtime, remoteIp || '', panelName];

        zoneItems.forEach(z => {
          const zNum = parseInt(z.zone, 10);
          if (zNum >= 1 && zNum <= 60) {
            const colName = `zon${zNum}`;
            const stVal = z.description || z.statusDescription || z.status || 'Uninstalled';
            columns.push(colName);
            placeholders.push('?');
            values.push(stVal);
            setQueryArr.push(`${colName} = ?`);
            setValues.push(stVal);
          }
        });

        const [rows] = await pool.query("SELECT id FROM panel_health WHERE panelid = ? LIMIT 1", [currentAccount]);
        if (rows && rows.length > 0) {
          const updateQuery = `UPDATE panel_health SET ${setQueryArr.join(', ')} WHERE panelid = ?`;
          await pool.query(updateQuery, [...setValues, currentAccount]);
          console.log(`✅ [RASS] Zone status (${zoneItems.length} zones, with IP/Name) UPDATED in panel_health for Panel #${currentAccount}`);
        } else {
          const insertQuery = `INSERT INTO panel_health (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`;
          await pool.query(insertQuery, values);
          console.log(`✅ [RASS] Zone status (${zoneItems.length} zones, with IP/Name) INSERTED into panel_health for Panel #${currentAccount}`);
        }
      } catch (dbErr) {
        console.error(`❌ [RASS] DB Error saving zone status to panel_health:`, dbErr.message);
      }
    }

    // Auto-queue NYY041 (zones 31-60) after receiving NYY040 (zones 1-30)
    if (decoded.zone === '040' && currentAccount) {
      console.log(`\n🔄 [RASS] Auto-queuing NYY041 (Zone Status 31-60) for Panel #${currentAccount}...`);
      queueCommand(currentAccount, 'NYY041', '000');
    }

    // -------------------------------------------------
    // 💾 Save Output / Relay Statuses into panel_health
    // -------------------------------------------------
    const relayItems = decoded.channelList || decoded.relayList || decoded.outputs;
    if (((relayItems && Array.isArray(relayItems) && relayItems.length > 0) || (decoded.outputNo !== undefined && decoded.outputNo !== null)) && currentAccount) {
      try {
        const receivedtime = new Date().toISOString().slice(0, 19).replace('T', ' ');
        const panelName = await getPanelMake(currentAccount, remoteIp);

        let columns = ['panelid', 'udate', 'ip', 'panelName'];
        let placeholders = ['?', '?', '?', '?'];
        let values = [currentAccount, receivedtime, remoteIp || '', panelName];
        let setQueryArr = ['udate = ?', 'ip = ?', 'panelName = ?'];
        let setValues = [receivedtime, remoteIp || '', panelName];

        if (relayItems && Array.isArray(relayItems)) {
          relayItems.forEach(c => {
            const ch = parseInt(c.channel || c.relayId || c.output, 10);
            if (ch >= 1 && ch <= 20) {
              const colName = `relay${ch}`;
              const stVal = String(c.status !== undefined ? c.status : c.state);
              columns.push(colName);
              placeholders.push('?');
              values.push(stVal);
              setQueryArr.push(`${colName} = ?`);
              setValues.push(stVal);
            }
          });
        } else if (decoded.outputNo !== undefined && decoded.outputNo !== null) {
          const ch = parseInt(decoded.outputNo, 10);
          if (ch >= 1 && ch <= 20) {
            const colName = `relay${ch}`;
            const stVal = String(decoded.outputState);
            columns.push(colName);
            placeholders.push('?');
            values.push(stVal);
            setQueryArr.push(`${colName} = ?`);
            setValues.push(stVal);
          }
        }

        const [rows] = await pool.query("SELECT id FROM panel_health WHERE panelid = ? LIMIT 1", [currentAccount]);
        if (rows && rows.length > 0) {
          const updateQuery = `UPDATE panel_health SET ${setQueryArr.join(', ')} WHERE panelid = ?`;
          await pool.query(updateQuery, [...setValues, currentAccount]);
          console.log(`✅ [RASS] Relay/Output status (with IP/Name) UPDATED in panel_health for Panel #${currentAccount}`);
        } else {
          const insertQuery = `INSERT INTO panel_health (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`;
          await pool.query(insertQuery, values);
          console.log(`✅ [RASS] Relay/Output status (with IP/Name) INSERTED into panel_health for Panel #${currentAccount}`);
        }
      } catch (dbErr) {
        console.error(`❌ [RASS] DB Error saving relay/output status to panel_health:`, dbErr.message);
      }
    }

    eventLog.unshift({ ...decoded, raw: message, receivedAt: new Date().toISOString() });
    if (eventLog.length > MAX_LOG) eventLog.pop();

    if (header && !socket.destroyed) {
      let commandSentFromQueue = false;
      if (currentAccount) {
        const queue = commandQueue.get(currentAccount);
        if (queue && queue.length > 0) {
          const pending = [...queue];
          commandQueue.set(currentAccount, []);
          for (const item of pending) {
            const success = sendCommandToPanel(socket, item.command, currentAccount, item.zone);
            commandSentFromQueue = true;
            if (item.resolve) item.resolve({ sent: success, command: item.command, zone: item.zone });
          }
        }
      }
      if (!commandSentFromQueue && !message.includes('"ACK"')) {
        socket.write(buildACK(header));
      }
    }
  });

  socket.on("end", () => { if (currentAccount) activeSockets.delete(currentAccount); });
  socket.on("error", () => { });
  socket.on("close", () => { if (currentAccount) activeSockets.delete(currentAccount); });
}

function initiatePanelConnection(panelId, ip) {
  console.log(`\n⏳ [RASS] Attempting OUTGOING connection to Panel #${panelId} at IP: ${ip}:${TCP_PORT}...`);
  const socket = new net.Socket();

  socket.connect(TCP_PORT, ip, () => {
    console.log(`✅ [RASS] Successfully connected to Panel #${panelId} (${ip})`);
    activeSockets.set(panelId, socket);
    handleSocketEvents(socket, ip, panelId);
  });

  socket.on("error", (err) => {
    console.log(`❌ [RASS] Connection failed to Panel #${panelId} (${ip}): ${err.message}`);
  });

  socket.on("close", () => {
    console.log(`⚠️ [RASS] Connection closed for Panel #${panelId} (${ip}). Retrying in 3 minutes...`);
    setTimeout(() => {
      if (!activeSockets.has(panelId) || activeSockets.get(panelId).destroyed) {
        initiatePanelConnection(panelId, ip);
      }
    }, 180000); // 3 minutes
  });
}

async function connectToAllPanels() {
  try {
    const [rows] = await pool.query("SELECT NewPanelID, dvrip FROM sites WHERE Panel_Make LIKE 'rass' AND dvrip IS NOT NULL AND dvrip != '' LIMIT 15");
    if (rows && rows.length > 0) {
      console.log(`\n🔄 [RASS] Found ${rows.length} RASS panels with IPs in database. Initiating outgoing connections...`);
      for (const row of rows) {
        const panelId = String(row.NewPanelID).trim();
        const ip = String(row.dvrip).trim();
        if (!activeSockets.has(panelId)) initiatePanelConnection(panelId, ip);
      }
    } else {
      console.log(`\nℹ️ [RASS] No RASS panels found in database with valid IP for outgoing connection.`);
    }
  } catch (err) {
    console.error(`❌ [RASS] Error fetching panels from DB for outgoing connections:`, err.message);
  }
}

function startServer() {
  // connectToAllPanels();
  // setInterval(connectToAllPanels, 180000); // 3 minutes

  const tcpServer = net.createServer((socket) => {
    const remoteIp = socket.remoteAddress ? socket.remoteAddress.replace(/^.*:/, '').trim() : null;
    console.log(`\n📡 [RASS] Incoming TCP Connection Initiated from IP: ${remoteIp}`);
    handleSocketEvents(socket, remoteIp);
  });
  tcpServer.listen(TCP_PORT, () => console.log(`🚀 RASS TCP Server listening on port ${TCP_PORT}`));
}

function checkConnection(account, maxWait = 60000) {
  return new Promise((resolve) => {
    const sock = activeSockets.get(account);
    if (sock && !sock.destroyed) return resolve({ success: true, status: "online" });

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
    const cmdUpper = (command || '').toUpperCase();
    const isAllRelays = (cmdUpper === 'READ_RELAY_STATUS' || cmdUpper === 'READ_OUTPUT_STATUS' || cmdUpper === 'READ_ALL_RELAYS') && (!Number(zone) || Number(zone) <= 0);
    const waitTime = isAllRelays ? 6000 : 3000;

    const sock = activeSockets.get(account);
    if (sock && !sock.destroyed) {
      const timeBefore = new Date().toISOString();
      const success = sendCommandToPanel(sock, command, account, zone);
      setTimeout(() => {
        const newEvents = eventLog.filter(e => e.account === account && e.receivedAt > timeBefore);
        resolve({ success, status: "sent_immediately", panelResponse: newEvents });
      }, waitTime);
    } else {
      if (!commandQueue.has(account)) commandQueue.set(account, []);
      const timeBefore = new Date().toISOString();
      let done = false;
      commandQueue.get(account).push({
        command, zone, queuedAt: timeBefore,
        resolve: (res) => {
          if (!done) {
            done = true;
            setTimeout(() => {
              const newEvents = eventLog.filter(e => e.account === account && e.receivedAt > timeBefore);
              resolve({ success: res.sent, status: "sent_from_queue", panelResponse: newEvents });
            }, waitTime);
          }
        }
      });
      // Attempt on-demand connection if not already connected
      pool.query("SELECT dvrip FROM sites WHERE NewPanelID = ? AND dvrip IS NOT NULL AND dvrip != '' LIMIT 1", [account])
        .then(([rows]) => {
          if (rows && rows.length > 0) {
            const ip = String(rows[0].dvrip).trim();
            console.log(`\n🔄 [RASS] On-Demand connection triggered for Panel #${account} (IP: ${ip})`);
            initiatePanelConnection(account, ip);
          } else {
            console.log(`\n⚠️ [RASS] Cannot connect on-demand to Panel #${account}: No valid IP found in DB.`);
          }
        })
        .catch(err => console.error(`\n❌ [RASS] DB Error while fetching IP for on-demand connection:`, err.message));

      setTimeout(() => {
        if (!done) {
          done = true;
          resolve({ success: false, status: "timeout", message: "Timeout waiting for panel connection" });
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
  activeSockets.forEach((sock, acct) => { devices.push({ account: acct, type: 'rass', connected: !sock.destroyed }); });
  return { success: true, devices };
}

module.exports = { startServer, checkConnection, queueCommand, getEvents, getStatus };
