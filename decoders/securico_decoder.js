/**
 * Securico GX4816 Protocol Decoder
 * Designed for Securico panel messages according to the provided documentation.
 */

const ZONE_MAP = {};
// Populate 001 to 047 generically based on Excel
for(let i=1; i<=47; i++) {
    const pad = String(i).padStart(3, '0');
    ZONE_MAP[pad] = {
        name: `Zone ${i}`,
        alarmCode: "BA",
        restoreCode: "BR"
    };
}
// Add some specific generic zones 
ZONE_MAP["000"] = { name: "Panel/System", alarmCode: "BA", restoreCode: "BR" };

const GENERIC_EVENTS = {
    "BA": "Burglary Alarm",
    "BR": "Burglary Restoral",
    "FA": "Fire Alarm",
    "FR": "Fire Restoral",
    "TA": "Tamper Alarm",
    "TR": "Tamper Restoral",
    "PA": "Panic Alarm",
    "PR": "Panic Restoral",
    "AT": "AC Power Fail",
    "AR": "AC Power Restored",
    "YT": "Low Battery",
    "YR": "Battery Restored",
    "CL": "System Armed",
    "OA": "System Disarmed",
    "OP": "System Opened",
    // Panel specific ones from Securico doc
    "RO": "Relay Open/Off",
    "RC": "Relay Closed/On",
    "DD": "Extended Disarm",
    "DO": "Long Open",
    "HA": "Hooter Ack",
    "SO": "Out of Schedule Open",
    "SC": "Out of Schedule Close",
    "BS": "Short Event",
    "BD": "Disconnect Event",
    "TS": "Function Activate",
    "TO": "Time Delay Started",
    "AD": "Function Deactivate"
};

/**
 * Decodes Securico SIA-DCS packet string
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
        formattedDate: null
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

    // 2. Extract Data inside first brackets [...]
    const bracketMatch = message.match(/\[(.*?)\]/);
    if (bracketMatch) {
        const content = bracketMatch[1];
        const parts = content.split("|");

        if (parts.length > 1) {
            result.account = parts[0].replace("#", "").trim();
            const eventPart = parts[1]; // e.g., "NBA021"

            let codeZonePart = eventPart;
            if (eventPart.includes('/')) {
                codeZonePart = eventPart.split('/')[1];
            } else if (eventPart.startsWith('N')) {
                codeZonePart = eventPart.substring(1);
            }

            // Code is typically first 2 characters, zone is the rest
            result.code = codeZonePart.substring(0, 2);
            result.zone = codeZonePart.substring(2);

            // Securico Zone Status Explanations from Excel
            const securicoStatusMap = {
                '0': 'Normal', '1': 'Alert', '2': 'Not_coonected', 
                '3': 'Short_', '4': 'Long open', '5': 'Hooter Ack',
                '6': 'Low', '7': 'High', '8': 'Close', '9': 'Open',
                'A': 'Zone disable'
            };

            // Handle DCS008 Zone Status Parts (e.g. DCS008|000|0000A00890880AAAAAAA)
            if (eventPart === 'DCS008' && parts.length >= 4) {
                const chunkIndex = parseInt(parts[2], 10);
                const statuses = parts[3];
                result.code = "RPS_RES";
                result.event = `Zone Status Response Part ${chunkIndex}`;
                result.zonesList = [];
                const startIndex = chunkIndex * 20; // 0->0, 1->20, 2->40
                
                for (let i = 0; i < statuses.length; i++) {
                    const statusChar = statuses[i];
                    let mappedStatus = '0'; 
                    if (statusChar === '0' || statusChar === '8') mappedStatus = '0';
                    else if (statusChar === '1' || statusChar === '9') mappedStatus = '1';
                    else if (statusChar === 'A') mappedStatus = '2';
                    else mappedStatus = statusChar;
                    
                    result.zonesList.push({
                        zone: startIndex + i + 1,
                        status: mappedStatus,
                        statusDescription: securicoStatusMap[statusChar] || `Unknown (${statusChar})`,
                        originalStatus: statusChar
                    });
                }
                return result;
            }

            // Handle DCS009 Relay Status Parts (e.g. DCS009|000|030#130#231#331...)
            if (eventPart === 'DCS009' && parts.length >= 4) {
                const relaysData = parts[3].split('#').filter(r => r.length === 3);
                result.code = "RLS_RES"; // Relay Status Response
                result.event = "Relay Status Response";
                result.relayList = [];
                
                const modeMap = { '0': 'Manual Mode', '1': 'Scheduled Mode', '2': 'Sensor Control Mode', '3': 'Auto Mode' };
                const statusMap = { '0': 'OFF', '1': 'ON', '2': 'Ack', '3': 'Pulse reset', '4': 'Hooter reset', '5': 'Disable' };
                
                for (let i = 0; i < relaysData.length; i++) {
                    const relayInfo = relaysData[i];
                    // Example: 030 => Relay No 0 (which is 1), Mode 3, Status 0
                    // In Excel it says starting from 0=1, 1=2... But wait, in the example some relays have '7' repeatedly?
                    // We will just index them from 1 to 12 sequentially.
                    const relayId = i + 1;
                    const modeCode = relayInfo[1];
                    const statusCode = relayInfo[2];
                    
                    result.relayList.push({
                        relayId: relayId,
                        mode: modeCode,
                        modeDescription: modeMap[modeCode] || `Unknown (${modeCode})`,
                        status: statusCode,
                        statusDescription: statusMap[statusCode] || `Unknown (${statusCode})`,
                        originalString: relayInfo
                    });
                }
                return result;
            }

            // Handle DCS010 User/Arm Status Parts
            if (eventPart === 'DCS010' && parts.length >= 4) {
                const usersData = parts[3].split('#').filter(u => u.length > 0);
                result.code = "USR_RES"; // User/Arm Status Response
                result.event = "Arm/Disarm & User Status Response";
                result.usersList = [];
                
                const adminStatusMap = { '24': 'ARMED', '25': 'DISARMED', '26': 'AUTO ARMED/ SCHEDULED ARMED', '27': 'AUTO DISARMED/ SCHEDULED DISARMED', '00': 'Disabled / Not Activated' };
                const userStatusMap = { '00': 'USER LOGGED OUT', '01': 'USER LOGGED IN' };
                const engStatusMap = { '10': 'ENGINEER CODE LOGGED OUT', '11': 'ENGINEER CODE LOGGED IN' };

                for (let i = 0; i < usersData.length; i++) {
                    const statusCode = usersData[i];
                    let userId = i + 1;
                    let userName = `USER-${i}`;
                    let mappedStatus = `Unknown (${statusCode})`;

                    if (i === 0) {
                        userName = "ADMIN USER-00";
                        mappedStatus = adminStatusMap[statusCode] || mappedStatus;
                    } else if (i === usersData.length - 1) {
                        userName = "ENGINEERING USER-99";
                        mappedStatus = engStatusMap[statusCode] || mappedStatus;
                    } else if (i >= 1 && i <= 18) {
                        userName = `USER-${i}`;
                        // Fallback to engStatusMap/adminStatusMap if a normal user returns '10' or '26'
                        mappedStatus = userStatusMap[statusCode] || engStatusMap[statusCode] || adminStatusMap[statusCode] || mappedStatus;
                    } else {
                        userName = `ARMIN USER-${i + 2}`;
                        mappedStatus = adminStatusMap[statusCode] || mappedStatus;
                    }

                    result.usersList.push({
                        id: userId,
                        name: userName,
                        status: statusCode,
                        statusDescription: mappedStatus
                    });
                }
                return result;
            }

            // Special case: 47-character zone status string
            if (eventPart.length === 47 && /^[0-9A-Z]+$/.test(eventPart) && !eventPart.startsWith('DCS') && !eventPart.startsWith('NBA')) {
                result.code = "RPS_RES";
                result.event = "Zone Status Response";
                result.zonesList = [];
                for (let i = 0; i < eventPart.length; i++) {
                    const statusChar = eventPart[i];
                    let mappedStatus = '0'; // Default Normal
                    if (statusChar === '0' || statusChar === '8') mappedStatus = '0'; // Normal/Close
                    else if (statusChar === '1' || statusChar === '9') mappedStatus = '1'; // Alert/Open
                    else if (statusChar === 'A') mappedStatus = '2'; // Disable
                    else mappedStatus = statusChar;
                    
                    result.zonesList.push({
                        zone: i + 1,
                        status: mappedStatus,
                        statusDescription: securicoStatusMap[statusChar] || `Unknown (${statusChar})`,
                        originalStatus: statusChar
                    });
                }
                return result;
            }

            // Special case: 12-character relay status string auto-push
            if (eventPart.length === 12 && /^[0-5]+$/.test(eventPart) && !eventPart.startsWith('DCS') && !eventPart.startsWith('NBA')) {
                result.code = "RLS_RES";
                result.event = "Relay Status Auto Push";
                result.relayList = [];
                const statusMap = { '0': 'OFF', '1': 'ON', '2': 'Ack', '3': 'Pulse reset', '4': 'Hooter reset', '5': 'Disable' };
                
                for (let i = 0; i < eventPart.length; i++) {
                    const statusChar = eventPart[i];
                    result.relayList.push({
                        relayId: i + 1,
                        status: statusChar,
                        statusDescription: statusMap[statusChar] || `Unknown (${statusChar})`
                    });
                }
                return result;
            }

            // Look up event name
            let eventDesc = "Unknown Event";
            const zoneInfo = ZONE_MAP[result.zone];
            if (zoneInfo) {
                if (result.code === zoneInfo.alarmCode) {
                    eventDesc = zoneInfo.name + " Alarm";
                } else if (result.code === zoneInfo.restoreCode) {
                    eventDesc = zoneInfo.name + " Restoral";
                } else {
                    eventDesc = zoneInfo.name + " (" + (GENERIC_EVENTS[result.code] || result.code) + ")";
                }
            } else {
                eventDesc = GENERIC_EVENTS[result.code] || `Unknown Event (${result.code})`;
            }

            result.event = eventDesc;
        }
    }

    return result;
}

decodeSIA.ZONE_MAP = ZONE_MAP;
decodeSIA.GENERIC_EVENTS = GENERIC_EVENTS;

module.exports = decodeSIA;
