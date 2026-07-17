'use strict';

const path = require('path');

const PREFIX = 'plugin_qotd_plugin_';
const T_FACTS = `\`${PREFIX}facts\``;
const T_USAGE = `\`${PREFIX}usage\``;

let _db = null;
function getDb() {
    if (_db) return _db;
    const candidates = [
        path.resolve(__dirname, '../../../core/src/plugin-runtime/db'),
        path.resolve(__dirname, '../../../src/plugin-runtime/db'),
    ];
    for (const c of candidates) {
        try { _db = require(c); break; } catch (_) {}
    }
    if (!_db) throw new Error('[qotd-plugin] Could not resolve core db module');
    return _db;
}

async function resolveBotId(clientId) {
    const { query } = getDb();
    const rows = await query('SELECT id FROM bots WHERE client_id = ? LIMIT 1', [clientId]);
    return rows[0]?.id ?? null;
}

async function listFacts(botId, { onlyEnabled = false } = {}) {
    const { query } = getDb();
    const sql = onlyEnabled
        ? `SELECT * FROM ${T_FACTS} WHERE bot_id = ? AND enabled = 1 ORDER BY id ASC`
        : `SELECT * FROM ${T_FACTS} WHERE bot_id = ? ORDER BY id ASC`;
    return query(sql, [botId]);
}

async function addFact(botId, text) {
    const { query } = getDb();
    await query(`INSERT INTO ${T_FACTS} (bot_id, text, enabled) VALUES (?,?,1)`, [botId, text]);
}

async function updateFact(botId, id, data) {
    const { query } = getDb();
    await query(`UPDATE ${T_FACTS} SET text = ?, enabled = ? WHERE id = ? AND bot_id = ?`, [data.text, data.enabled ? 1 : 0, id, botId]);
}

async function deleteFact(botId, id) {
    const { query } = getDb();
    await query(`DELETE FROM ${T_FACTS} WHERE id = ? AND bot_id = ?`, [id, botId]);
}

function pickRandom(facts) {
    return facts[Math.floor(Math.random() * facts.length)];
}

async function getUsage(botId, guildId, userId) {
    const { query } = getDb();
    const rows = await query(`SELECT last_used_date FROM ${T_USAGE} WHERE bot_id=? AND guild_id=? AND user_id=? LIMIT 1`, [botId, guildId, userId]);
    return rows[0]?.last_used_date ?? null;
}

async function markUsedToday(botId, guildId, userId) {
    const { query } = getDb();
    await query(
        `INSERT INTO ${T_USAGE} (bot_id, guild_id, user_id, last_used_date) VALUES (?,?,?,CURDATE())
         ON DUPLICATE KEY UPDATE last_used_date = CURDATE()`,
        [botId, guildId, userId]
    );
}

/** True wenn heute (Server-lokales Datum in MySQL) bereits benutzt wurde. */
async function usedToday(botId, guildId, userId) {
    const { query } = getDb();
    const rows = await query(
        `SELECT 1 FROM ${T_USAGE} WHERE bot_id=? AND guild_id=? AND user_id=? AND last_used_date = CURDATE() LIMIT 1`,
        [botId, guildId, userId]
    );
    return rows.length > 0;
}

module.exports = {
    resolveBotId, listFacts, addFact, updateFact, deleteFact, pickRandom,
    getUsage, markUsedToday, usedToday,
};
