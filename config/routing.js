const pool = require('./database');

const panelConfigCache = new Map();

async function refreshCache() {
  try {
    const query = `
      SELECT 
        panelid, 
        alarm_code, 
        destination,
        level_1, 
        level_2, 
        level_3,
        priority
      FROM customer_alert_preferences
    `;
    const [rows] = await pool.query(query);

    panelConfigCache.clear();
    const toArray = (str) => (str ? str.split(',').map(s => s.trim()) : []);

    for (const row of rows) {
      if (row.panelid) {
        const pIdStr = String(row.panelid).trim();
        if (!panelConfigCache.has(pIdStr)) {
          panelConfigCache.set(pIdStr, []);
        }

        panelConfigCache.get(pIdStr).push({
          destination: row.destination,
          alarmCodeArr: toArray(row.alarm_code),
          level1Arr: toArray(row.level_1),
          level2Arr: toArray(row.level_2),
          level3Arr: toArray(row.level_3),
          rowPriority: row.priority || 'N'
        });
      }
    }
    console.log(`✅ Routing cache refreshed! Loaded config for ${panelConfigCache.size} unique panels.`);
  } catch (err) {
    console.error(`❌ Error refreshing cache: ${err.message}`);
  }
}

// Start auto-refresh interval (every 5 minutes)
refreshCache(); // Initial cache population
setInterval(refreshCache, 5 * 60 * 1000);

module.exports = {
  panelConfigCache,
  refreshCache
};
