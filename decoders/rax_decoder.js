// 👉 Event mapping based on MSSW-CP 8100 SIA DC 09 Event.csv (Independent Copy for RAX)
const SIA_EVENTS = {
    "YN": "Not use",
    "EA": "Delay alarm",
    "BA": "Perimeter / Interior alarm",
    "QA": "24-hour alarm",
    "PA": "Emergency alarm",
    "MA": "Medical alarm",
    "GA": "Gas alarm",
    "FA": "Fire alarm",
    "HA": "Hostage alarm",
    "TA": "Tamper alarm",
    "CG": "System arm",
    "OG": "System disarm",
    "NL": "System stay mode",
    "VT": "System battery low voltage",
    "YR": "System battery recovery",
    "AT": "System AC power failure",
    "AR": "System AC power restored",
    "OR": "Alarm cancelled",
    "YG": "System programming modified",
    "CI": "Arming failed",
    "RP": "Communication test",
    "BB": "Zone bypassed",
    "BU": "Zone bypass restored",
    "WX": "System communication fault / restored",
    "YC": "System communication fault",
    "YK": "System communication restored",
    "BT": "Zone loop fault",
    "BJ": "Zone loop restored / Module online",
    "YA": "Siren fault",
    "YH": "Siren restored",
    "BR": "Zone recovery (Delay/Perimeter/Interior)",
    "QR": "24-hour recovery",
    "FR": "Emergency / Fire recovery",
    "MH": "Medical recovery",
    "GR": "Gas recovery",
    "HR": "Hostage recovery",
    "TR": "Tamper recovery",
    "LT": "PSTN line fault",
    "LR": "PSTN line recovered",
    "BZ": "Module offline",
    "XT": "RF device low battery",
    "XR": "RF battery recovered",
    "LB": "Enter programming mode",
    "LS": "Exit programming mode",
    "WM": "Network line fault",
    "WN": "Network line recovered",
    "CF": "Force arm",
    "NF": "Force stay mode",
    "TP": "Walk test",
    "BX": "Intrusion test",
    "FX": "Fire test",
    "GX": "Panic test",
    "JO": "Event log overflow",
    "JT": "System time set",
    "WO": "GSM fault",
    "WP": "GSM recovery",
    "XO": "RF receiver jammed",
    "RZ": "System shutdown",
    "RR": "System startup",
    "WA": "Water leakage",
    "WR": "Water detector recovery",
    "YP": "Sub device AC power fault",
    "YQ": "Sub device AC power recovery",
    "WK": "WiFi network fault",
    "WL": "WiFi network recovery",
    "CA": "Auto arm",
    "OA": "Auto disarm",
    "OP": "System Opened",
    "CL": "System Closed"
};

// 👉 Main decode function for RAX Protocol
function decodeSIA(message) {
    // 1. Check if it's a standard SIA packet (like what Rax uses for alarms)
    if (message.includes("SIA-DCS")) {
        const result = {
            account: null,
            code: null,
            event: null,
            zone: null,
            partition: null,
            timestamp: null,
            formattedDate: null
        };

        // Extract timestamp (Format: HH:mm:ss,MM-DD-YYYY)
        const timeMatch = message.match(/_(\d{2}:\d{2}:\d{2}),(\d{2})-(\d{2})-(\d{4})/);
        if (timeMatch) {
            const time = timeMatch[1];  // HH:mm:ss
            const month = timeMatch[2]; // MM
            const day = timeMatch[3];   // DD
            const year = timeMatch[4];  // YYYY

            result.timestamp = `${timeMatch[1]},${timeMatch[2]}-${timeMatch[3]}-${timeMatch[4]}`; // Original

            // Converting to standard format: YYYY-MM-DD HH:mm:ss
            result.formattedDate = `${year}-${month}-${day} ${time}`;
        }

        // Extract bracket data
        const match = message.match(/\[(.*?)\]/);
        if (match) {
            const content = match[1];
            const parts = content.split("|");

            if (parts.length > 1) {
                result.account = parts[0].replace("#", "").trim();
                const eventPart = parts[1]; 

                // Parse SIA payload correctly
                const slashIndex = eventPart.indexOf("/");
                if (slashIndex !== -1) {
                    result.partition = eventPart.substring(1, slashIndex); // Skip 'N' (New Event)
                    const afterSlash = eventPart.substring(slashIndex + 1); 
                    result.code = afterSlash.substring(0, 2); 
                    result.zone = afterSlash.substring(2);    
                } else {
                    // Fallback if no slash is found
                    result.code = eventPart.substring(1, 3);
                    result.zone = eventPart.substring(3);
                }

                // Find event in mapping
                result.event = SIA_EVENTS[result.code] || `Unknown Event (${result.code})`;
            }
        }
        return result;
    }

    // 2. Check if it's a RAX specific plaintext response
    const result = {
        account: null,
        code: null,
        event: null,
        zone: null,
        partition: null,
        timestamp: null,
        formattedDate: null,
        isRaxPlaintext: true,
        rawResponse: message
    };

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    result.formattedDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    // Extract account from STARTACCXXXXXX
    const accMatch = message.match(/ACC(\d{5,6})/);
    if (accMatch) {
        result.account = accMatch[1];
    }

    // Extract MAC if present
    const macMatch = message.match(/MAC(\d{18})/);
    if (macMatch) {
        result.macId = macMatch[1];
    }

    // Parse specific responses based on the documentation
    if (message.includes("OUTPUT OK") || message.includes("OUTPUT received OK")) {
        result.event = "Output control command acknowledged";
        result.code = "OUTPUT_ACK";
    } else if (message.includes("PORT OK")) {
        result.event = "Port settings command acknowledged";
        result.code = "PORT_ACK";
    } else if (message.includes("WRLA OK")) {
        result.event = "Panel ID change acknowledged";
        result.code = "WRLA_ACK";
    } else if (message.includes("STARTRPS")) {
        result.event = "Read port status response";
        result.code = "RPS_RES";
        
        const match = message.match(/STARTRPS(.*?)END/);
        if (match) {
            const statuses = match[1];
            const statusMap = {
                '0': 'Normal', '1': 'Alert', '2': 'Not connected',
                '3': 'Shorted', '4': 'Ack', '6': 'Reset',
                '9': 'Bypass', 'A': 'Long open'
            };
            console.log(`\n=== [RAX] PANEL PORT/ZONE STATUS ===`);
            let zones = [];
            for (let i = 0; i < statuses.length; i++) {
                const zoneNum = i + 1;
                const char = statuses[i];
                const meaning = statusMap[char] || `Unknown (${char})`;
                console.log(` Zone ${String(zoneNum).padStart(2, '0')}: ${meaning}`);
                zones.push({ zone: zoneNum, status: meaning, code: char });
            }
            console.log(`======================================\n`);
            result.zonesList = zones;
        }
    } else if (message.includes("STARTRCS")) {
        result.event = "Read channel status response";
        result.code = "RCS_RES";
        
        const match = message.match(/STARTRCS(.*?)END/);
        if (match) {
            const channelsStr = match[1];
            const channels = channelsStr.split('&').filter(c => c.length > 0);
            
            console.log(`\n=== [RAX] PANEL CHANNEL STATUS ===`);
            let chList = [];
            for (let i = 0; i < channels.length; i++) {
                const ch = channels[i];
                if (ch.length === 2) {
                    const status = ch[0];
                    const mode = ch[1];
                    const modeMap = {'0': 'Manual', '2': 'Auto', '3': 'Auto plus'};
                    const modeMeaning = modeMap[mode] || `Unknown mode (${mode})`;
                    console.log(` Channel ${String(i+1).padStart(2, '0')}: Status Code = ${status}, Mode = ${modeMeaning}`);
                    chList.push({ channel: i+1, status: status, mode: modeMeaning, raw: ch });
                }
            }
            console.log(`====================================\n`);
            result.channelList = chList;
        }
    } else if (message.includes("RLAR")) {
        result.event = "Read Panel ID response";
        result.code = "RLA_RES";
        
        const match = message.match(/RLAR(.*?)\&L(.*?)\&(.*?)\&END/);
        if (match) {
            console.log(`\n=== [RAX] PANEL ID DETAILS (RLA) ===`);
            console.log(` Receiver Number (R) : ${match[1]}`);
            console.log(` Line Number (L)     : ${match[2]}`);
            console.log(` Account Number      : ${match[3]}`);
            console.log(`======================================\n`);
            result.receiverNumber = match[1];
            result.lineNumber = match[2];
            result.panelAccount = match[3];
        }
    } else if (message.startsWith("STARTPORT")) {
        result.event = "Read Input Port Settings response";
        result.code = "PORT_SETTING_RES";
        
        const regex = /STARTPORT(\d{2})(\d)(\d)(\d)(\d)(\d{15})(\d)(\d{8})(\d{8})(\d{3})(\d)\&(.*?)\&(.*?)\&(.*?)\&(.*?)\&END/;
        const match = message.match(regex);
        if (match) {
            console.log(`\n=== [RAX] INPUT PORT SETTINGS ===`);
            console.log(` Port Number          : ${match[1]}`);
            
            const zType = {'0':'Bypass','1':'Enable','2':'Enable Always','3':'Arming'}[match[2]] || match[2];
            console.log(` Zone Type            : ${zType}`);
            
            const sType = {'0':'NC','1':'NO','2':'Analog','4':'Shutter PIR','5':'Shutter Bottom','6':'Shutter Top'}[match[3]] || match[3];
            console.log(` Sensor Type          : ${sType}`);
            
            const aType = {'1':'S1 Alert','2':'S2 Alert','3':'S3 Alert'}[match[4]] || match[4];
            console.log(` Alert Type           : ${aType}`);
            
            const hAct = {'1':'Enable','2':'Disable'}[match[5]] || match[5];
            console.log(` Hooter Activate      : ${hAct}`);
            console.log(` User Allocation      : ${match[6]}`);
            console.log(` Alert/Hooter Timer   : ${match[7]}`);
            console.log(` Alert Timer          : ${match[8]}`);
            console.log(` Hooter Timer         : ${match[9]}`);
            console.log(` Hooter Delay         : ${match[10]} seconds`);
            console.log(` Server Type          : ${match[11]}`);
            console.log(` SIA Alert Event Code : ${match[12]}`);
            console.log(` SIA Normal Event Code: ${match[13]}`);
            console.log(` SIA Zone Event Code  : ${match[14]}`);
            const anType = {'0':'RTD','1':'NON RTD'}[match[15]] || match[15];
            console.log(` Analog Zone Type     : ${anType}`);
            console.log(`===================================\n`);
            
            result.portSettings = {
                port: match[1], zoneType: zType, sensorType: sType, alertType: aType,
                hooterActivate: hAct, users: match[6], timersConfig: match[7],
                alertTimer: match[8], hooterTimer: match[9], hooterDelay: match[10],
                serverType: match[11], siaAlert: match[12], siaNormal: match[13],
                siaZone: match[14], analogZoneType: anType
            };
        } else {
            console.log(`\n=== [RAX] INPUT PORT SETTINGS ===`);
            console.log(` Raw Data: ${message}`);
            console.log(`===================================\n`);
        }
    } else {
        result.event = "Unknown RAX Response";
        result.code = "UNKNOWN_RAX";
    }

    return result;
}

decodeSIA.SIA_EVENTS = SIA_EVENTS;
module.exports = decodeSIA;
