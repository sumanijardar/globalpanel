# GlobalPanel Project: Complete Architecture & Working Guide

## 1. Project Overview & Objective
**GlobalPanel** is a centralized Node.js-based middleware server. The main objective of this project is to act as a **Universal Bridge** between various types of security hardware alarm panels (like Intellitech, Securico, Mayur, etc.) and a central monitoring software.

Hardware panels send raw data (in different proprietary formats) when an alarm triggers. GlobalPanel receives this raw data, decodes it into a standard format, routes it based on priority, and saves it into a MySQL database (`esurv`). It also provides a single Universal API to check status and send commands to any panel, hiding the complexity of the underlying hardware protocols.

---

## 2. Complete Panel Working (Step-by-Step Workflow)

The complete working of the panel system can be broken down into the following phases:

### Phase 1: Server Initialization
1. When `universal_server.js` starts, it reads `server_config.json`.
2. It checks which panel protocols are enabled (e.g., `RUN_INTELLITECH: true`).
3. It calls the `startServer()` function for each enabled protocol. This starts either TCP socket servers or HTTP Webhook servers listening on specific ports for incoming hardware connections.
4. It starts the **Universal API Server** on port `3000`.
5. Simultaneously, `config/routing.js` connects to the database and fetches the routing rules from the `customer_alert_preferences` table. It caches these rules in memory and refreshes them every 5 minutes.

### Phase 2: Data Reception (Panel to Server)
1. A physical panel at a site (e.g., an Intellitech Goldbox panel) detects an intrusion or event.
2. The panel sends a payload over the internet to the GlobalPanel server.
3. The specific protocol handler (e.g., `protocols/intellitech.js`) receives this payload.
4. The handler extracts the Panel ID (`account`) and marks that panel as "Active/Connected" in its memory cache (`activeDevices`).

### Phase 3: Decoding (Raw Data to Standard Format)
1. The protocol handler passes the raw data to its corresponding decoder (e.g., `decoders/intellitech_decoder.js`).
2. The decoder reads the proprietary payload and maps it to a standard **SIA (Security Industry Association)** style format.
3. The decoder returns a standardized object containing:
   - `account`: Panel ID.
   - `code`: Alarm Code (e.g., "ZA" for Zone Alarm, "ZN" for Zone Normal).
   - `zone`: Which zone triggered the alarm (e.g., "402").
   - `event`: Human-readable string of what happened.
   - `formattedDate`: Exact time of the event.

### Phase 4: Routing & Database Storage
1. The protocol handler takes the standardized event object and checks the `panelConfigCache` (provided by `routing.js`).
2. It looks up the Panel ID and the Alarm Code to find out:
   - **Destination**: Should this go to the main `alerts` table (Front End) or `backalerts` table (Back End)?
   - **Level**: Is it a Level 1, Level 2, or Level 3 priority alarm?
   - **Priority**: 'Y' (Yes) or 'N' (No).
3. The handler inserts the event into the `alerts_copy` table (as a backup).
4. The handler inserts the event into the target table (`alerts` or `backalerts`) with the calculated priority and level.
5. The handler saves the event in a local `eventLog` array so it can be quickly served if the API requests recent events.

---

## 3. Core Modules & Function Definitions

Below is a detailed breakdown of the major modules and their specific functions.

### 3.1 Main Entry Point (`universal_server.js`)
This file orchestrates everything.
- **`handleRequest(account, action)`**: A helper function that acts as a unified router. When an API request comes in for a specific `account` (Panel ID), this function queries the `sites` database table to find the `Panel_Make`. Once it identifies the panel type, it routes the API request to the correct protocol handler module.
- **Universal API Routes**:
  - `GET /api/check`: Calls the `checkConnection` function of the specific protocol to see if the panel is online.
  - `GET /api/connect`: Forces a connection check or dial-up (if supported by the protocol).
  - `GET /api/command`: Calls the `queueCommand` function to send a command (like ARM/DISARM) to the panel.
  - `GET /api/events`: Calls the `getEvents` function to fetch recent alarms from memory.
  - `GET /api/status`: Calls `getStatus` across all protocols to get a list of all active panels.

### 3.2 Protocol Handlers (e.g., `protocols/intellitech.js`)
Each protocol file contains a standard set of functions required by the Universal Server.
- **`startServer()`**: Starts the actual receiver. For Intellitech, this creates an HTTP server on port 3001 to receive POST webhooks. For other panels, it might create `net.createServer()` for TCP sockets. It contains the logic for **Phase 2** and **Phase 4** (Receiving and DB Insertion).
- **`getEvents(account, lastIndex)`**: Returns events stored in the in-memory `eventLog` array for a specific panel.
- **`getStatus()`**: Iterates through the `activeDevices` map and returns a list of panels that have communicated within a specific timeframe (usually the last 2 minutes), marking them as 'connected'.
- **`checkConnection(account)`**: Checks if a specific panel is currently in the `activeDevices` map and hasn't timed out.
- **`queueCommand(account, command, zone, waitMs)`**: Used to send commands back to the hardware. (Note: For webhook-based panels like Intellitech, this might not be supported directly as webhooks are one-way).

### 3.3 Decoders (e.g., `decoders/intellitech_decoder.js`)
Decoders do not interact with the database or server ports; they are pure data transformation functions.
- **`decodeIntellitech(item, deviceId, dataDateStr)`**: The main function in the Intellitech decoder. 
  - **Functionality**: It takes a raw JSON status item (`{ id: 402, status: 1 }`). It formats the date string into a standard SQL timestamp. It uses `if/else` and `switch` statements to map the raw ID and status to an SIA code.
  - **Mapping Logic**: 
    - IDs starting with "4" (Zones): Status 1 = "ZA" (Zone Alarm), Status 0 = "ZN" (Zone Normal).
    - IDs starting with "3" (Sirens): Status 1 = "ON" (Siren Schedule On).
    - IDs starting with "2" (Relays): Status 1 = "ON" (Relay Schedule On).

### 3.4 Support Modules (`config/`)
- **`database.js`**: 
  - Exports a `mysql2/promise` connection pool named `pool`. This pool is used by all protocol handlers to execute queries like `INSERT INTO alerts`.
- **`routing.js`**: 
  - **`refreshCache()`**: An async function that runs a `SELECT` query on the `customer_alert_preferences` table. It loops through every row, parses comma-separated alarm codes, and builds a massive memory map (`panelConfigCache`). It uses `setInterval` to run itself automatically every 5 minutes so that if a user changes routing settings in the admin portal, the GlobalPanel server updates its logic without needing a restart.
