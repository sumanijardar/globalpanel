/**
 * smarti (ZICOM ATM G1 32 Zone) Protocol Decoder
 * Exclusively designed for Smart i panel messages according to the provided documentation.
 */

const ZONE_MAP = {
    "000": {
        "name": "AAP Tamper sensor",
        "alarmCode": "BA",
        "restoreCode": "BR"
    },
    "001": {
        "name": "ATM-1 Shutter Sensor",
        "alarmCode": "BA",
        "restoreCode": "BR"
    },
    "002": {
        "name": "ATM-1 Door Sensor",
        "alarmCode": "BA",
        "restoreCode": "BR"
    },
    "003": {
        "name": "ATM-1 Vibration Sensor",
        "alarmCode": "BA",
        "restoreCode": "BR"
    },
    "004": {
        "name": "Back Door Sensor",
        "alarmCode": "BA",
        "restoreCode": "BR"
    },
    "005": {
        "name": "ATM-2 Shutter Sensor",
        "alarmCode": "BA",
        "restoreCode": "BR"
    },
    "006": {
        "name": "ATM-2 Door  Sensor",
        "alarmCode": "BA",
        "restoreCode": "BR"
    },
    "007": {
        "name": "ATM-2 Vibration Sensor",
        "alarmCode": "BA",
        "restoreCode": "BR"
    },
    "008": {
        "name": "GPRS Backup card live Status",
        "alarmCode": "BA",
        "restoreCode": "BR"
    },
    "009": {
        "name": "ATM-3 Shutter Sensor",
        "alarmCode": "BA",
        "restoreCode": "BR"
    },
    "010": {
        "name": "ATM-3 Door Sensor",
        "alarmCode": "BA",
        "restoreCode": "BR"
    },
    "011": {
        "name": "ATM-3 Vibration Sensor",
        "alarmCode": "BA",
        "restoreCode": "BR"
    },
    "012": {
        "name": "Cheque drop box Shutter Sensor",
        "alarmCode": "BA",
        "restoreCode": "BR"
    },
    "013": {
        "name": "Cheque drop box door sensor",
        "alarmCode": "BA",
        "restoreCode": "BR"
    },
    "014": {
        "name": "Panic Switch Sensor",
        "alarmCode": "BA",
        "restoreCode": "BR"
    },
    "015": {
        "name": "Glass Break Sensor",
        "alarmCode": "BA",
        "restoreCode": "BR"
    },
    "016": {
        "name": "AC1 Contact Sensor",
        "alarmCode": "BA",
        "restoreCode": "BR"
    },
    "017": {
        "name": "AC2 Contact Sensor",
        "alarmCode": "BA",
        "restoreCode": "BR"
    },
    "018": {
        "name": "AC1,AC2 Compressor Contact sensor",
        "alarmCode": "BA",
        "restoreCode": "BR"
    },
    "019": {
        "name": "Key pad Tamper Sensor",
        "alarmCode": "BA",
        "restoreCode": "BR"
    },
    "020": {
        "name": "Combined Tamper Sensor",
        "alarmCode": "BA",
        "restoreCode": "BR"
    },
    "021": {
        "name": "Occupancy Sensor",
        "alarmCode": "BA",
        "restoreCode": "BR"
    },
    "022": {
        "name": "Front Door Sensor",
        "alarmCode": "BA",
        "restoreCode": "BR"
    },
    "023": {
        "name": "Spare",
        "alarmCode": "BA",
        "restoreCode": "BR"
    },
    "024": {
        "name": "CRA LOGIN  Button",
        "alarmCode": "BA",
        "restoreCode": "BR"
    },
    "025": {
        "name": "HK LOGIN  Button",
        "alarmCode": "BA",
        "restoreCode": "BR"
    },
    "026": {
        "name": "PATROl LOGIN Button",
        "alarmCode": "BA",
        "restoreCode": "BR"
    },
    "027": {
        "name": "AC Circuit -Auto/ Manual Feedback",
        "alarmCode": "BA",
        "restoreCode": "BR"
    },
    "028": {
        "name": "Light Circuit- Auto/ Manual Feedback",
        "alarmCode": "BA",
        "restoreCode": "BR"
    },
    "029": {
        "name": "Spare",
        "alarmCode": "BA",
        "restoreCode": "BR"
    },
    "030": {
        "name": "Spare",
        "alarmCode": "BA",
        "restoreCode": "BR"
    },
    "Not connected code": {
        "name": "Sensors Name",
        "alarmCode": "Alert Code",
        "restoreCode": "ormal Code"
    },
    "032": {
        "name": "Heat-1 Sensor                        ( Analog)",
        "alarmCode": "BA",
        "restoreCode": "BR"
    },
    "033": {
        "name": "Heat-2 Sensor (Analog)",
        "alarmCode": "BA",
        "restoreCode": "BR"
    },
    "NBD": {
        "name": "Smoke sensor",
        "alarmCode": "BA",
        "restoreCode": "BR"
    },
    "172": { "name": "EB Status", "alarmCode": "BA", "restoreCode": "BR" },
    "173": { "name": "UPS Fail", "alarmCode": "BA", "restoreCode": "BR" },
    "180": { "name": "Transaction Pending count", "alarmCode": "BR", "restoreCode": "BR" },
    "190": { "name": "Energy Meter Comm", "alarmCode": "BA", "restoreCode": "BR" },
    "191": { "name": "Login card", "alarmCode": "BA", "restoreCode": "BR" },
    "192": { "name": "UPS Card", "alarmCode": "BA", "restoreCode": "BR" },
    "193": { "name": "EIU card", "alarmCode": "BA", "restoreCode": "BR" },
    "194": { "name": "PM Card", "alarmCode": "BA", "restoreCode": "BR" },
    "195": { "name": "Arming card", "alarmCode": "BA", "restoreCode": "BR" },
    "200": { "name": "Temperature T1", "alarmCode": "YY", "restoreCode": "YY" },
    "204": { "name": "Light Intensity", "alarmCode": "YY", "restoreCode": "YY" },
    "205": { "name": "Input Ac Volt", "alarmCode": "YY", "restoreCode": "YY" },
    "206": { "name": "Output Ac Volt", "alarmCode": "YY", "restoreCode": "YY" },
    "207": { "name": "Ups Dc Volt", "alarmCode": "YY", "restoreCode": "YY" },
    "218": { "name": "Hooter Acknowledge", "alarmCode": "BA", "restoreCode": "BR" },
    "219": { "name": "Magnetic lock", "alarmCode": "BA", "restoreCode": "BR" },
    "220": { "name": "LBA Login", "alarmCode": "BA", "restoreCode": "BR" },
    "221": { "name": "CRA Login", "alarmCode": "BA", "restoreCode": "BR" },
    "222": { "name": "FLM/SLM Login", "alarmCode": "BA", "restoreCode": "BR" },
    "223": { "name": "CCA Login", "alarmCode": "BA", "restoreCode": "BR" },
    "224": { "name": "PO Login", "alarmCode": "BA", "restoreCode": "BR" },
    "225": { "name": "HK Login", "alarmCode": "BA", "restoreCode": "BR" },
    "226": { "name": "GM Login", "alarmCode": "BA", "restoreCode": "BR" },
    "227": { "name": "STM Login", "alarmCode": "BA", "restoreCode": "BR" },
    "228": { "name": "Wrong Id", "alarmCode": "YY", "restoreCode": "YY" },
    "300": { "name": "OTP server details", "alarmCode": "YY", "restoreCode": "YY" }
};

// Some generic SIA events from documentation in case of no zone match
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
    "OP": "System Opened"
};

/**
 * Decodes Smart-i SIA-DCS packet string
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
            const eventPart = parts[1]; // e.g., "NBA001" or "Nri0000/BA001"

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
            let matchedCustom = true;
            
            // SmartI 8IO ATM Event Codes specific mapping
            const e = eventPart;
            if (e === 'NZZ014') eventDesc = "System Restarted (Power On)";
            else if (e === 'NZZ027') eventDesc = "System Initialized with default settings";
            else if (e === 'NZZ025') eventDesc = "User Login through keypad with Valid Password";
            else if (e === 'NZZ123') eventDesc = "User Login through keypad with Invalid Password";
            else if (e === 'NZZ001') eventDesc = "Card Accepted / Authorized Access";
            else if (e === 'NZZ002') eventDesc = "Card Not Accepted / Unauthorized Access";
            else if (e === 'NCP001') eventDesc = "System Partial Arm";
            else if (e === 'NCF001') eventDesc = "Full System Arm";
            else if (e === 'NOF001') eventDesc = "Full System Disarm";
            else if (e === 'NCT001') eventDesc = "System Test Mode DeActive";
            else if (e === 'NOT001') eventDesc = "System Test Mode Active";
            else if (e === 'NOP055') eventDesc = "PT 100 PCB DISCONNECT";
            else if (e === 'NOR055') eventDesc = "PT 100 PCB CONNECT";
            else if (e === 'NRC001') eventDesc = "RTC Corruption Observed";
            else if (e === 'NBA060') eventDesc = "ACKNOWLEDGE";
            else if (e === 'NMF000') eventDesc = "Modbus Fail";
            else if (e === 'CHF002') eventDesc = "HDD Error";
            else if (e === 'CHF000') eventDesc = "HDD OK";
            else if (e.startsWith('NCL')) eventDesc = `System Arm for Zone No.- ${e.substring(3)}`;
            else if (e.startsWith('NOA')) eventDesc = `System Disarm for Zone No.- ${e.substring(3)}`;
            else if (e.startsWith('NCG')) eventDesc = `System Arm for InGroup No.- ${e.substring(3)}`;
            else if (e.startsWith('NOG')) eventDesc = `System Disarm for InGroup No.- ${e.substring(3)}`;
            else if (e.startsWith('NAG')) eventDesc = `System Auto Arm for InGroup No.- ${e.substring(3)}`;
            else if (e.startsWith('NDO')) eventDesc = `Intrusion/Force Door Open/Entry Dly Expired (Zone ${e.substring(3)})`;
            else if (e.startsWith('NTN')) eventDesc = `TEMP_ NORMAL`;
            else if (e.startsWith('NTH')) eventDesc = `TEMP_ HIGH`;
            else if (e.startsWith('NTL')) eventDesc = `TEMP_ LOW`;
            else if (e.startsWith('NMF')) eventDesc = `Masked Face Detected (Zone ${e.substring(3)})`;
            else if (e.startsWith('NGM')) eventDesc = `EVENT_GUARD_PATROL_MISS (Zone ${e.substring(3)})`;
            else if (e.startsWith('NZH')) eventDesc = `Output ${e.substring(3)} activated`;
            else if (e.startsWith('NZL')) eventDesc = `Output ${e.substring(3)} deactivated`;
            else if (e.startsWith('NZP')) eventDesc = `Pattern Output ${e.substring(3)}`;
            else if (e.startsWith('NNA')) eventDesc = `Network Alarm`;
            else if (e.startsWith('NZT')) eventDesc = `TimeBased Relay Reset`;
            else if (e.startsWith('NTA')) eventDesc = `Zone ${e.substring(3)} System Test Mode ON`;
            else if (e.startsWith('NTR')) eventDesc = `Zone ${e.substring(3)} System Test Mode OFF`;
            else if (e.startsWith('NOL') || e.startsWith(' NOL')) eventDesc = `Zone ${e.substring(e.length - 3)} open too long`;
            else if (e.startsWith('DDA')) eventDesc = `Duress Disarm Alert (Group/Zone ${e.substring(3)})`;
            else if (e.startsWith('NRA')) eventDesc = `AC ON feedback (AC ${e.substring(3)})`;
            else if (e.startsWith('NRR')) eventDesc = `AC OFF feedback (AC ${e.substring(3)})`;
            else if (e.startsWith('NMD')) eventDesc = `PIR detect in night Time (Zone ${e.substring(3)})`;
            else if (e.startsWith('CCB')) eventDesc = `Camera Mask Error (Cam ${e.substring(3)})`;
            else if (e.startsWith('CCO')) eventDesc = `Camera Mask Ok (Cam ${e.substring(3)})`;
            else if (e.startsWith('CNVF')) { 
                eventDesc = `Camera Video Loss (Cam ${e.substring(4)})`; 
                result.code = 'CN';
                result.zone = e.substring(4);
            }
            else if (e.startsWith('CNO')) eventDesc = `Camera Video OK (Cam ${e.substring(3)})`;
            else if (e.startsWith('SFC')) {
                eventDesc = `Shutter Force Close (Zone ${e.substring(3)})`;
                result.code = 'SF'; 
                result.zone = e.substring(3);
            }
            else if (e.startsWith('SNC')) {
                eventDesc = `Shutter Close (Zone ${e.substring(3)})`;
                result.code = 'SN'; 
                result.zone = e.substring(3);
            }
            else if (e.startsWith('NBA008')) eventDesc = "Signage light Off feedback";
            else if (e.startsWith('NBR008')) eventDesc = "Signage light ON feedback";
            else {
                matchedCustom = false;
            }

            // DO NOT TOUCH NHA AND NHR (Siren / Hooter)
            if (e.startsWith('NHA') || e.startsWith('NHR')) {
                matchedCustom = false;
            }

            if (!matchedCustom) {
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
            }

            result.event = eventDesc;
        }
    }

    return result;
}

decodeSIA.ZONE_MAP = ZONE_MAP;
decodeSIA.GENERIC_EVENTS = GENERIC_EVENTS;

module.exports = decodeSIA;
