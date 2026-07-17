// 👉 Event mapping based on MSSW-CP 8100 SIA DC 09 Event.csv
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

// 👉 Main decode function
function decodeSIA(message) {
    const result = {
        account: null,
        code: null,
        event: null,
        zone: null,
        partition: null,
        timestamp: null,
        formattedDate: null
    };

    // 👉 Extract timestamp (Format: HH:mm:ss,MM-DD-YYYY)
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

    // 👉 Extract bracket data
    const match = message.match(/\[(.*?)\]/);

    if (match) {
        const content = match[1];
        const parts = content.split("|");

        if (parts.length > 1) {
            result.account = parts[0].replace("#", "").trim();

            const eventPart = parts[1]; // e.g., "Nri0000/RR000" or "Nri0/EA001"

            // Parse SIA payload correctly
            const slashIndex = eventPart.indexOf("/");
            if (slashIndex !== -1) {
                // e.g., "Nri0000/RR000" -> partition = "ri0000", afterSlash = "RR000"
                result.partition = eventPart.substring(1, slashIndex); // Skip 'N' (New Event)
                const afterSlash = eventPart.substring(slashIndex + 1); // "RR000"

                result.code = afterSlash.substring(0, 2); // "RR"
                result.zone = afterSlash.substring(2);    // "000"
            } else {
                // Fallback if no slash is found
                result.code = eventPart.substring(1, 3);
                result.zone = eventPart.substring(3);
            }

            // 👉 Find event in mapping
            result.event = SIA_EVENTS[result.code] || `Unknown Event (${result.code})`;
        }
    }

    return result;
}

decodeSIA.SIA_EVENTS = SIA_EVENTS;
module.exports = decodeSIA;