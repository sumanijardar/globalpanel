// Intellitech (Goldbox) Decoder
// Maps JSON status IDs to SIA-like codes for the Universal Server

// Main decode function for a single status item
// Example inputs: 
// item: { id: 402, status: 1 }
// deviceId: "sspldemo"
// dataDateStr: "20260811170202"
function decodeIntellitech(item, deviceId, dataDateStr) {
    const result = {
        account: deviceId,
        code: null,
        event: null,
        zone: item.id.toString(),
        partition: "1",
        timestamp: null,
        formattedDate: null
    };

    // Format Date: 20260811170202 -> 2026-08-11 17:02:02
    if (dataDateStr && dataDateStr.toString().length === 14) {
        const dStr = dataDateStr.toString();
        const year = dStr.substring(0, 4);
        const month = dStr.substring(4, 6);
        const day = dStr.substring(6, 8);
        const hour = dStr.substring(8, 10);
        const minute = dStr.substring(10, 12);
        const second = dStr.substring(12, 14);
        
        result.timestamp = `${hour}:${minute}:${second},${month}-${day}-${year}`;
        result.formattedDate = `${year}-${month}-${day} ${hour}:${minute}:${second}`;
    } else {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        result.formattedDate = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
        result.timestamp = result.formattedDate; // Fallback
    }

    const idStr = item.id.toString();
    const statusVal = item.status;

    // Apply mapping
    if (idStr.startsWith("4")) {
        // Zones
        if (statusVal === 5) {
            result.code = "BA";
            result.event = "Perimeter / Interior alarm";
        } else if (statusVal === 6) {
            result.code = "BR";
            result.event = "Zone recovery (Delay/Perimeter/Interior)";
        } else {
            result.code = "XX";
            result.event = "Unknown Zone Status";
        }
    } else if (idStr.startsWith("3")) {
        // Sirens
        if (statusVal === 5) {
            result.code = "YA";
            result.event = "Siren fault";
        } else if (statusVal === 6) {
            result.code = "YH";
            result.event = "Siren restored";
        } else {
            result.code = "XX";
            result.event = "Unknown Siren Status";
        }
    } else if (idStr.startsWith("2")) {
        // Relays
        if (statusVal === 5) {
            result.code = "RY"; // Custom code for Relay ON
            result.event = "Relay ON";
        } else if (statusVal === 6) {
            result.code = "RX"; // Custom code for Relay OFF
            result.event = "Relay OFF";
        } else {
            result.code = "XX";
            result.event = "Unknown Relay Status";
        }
    } else {
        result.code = "XX";
        result.event = "Unknown Component";
    }

    return result;
}

module.exports = decodeIntellitech;
