/**
 * RASS Protocol Decoder
 * Exclusively designed for RASS (VcopIP) panel messages according to the protocol specification.
 */

const SIA_EVENTS = {
    // Zone Alarms & Restorals
    "BA": "Intrusion Alarm",
    "BR": "Intrusion Restoral",
    "FA": "Fire Alarm",
    "FR": "Fire Restoral",
    "JP": "Motion Alarm",
    "GA": "Gas Leak Alarm",
    "GR": "Gas Leak Restoral",
    "TA": "Tamper Alarm",
    "TR": "Tamper Restoral",
    "PA": "Panic Alarm",
    "DF": "Vibration/Heat Alarm",
    "DR": "Vibration/Heat Restoral",
    "UA": "Other Alarm",
    "UR": "Other Restoral",

    // System Troubles & Restorals
    "YT": "Low Battery",
    "YR": "Battery Recovered",
    "YM": "No Battery",
    "AT": "AC Power Fail",
    "AR": "AC Power Restored",
    "YA": "Siren ON / Sounder Trouble",
    "YH": "Siren OFF / Sounder Restored",
    "FT": "Fire Trouble",
    "FZ": "Fire Trouble Restored",

    // System Arming / Status
    "CL": "Armed All (Away)",
    "OA": "Disarmed",
    "NL": "Stay Armed (Partial)",
    "CG": "System Armed",
    "OG": "System Disarmed",
    "OP": "System Opened",

    // RASS Specific / Extended Commands
    "YY": "System Initialization/Status",
    "YN": "Not Use",
    "EA": "Delay alarm",
    "MA": "Medical alarm",
    "HA": "Hostage alarm",
    "CI": "Arming failed",
    "RP": "Communication test",
    "BB": "Zone bypassed",
    "BU": "Zone bypass restored",
    "YC": "System communication fault",
    "YK": "System communication restored",
    "BT": "Zone loop fault",
    "BJ": "Zone loop restored / Module online",
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
    "OA": "Auto disarm"
};

/**
 * Decodes RASS specific SIA-DCS packet string
 * @param {string} message - The raw trimmed message string
 * @returns {object} - The decoded result object
 */
function decodeSIA(message) {
    const result = {
        account: null,
        code: null,
        event: null,
        zone: null,
        timestamp: null,
        formattedDate: null,
        isRASS: true,
        macId: null,
        firmware: null,
        clientId: null,
        panelId: null,
        sensors: null
    };

    if (!message) return result;

    // 1. Extract Timestamp (Format: HH:mm:ss,MM-DD-YYYY or HH:mm:ss,DD-MM-YYYY)
    const timeMatch = message.match(/_(\d{2}:\d{2}:\d{2}),(\d{2})-(\d{2})-(\d{4})/);
    if (timeMatch) {
        const time = timeMatch[1];  // HH:mm:ss
        const month = timeMatch[2]; // MM
        const day = timeMatch[3];   // DD
        const year = timeMatch[4];  // YYYY

        result.timestamp = `${time},${month}-${day}-${year}`;
        result.formattedDate = `${year}-${month}-${day} ${time}`;
    }

    // 2. Extract Data inside first brackets [...] - RASS format has no partition slashes
    const bracketMatch = message.match(/\[(.*?)\]/);
    if (bracketMatch) {
        const content = bracketMatch[1]; // e.g., "#000014|NYY040"
        const parts = content.split("|");

        if (parts.length > 1) {
            result.account = parts[0].replace("#", "").trim();
            const eventPart = parts[1]; // e.g., "NYY040"

            // RASS format: Skip first char 'N', next 2 are event code, last 3 are zone
            result.code = eventPart.substring(1, 3);
            result.zone = eventPart.substring(3);
            result.event = SIA_EVENTS[result.code] || `Unknown Event (${result.code})`;
        }
    }

    // 3. Extract second bracket content for Handshakes or Status reports
    const secondBracketMatch = message.match(/\]\s*\[(N\|.*?)\]/);
    if (secondBracketMatch) {
        const secContent = secondBracketMatch[1]; // e.g. "N|0004A30B003FCE49|R1.03.001" or "N|001B|002R|..."
        const secParts = secContent.split("|");

        if (secParts[0] === 'N') {
            // NYY001 (Registration request with MAC)
            if (result.zone === '001' && secParts.length > 2) {
                result.macId = secParts[1];
                result.firmware = secParts[2];
            }
            // NYY002 (Registration Response)
            else if (result.zone === '002' && secParts.length > 3) {
                result.macId = secParts[1];
                result.clientId = secParts[2];
                result.panelId = secParts[3];
            }
            // NYY004 (Read Commands Response)
            else if (result.zone === '004' && secParts.length > 1) {
                const cmdType = secParts[1];
                if (cmdType === '002' && secParts.length >= 4) {
                    const sirenState = secParts[2] === '1' ? 'ON' : 'OFF';
                    const sirenEnable = secParts[3] === '1' ? 'Enabled' : 'Disabled';
                    result.event = `Read Command Response: Siren Status - ${sirenState}, ${sirenEnable}`;
                    result.sirenState = sirenState;
                    result.sirenEnable = sirenEnable;
                } else if (cmdType === '003' && secParts.length >= 4) {
                    const z = secParts[2];
                    const st = secParts[3];
                    let stDesc = "Unknown";
                    if (st === 'U') stDesc = "Uninstalled";
                    else if (st === 'R') stDesc = "Restored/Normal";
                    else if (st === 'B') stDesc = "Bypassed";
                    else if (st === 'A') stDesc = "Alarm";
                    result.event = `Read Command Response: Zone ${z} Status - ${stDesc}`;
                    result.sensors = [{ zone: z, status: st, description: stDesc }];
                } else if (cmdType === '004' && secParts.length >= 4) {
                    const panelEn = secParts[2] === '1' ? 'Enabled' : 'Disabled';
                    const armSt = secParts[3];
                    let armDesc = "Unknown";
                    if (armSt === '1') armDesc = "Armed";
                    else if (armSt === '2') armDesc = "Disarmed";
                    else if (armSt === '3') armDesc = "Partial Disarm / Stay";
                    else if (armSt === '4') armDesc = "Entry Delay";
                    else if (armSt === '5') armDesc = "Exit Delay";
                    result.event = `Read Command Response: Panel Status - ${panelEn}, ${armDesc}`;
                    result.panelEnabled = panelEn;
                    result.armStatus = armDesc;
                } else if (cmdType === '005' && secParts.length >= 4) {
                    const outNo = secParts[2];
                    const outSt = secParts[3] === '1' ? 'ON' : 'OFF';
                    result.event = `Read Command Response: Output ${outNo} Status - ${outSt}`;
                    result.outputNo = outNo;
                    result.outputState = outSt;
                } else if (cmdType === '008' && secParts.length >= 3) {
                    const sysName = secParts[2].trim();
                    result.event = `Read Command Response: System Name - ${sysName}`;
                    result.systemName = sysName;
                }
            }
            // NYY040 or NYY041 (Sensor status grids)
            else if ((result.zone === '040' || result.zone === '041') && secParts.length > 1) {
                const sensors = [];
                for (let i = 1; i < secParts.length; i++) {
                    const item = secParts[i];
                    if (item.length >= 4) {
                        const zoneNo = item.substring(0, 3);
                        const statusChar = item.substring(3);

                        let statusDesc = "Unknown";
                        if (statusChar === 'B') statusDesc = "Bypassed";
                        else if (statusChar === 'R') statusDesc = "Normal/Restored";
                        else if (statusChar === 'U') statusDesc = "Uninstalled";
                        else if (statusChar === 'A') statusDesc = "Alarm";

                        sensors.push({
                            zone: zoneNo,
                            status: statusChar,
                            description: statusDesc
                        });
                    }
                }
                result.sensors = sensors;
            }
        }
    }

    return result;
}

decodeSIA.SIA_EVENTS = SIA_EVENTS;
module.exports = decodeSIA;
