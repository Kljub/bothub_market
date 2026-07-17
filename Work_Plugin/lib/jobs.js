'use strict';

const path = require('path');

const PREFIX = 'plugin_work_plugin_';
const T_JOBS       = `\`${PREFIX}jobs\``;
const T_EMPLOYMENT = `\`${PREFIX}employment\``;

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
    if (!_db) throw new Error('[work-plugin] Could not resolve core db module');
    return _db;
}

async function resolveBotId(clientId) {
    const { query } = getDb();
    const rows = await query('SELECT id FROM bots WHERE client_id = ? LIMIT 1', [clientId]);
    return rows[0]?.id ?? null;
}

async function listJobs(botId, { onlyEnabled = false } = {}) {
    const { query } = getDb();
    const sql = onlyEnabled
        ? `SELECT * FROM ${T_JOBS} WHERE bot_id = ? AND enabled = 1 ORDER BY sort_order ASC, name ASC`
        : `SELECT * FROM ${T_JOBS} WHERE bot_id = ? ORDER BY sort_order ASC, name ASC`;
    return query(sql, [botId]);
}

async function getJob(botId, jobKey) {
    const { query } = getDb();
    const rows = await query(`SELECT * FROM ${T_JOBS} WHERE bot_id = ? AND job_key = ? LIMIT 1`, [botId, jobKey]);
    return rows[0] ?? null;
}

async function saveJob(botId, data) {
    const { query } = getDb();
    await query(
        `INSERT INTO ${T_JOBS} (bot_id, job_key, name, description, emoji, pay_min, pay_max, cooldown_seconds, currency_key, enabled, sort_order)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), emoji = VALUES(emoji),
            pay_min = VALUES(pay_min), pay_max = VALUES(pay_max), cooldown_seconds = VALUES(cooldown_seconds),
            currency_key = VALUES(currency_key), enabled = VALUES(enabled), sort_order = VALUES(sort_order)`,
        [
            botId, data.job_key, data.name, data.description ?? '', data.emoji || '💼',
            Math.max(0, parseInt(data.pay_min, 10) || 0),
            Math.max(1, parseInt(data.pay_max, 10) || 1),
            Math.max(1, parseInt(data.cooldown_seconds, 10) || 3600),
            data.currency_key || null,
            data.enabled ? 1 : 0,
            parseInt(data.sort_order, 10) || 0,
        ]
    );
}

async function deleteJob(botId, jobKey) {
    const { query } = getDb();
    await query(`DELETE FROM ${T_EMPLOYMENT} WHERE bot_id = ? AND job_key = ?`, [botId, jobKey]);
    await query(`DELETE FROM ${T_JOBS} WHERE bot_id = ? AND job_key = ?`, [botId, jobKey]);
}

async function getEmployment(botId, guildId, userId) {
    const { query } = getDb();
    const rows = await query(`SELECT * FROM ${T_EMPLOYMENT} WHERE bot_id=? AND guild_id=? AND user_id=? LIMIT 1`, [botId, guildId, userId]);
    return rows[0] ?? null;
}

async function setEmployment(botId, guildId, userId, jobKey) {
    const { query } = getDb();
    await query(
        `INSERT INTO ${T_EMPLOYMENT} (bot_id, guild_id, user_id, job_key, hired_at) VALUES (?,?,?,?,NOW())
         ON DUPLICATE KEY UPDATE job_key = VALUES(job_key), last_worked_at = NULL, hired_at = NOW()`,
        [botId, guildId, userId, jobKey]
    );
}

async function clearEmployment(botId, guildId, userId) {
    const { query } = getDb();
    await query(`DELETE FROM ${T_EMPLOYMENT} WHERE bot_id=? AND guild_id=? AND user_id=?`, [botId, guildId, userId]);
}

async function markWorked(botId, guildId, userId) {
    const { query } = getDb();
    await query(`UPDATE ${T_EMPLOYMENT} SET last_worked_at = NOW() WHERE bot_id=? AND guild_id=? AND user_id=?`, [botId, guildId, userId]);
}

module.exports = {
    resolveBotId, listJobs, getJob, saveJob, deleteJob,
    getEmployment, setEmployment, clearEmployment, markWorked,
};
