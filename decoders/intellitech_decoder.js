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
        formattedDate: null,
        status: item.status
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
        switch (statusVal) {
            case 0: result.code = "ZN"; result.event = "Zone Normal"; break;
            case 1: result.code = "ZA"; result.event = "Zone Alarm"; break;
            case 5: result.code = "BA"; result.event = "Perimeter / Interior alarm"; break;
            case 6: result.code = "BR"; result.event = "Zone recovery (Delay/Perimeter/Interior)"; break;
            default: result.code = "XX"; result.event = `Unknown Zone Status (${statusVal})`; break;
        }
    } else if (idStr.startsWith("3")) {
        switch (statusVal) {
            case 1: result.code = "ON"; result.event = "Siren Schedule On"; break;
            case 2: result.code = "OF"; result.event = "Siren Schedule Off"; break;
            case 3: result.code = "FO"; result.event = "Siren Force On"; break;
            case 4: result.code = "FF"; result.event = "Siren Force Off"; break;
            case 5: result.code = "SCH"; result.event = "Siren In Schedule"; break;
            case 6: result.code = "RST"; result.event = "Siren Off for 10 Sec then On"; break;
            default: result.code = "XX"; result.event = `Unknown Siren Status (${statusVal})`; break;
        }
    } else if (idStr.startsWith("2")) {
        switch (statusVal) {
            case 1: result.code = "ON"; result.event = "Relay Schedule On"; break;
            case 2: result.code = "OF"; result.event = "Relay Schedule Off"; break;
            case 3: result.code = "FO"; result.event = "Relay Force On"; break;
            case 4: result.code = "FF"; result.event = "Relay Force Off"; break;
            case 5: result.code = "SCH"; result.event = "Relay In Schedule"; break;
            case 6: result.code = "RST"; result.event = "Relay Off for 10 Sec then On"; break;
            default: result.code = "XX"; result.event = `Unknown Relay Status (${statusVal})`; break;
        }
    } else {
        result.code = "XX";
        result.event = `Unknown Component (${idStr})`;
    }

    return result;
}

module.exports = decodeIntellitech;
