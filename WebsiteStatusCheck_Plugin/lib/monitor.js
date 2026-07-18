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
    if (!_db) throw new Error('[websitestatuscheck-plugin] Could not resolve core db module');
    return _db;
}

const SLOW_THRESHOLD_MS = 1500;
const TIMEOUT_MS        = 8000;

async function getSettings(botId) {
    const rows = await getDb().query('SELECT * FROM plugin_websitestatuscheck_plugin_settings WHERE bot_id = ? LIMIT 1', [botId]);
    return rows[0] ?? null;
}

async function ensureSettings(botId) {
    const existing = await getSettings(botId);
    if (existing) return existing;
    await getDb().query('INSERT IGNORE INTO plugin_websitestatuscheck_plugin_settings (bot_id) VALUES (?)', [botId]);
    return getSettings(botId);
}

async function updateSettings(botId, fields) {
    const cols = Object.keys(fields);
    if (!cols.length) return;
    const sets = cols.map(c => `${c} = ?`).join(', ');
    await getDb().query(
        `UPDATE plugin_websitestatuscheck_plugin_settings SET ${sets} WHERE bot_id = ?`,
        [...cols.map(c => fields[c]), botId]
    );
}

async function listSites(botId) {
    return getDb().query('SELECT * FROM plugin_websitestatuscheck_plugin_sites WHERE bot_id = ? ORDER BY id ASC', [botId]);
}

async function setSiteMessage(siteId, messageId) {
    await getDb().query('UPDATE plugin_websitestatuscheck_plugin_sites SET message_id = ? WHERE id = ?', [messageId, siteId]);
}

/** Message-ID einer benannten Gruppe holen (für Edit-vs-neu-Posten), Zeile bei
 * Bedarf anlegen — Gruppen sind bot+name-eindeutig (siehe uq_bot_group). */
async function getOrCreateGroup(botId, groupName) {
    await getDb().query(
        'INSERT IGNORE INTO plugin_websitestatuscheck_plugin_groups (bot_id, name) VALUES (?, ?)',
        [botId, groupName]
    );
    const rows = await getDb().query(
        'SELECT id, message_id, description FROM plugin_websitestatuscheck_plugin_groups WHERE bot_id = ? AND name = ? LIMIT 1',
        [botId, groupName]
    );
    return rows[0] ?? null;
}

async function setGroupMessage(groupId, messageId) {
    await getDb().query('UPDATE plugin_websitestatuscheck_plugin_groups SET message_id = ? WHERE id = ?', [messageId, groupId]);
}

async function setGroupDescription(botId, groupName, description) {
    await getDb().query(
        'UPDATE plugin_websitestatuscheck_plugin_groups SET description = ? WHERE bot_id = ? AND name = ?',
        [description || null, botId, groupName]
    );
}

async function recordCheck(siteId, status, latencyMs) {
    await getDb().query(
        'UPDATE plugin_websitestatuscheck_plugin_sites SET last_status = ?, last_latency_ms = ?, last_checked_at = NOW() WHERE id = ?',
        [status, latencyMs, siteId]
    );
}

/** Fragt eine Webseite ab und klassifiziert das Ergebnis in grün/gelb/rot. */
async function checkSite(bh, url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const start = Date.now();
    try {
        const res = await bh.http.fetch(url, { method: 'GET', signal: controller.signal, redirect: 'follow' });
        const latencyMs = Date.now() - start;
        clearTimeout(timer);
        if (res.status >= 500) return { status: 'red', latencyMs };
        if (res.status >= 400) return { status: 'yellow', latencyMs };
        if (latencyMs > SLOW_THRESHOLD_MS) return { status: 'yellow', latencyMs };
        return { status: 'green', latencyMs };
    } catch (_) {
        clearTimeout(timer);
        return { status: 'red', latencyMs: null };
    }
}

module.exports = {
    getSettings, ensureSettings, updateSettings, listSites, setSiteMessage, recordCheck, checkSite,
    getOrCreateGroup, setGroupMessage, setGroupDescription,
};
