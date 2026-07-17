'use strict';

const path = require('path');

const PREFIX = 'plugin_minesweeper_plugin_';
const T_SETTINGS = `\`${PREFIX}settings\``;

const DEFAULTS = { rtp: 97.00, min_bet: 10, max_bet: 1000 };

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
    if (!_db) throw new Error('[minesweeper-plugin] Could not resolve core db module');
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
            rtp: Number(rows[0].rtp),
            allowed_currencies: typeof raw === 'string' ? JSON.parse(raw) : (raw ?? null),
        };
    }
    return { bot_id: botId, enabled: 1, ...DEFAULTS, allowed_currencies: null };
}

async function saveSettings(botId, data) {
    const { query } = getDb();
    await query(
        `INSERT INTO ${T_SETTINGS} (bot_id, enabled, rtp, min_bet, max_bet, allowed_currencies)
         VALUES (?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), rtp = VALUES(rtp), min_bet = VALUES(min_bet),
            max_bet = VALUES(max_bet), allowed_currencies = VALUES(allowed_currencies)`,
        [
            botId, data.enabled ? 1 : 0,
            Math.max(10, Math.min(100, Number(data.rtp) || 97)),
            Math.max(1, parseInt(data.min_bet, 10) || 10),
            Math.max(1, parseInt(data.max_bet, 10) || 1000),
            data.allowed_currencies && data.allowed_currencies.length ? JSON.stringify(data.allowed_currencies) : null,
        ]
    );
}

function currencyAllowed(settings, currencyKey) {
    if (!settings.allowed_currencies || !settings.allowed_currencies.length) return true;
    return settings.allowed_currencies.includes(currencyKey);
}

module.exports = { DEFAULTS, resolveBotId, getSettings, saveSettings, currencyAllowed };
