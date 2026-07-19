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
    if (!_db) throw new Error('[anisearch-plugin] Could not resolve core db module');
    return _db;
}

async function resolveBotId(clientId) {
    const rows = await getDb().query('SELECT id FROM bots WHERE client_id = ? LIMIT 1', [clientId]);
    return rows[0]?.id ?? null;
}

async function getSettings(botId) {
    const rows = await getDb().query('SELECT * FROM plugin_anisearch_plugin_settings WHERE bot_id = ? LIMIT 1', [botId]);
    return rows[0] ?? null;
}

async function setChannel(botId, channelId) {
    await getDb().query(
        `INSERT INTO plugin_anisearch_plugin_settings (bot_id, channel_id) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE channel_id = VALUES(channel_id)`,
        [botId, channelId]
    );
}

async function listTracked(botId) {
    return getDb().query('SELECT * FROM plugin_anisearch_plugin_tracked WHERE bot_id = ? ORDER BY title ASC', [botId]);
}

async function isTracked(botId, anilistId) {
    const rows = await getDb().query(
        'SELECT id FROM plugin_anisearch_plugin_tracked WHERE bot_id = ? AND anilist_id = ? LIMIT 1',
        [botId, anilistId]
    );
    return !!rows[0];
}

async function addTracked(botId, anilistId, title, coverUrl, initialEpisode) {
    await getDb().query(
        `INSERT INTO plugin_anisearch_plugin_tracked (bot_id, anilist_id, title, cover_url, last_known_episode)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE title = VALUES(title), cover_url = VALUES(cover_url)`,
        [botId, anilistId, title, coverUrl, initialEpisode]
    );
}

async function removeTracked(botId, anilistId) {
    await getDb().query('DELETE FROM plugin_anisearch_plugin_tracked WHERE bot_id = ? AND anilist_id = ?', [botId, anilistId]);
}

async function updateLastKnownEpisode(id, episode) {
    await getDb().query('UPDATE plugin_anisearch_plugin_tracked SET last_known_episode = ? WHERE id = ?', [episode, id]);
}

async function listAllTrackedAcrossBots() {
    return getDb().query('SELECT * FROM plugin_anisearch_plugin_tracked', []);
}

module.exports = {
    resolveBotId, getSettings, setChannel, listTracked, isTracked, addTracked, removeTracked,
    updateLastKnownEpisode, listAllTrackedAcrossBots,
};
