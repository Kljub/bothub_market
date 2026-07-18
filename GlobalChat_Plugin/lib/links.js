'use strict';

const path = require('path');

const PREFIX = 'plugin_globalchat_plugin_';
const T_LINKS = `\`${PREFIX}links\``;
const T_USERS = `\`${PREFIX}users\``;
const T_RELAY = `\`${PREFIX}relay_map\``;

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
    if (!_db) throw new Error('[globalchat-plugin] Could not resolve core db module');
    return _db;
}

async function resolveBotId(clientId) {
    const { query } = getDb();
    const rows = await query('SELECT id FROM bots WHERE client_id = ? LIMIT 1', [clientId]);
    return rows[0]?.id ?? null;
}

async function getLinkForGuild(botId, guildId) {
    const { query } = getDb();
    const rows = await query(`SELECT * FROM ${T_LINKS} WHERE bot_id = ? AND guild_id = ? LIMIT 1`, [botId, guildId]);
    return rows[0] ?? null;
}

async function getLinkForChannel(botId, channelId) {
    const { query } = getDb();
    const rows = await query(`SELECT * FROM ${T_LINKS} WHERE bot_id = ? AND channel_id = ? AND enabled = 1 LIMIT 1`, [botId, channelId]);
    return rows[0] ?? null;
}

/** Alle anderen aktiven Links desselben Bots (zum Relayen), außer der Quell-Guild. */
async function getOtherLinks(botId, excludeGuildId) {
    const { query } = getDb();
    return query(`SELECT * FROM ${T_LINKS} WHERE bot_id = ? AND guild_id != ? AND enabled = 1`, [botId, excludeGuildId]);
}

async function setLink(botId, guildId, channelId) {
    const { query } = getDb();
    await query(
        `INSERT INTO ${T_LINKS} (bot_id, guild_id, channel_id, enabled) VALUES (?,?,?,1)
         ON DUPLICATE KEY UPDATE channel_id = VALUES(channel_id), enabled = 1`,
        [botId, guildId, channelId]
    );
}

async function removeLink(botId, guildId) {
    const { query } = getDb();
    await query(`DELETE FROM ${T_LINKS} WHERE bot_id = ? AND guild_id = ?`, [botId, guildId]);
}

/** Merkt sich Sender für die @username-Erwähnungssuche — wird bei jeder
 * relayten Nachricht aktualisiert, damit der Username immer aktuell ist. */
async function upsertUser(botId, userId, username) {
    const { query } = getDb();
    await query(
        `INSERT INTO ${T_USERS} (bot_id, user_id, username) VALUES (?,?,?)
         ON DUPLICATE KEY UPDATE username = VALUES(username)`,
        [botId, userId, username]
    );
}

/** Case-insensitive Username-Lookup für die @mention-Erkennung im Relay. */
async function findUsersByUsernames(botId, usernamesLower) {
    if (!usernamesLower.length) return [];
    const { query } = getDb();
    const placeholders = usernamesLower.map(() => '?').join(',');
    return query(
        `SELECT user_id, username FROM ${T_USERS} WHERE bot_id = ? AND LOWER(username) IN (${placeholders})`,
        [botId, ...usernamesLower]
    );
}

/** Verknüpft eine (Channel, Message)-Kopie mit einer Relay-Gruppe — jede Nachricht
 * (Original + jede weitergeleitete Kopie in den Ziel-Channels) bekommt eine Zeile
 * mit demselben group_key, damit eine spätere Discord-Reply auf IRGENDEINE Kopie
 * die passende Kopie in jedem anderen Channel findet. */
async function recordRelayMapping(botId, groupKey, channelId, messageId) {
    const { query } = getDb();
    await query(
        `INSERT IGNORE INTO ${T_RELAY} (bot_id, group_key, channel_id, message_id) VALUES (?,?,?,?)`,
        [botId, groupKey, channelId, messageId]
    );
}

/** group_key einer bereits bekannten (Channel, Message)-Kopie finden — genutzt um
 * zu erkennen, ob eine neue Nachricht eine Discord-Reply auf eine Relay-Nachricht ist. */
async function findGroupKeyForMessage(botId, channelId, messageId) {
    const { query } = getDb();
    const rows = await query(
        `SELECT group_key FROM ${T_RELAY} WHERE bot_id = ? AND channel_id = ? AND message_id = ? LIMIT 1`,
        [botId, channelId, messageId]
    );
    return rows[0]?.group_key ?? null;
}

/** Alle bekannten (Channel -> Message)-Kopien einer Relay-Gruppe — zum Auflösen,
 * auf welche lokale Kopie in einem bestimmten Ziel-Channel geantwortet werden soll. */
async function getRelayMapForGroup(botId, groupKey) {
    const { query } = getDb();
    const rows = await query(
        `SELECT channel_id, message_id FROM ${T_RELAY} WHERE bot_id = ? AND group_key = ?`,
        [botId, groupKey]
    );
    const map = new Map();
    for (const r of rows) map.set(r.channel_id, r.message_id);
    return map;
}

module.exports = {
    resolveBotId, getLinkForGuild, getLinkForChannel, getOtherLinks, setLink, removeLink,
    upsertUser, findUsersByUsernames,
    recordRelayMapping, findGroupKeyForMessage, getRelayMapForGroup,
};
