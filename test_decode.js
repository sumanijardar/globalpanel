const rpsString = "STARTRPS4440000099004400400040099999001099999901400END";

function decodePortStatus(message) {
    console.log("=== PORT/ZONE STATUS ===");
    const match = message.match(/STARTRPS(.*?)END/);
    if (!match) return console.log("Invalid RPS string");
    
    const statuses = match[1];
    const statusMap = {
        '0': 'Normal',
        '1': 'Alert',
        '2': 'Not connected',
        '3': 'Shorted',
        '4': 'Ack',
        '6': 'Reset',
        '9': 'Bypass',
        'A': 'Long open'
    };

    for (let i = 0; i < statuses.length; i++) {
        const char = statuses[i];
        const zoneNum = i + 1;
        const meaning = statusMap[char] || `Unknown (${char})`;
        console.log(`Zone ${String(zoneNum).padStart(2, '0')}: ${meaning} (Code: ${char})`);
    }
}

decodePortStatus(rpsString);
