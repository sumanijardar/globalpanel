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
