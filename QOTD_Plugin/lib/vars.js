'use strict';

const path = require('path');

let _db = null;
function getDb() {
    if (_db) return _db;
    const candidates = [
        path.resolve(__dirname, '../../../core/src/plugin-runtime/db'),
        path.resolve(__dirname, '../../../src/plugin-runtime/db'),
    ];
    for (const c of candidates) { try { _db = require(c); break; } catch (_) {} }
    if (!_db) throw new Error('[qotd-plugin] Could not resolve core db module');
    return _db;
}

const VAR_PATTERN = /\{(PLUGIN_COUNT|BOT_COUNT|COMMAND_COUNT|STORE_PLUGIN_COUNT|OLDEST_PLUGIN|ENABLED_PLUGIN_COUNT)\}/g;

/** Nur die Werte berechnen, die im Fact-Text tatsächlich als {VAR} vorkommen —
 * vermeidet unnötige Queries bei Facts ohne jede Variable (der Normalfall). */
async function resolveVars(text, botId) {
    const needed = new Set();
    for (const m of text.matchAll(VAR_PATTERN)) needed.add(m[1]);
    if (needed.size === 0) return {};

    const { query } = getDb();
    const values = {};

    if (needed.has('PLUGIN_COUNT') || needed.has('STORE_PLUGIN_COUNT')) {
        const rows = await query('SELECT COUNT(*) c FROM installed_plugins');
        values.PLUGIN_COUNT = values.STORE_PLUGIN_COUNT = rows[0]?.c ?? 0;
    }
    if (needed.has('ENABLED_PLUGIN_COUNT')) {
        const rows = await query("SELECT COUNT(*) c FROM installed_plugins WHERE status = 'active'");
        values.ENABLED_PLUGIN_COUNT = rows[0]?.c ?? 0;
    }
    if (needed.has('BOT_COUNT')) {
        const rows = await query('SELECT COUNT(*) c FROM bots');
        values.BOT_COUNT = rows[0]?.c ?? 0;
    }
    if (needed.has('COMMAND_COUNT')) {
        const rows = await query('SELECT COUNT(DISTINCT module_key) c FROM bot_module_states WHERE bot_id = ?', [botId]);
        values.COMMAND_COUNT = rows[0]?.c ?? 0;
    }
    if (needed.has('OLDEST_PLUGIN')) {
        const rows = await query('SELECT name FROM installed_plugins ORDER BY installed_at ASC LIMIT 1');
        values.OLDEST_PLUGIN = rows[0]?.name ?? '—';
    }
    return values;
}

async function applyVars(text, botId) {
    const values = await resolveVars(text, botId);
    if (Object.keys(values).length === 0) return text;
    return text.replace(VAR_PATTERN, (match, key) => (key in values ? String(values[key]) : match));
}

module.exports = { applyVars };
