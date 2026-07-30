const mysql = require("mysql2/promise");
const pool = require("./config/database");

async function checkTables() {
    try {
        const [tables] = await pool.query("SHOW TABLES");
        console.log("Tables in DB:", tables.map(t => Object.values(t)[0]));
    } catch (err) {
        console.error("Error:", err.message);
    }
    process.exit();
}
checkTables();
