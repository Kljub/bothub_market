'use strict';

const path = require('path');

const PREFIX = 'plugin_criminal_plugin_';
const T_SETTINGS = `\`${PREFIX}settings\``;

const DEFAULTS = { success_chance: 50.00, steal_percent: 20.00, fail_penalty_percent: 15.00 };

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
    if (!_db) throw new Error('[criminal-plugin] Could not resolve core db module');
    return _db;
}

async function resolveBotId(clientId) {
    const { query } = getDb();
    const rows = await query('SELECT id FROM bots WHERE client_id = ? LIMIT 1', [clientId]);
    return rows[0]?.id ?? null;
}

async function getSettings(botId) {
    const { query } = getDb();
    const rows = await query(`SELECT * FROM ${T_SETTINGS} WHERE bot_id = ? LIMIT 1`, [botId]);
    if (rows[0]) {
        const raw = rows[0].allowed_currencies;
        return {
            ...rows[0],
            success_chance: Number(rows[0].success_chance),
            steal_percent: Number(rows[0].steal_percent),
            fail_penalty_percent: Number(rows[0].fail_penalty_percent),
            allowed_currencies: typeof raw === 'string' ? JSON.parse(raw) : (raw ?? null),
        };
    }
    return { bot_id: botId, ...DEFAULTS, allowed_currencies: null };
}

async function saveSettings(botId, data) {
    const { query } = getDb();
    await query(
        `INSERT INTO ${T_SETTINGS} (bot_id, success_chance, steal_percent, fail_penalty_percent, allowed_currencies)
         VALUES (?,?,?,?,?)
         ON DUPLICATE KEY UPDATE success_chance = VALUES(success_chance), steal_percent = VALUES(steal_percent),
            fail_penalty_percent = VALUES(fail_penalty_percent), allowed_currencies = VALUES(allowed_currencies)`,
        [
            botId,
            Math.max(1, Math.min(99, Number(data.success_chance) || 50)),
            Math.max(1, Math.min(100, Number(data.steal_percent) || 20)),
            Math.max(0, Math.min(100, Number(data.fail_penalty_percent) || 15)),
            data.allowed_currencies && data.allowed_currencies.length ? JSON.stringify(data.allowed_currencies) : null,
        ]
    );
}

function currencyAllowed(settings, currencyKey) {
    if (!settings.allowed_currencies || !settings.allowed_currencies.length) return true;
    return settings.allowed_currencies.includes(currencyKey);
}

module.exports = { DEFAULTS, resolveBotId, getSettings, saveSettings, currencyAllowed };
