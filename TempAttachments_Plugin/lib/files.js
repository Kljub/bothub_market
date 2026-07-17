'use strict';

const path = require('path');
const crypto = require('crypto');

const PREFIX = 'plugin_tempattachments_plugin_';
const T_FILES = `\`${PREFIX}files\``;
const T_ROLES = `\`${PREFIX}allowed_roles\``;
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
    if (!_db) throw new Error('[tempattachments-plugin] Could not resolve core db module');
    return _db;
}

async function resolveBotId(clientId) {
    const { query } = getDb();
    const rows = await query('SELECT id FROM bots WHERE client_id = ? LIMIT 1', [clientId]);
    return rows[0]?.id ?? null;
}

// ── Passwort-Hashing (scrypt, Node-Bordmittel — kein externes Paket nötig) ──
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
    if (!stored) return true; // kein Passwort gesetzt
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    const check = crypto.scryptSync(password, salt, 64).toString('hex');
    try {
        return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
    } catch (_) {
        return false;
    }
}

async function createFile(botId, guildId, data) {
    const { query } = getDb();
    await query(
        `INSERT INTO ${T_FILES}
            (bot_id, guild_id, name, created_by, text_content, attachment_url, attachment_filename,
             password_hash, max_usages, one_per_user, starting_date, expiring_date)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
            botId, guildId, data.name, data.createdBy,
            data.textContent ?? null, data.attachmentUrl ?? null, data.attachmentFilename ?? null,
            data.password ? hashPassword(data.password) : null,
            data.maxUsages ?? null, data.onePerUser ? 1 : 0,
            data.startingDate ?? null, data.expiringDate ?? null,
        ]
    );
    return getFile(botId, guildId, data.name);
}

async function getFile(botId, guildId, name) {
    const { query } = getDb();
    const rows = await query(`SELECT * FROM ${T_FILES} WHERE bot_id = ? AND guild_id = ? AND name = ? LIMIT 1`, [botId, guildId, name]);
    return rows[0] ?? null;
}

async function getFileById(id) {
    const { query } = getDb();
    const rows = await query(`SELECT * FROM ${T_FILES} WHERE id = ? LIMIT 1`, [id]);
    return rows[0] ?? null;
}

async function deleteFile(botId, guildId, name) {
    const { query } = getDb();
    const file = await getFile(botId, guildId, name);
    if (!file) return false;
    await query(`DELETE FROM ${T_USAGE} WHERE file_id = ?`, [file.id]);
    await query(`DELETE FROM ${T_ROLES} WHERE file_id = ?`, [file.id]);
    await query(`DELETE FROM ${T_FILES} WHERE id = ?`, [file.id]);
    return true;
}

async function setMessageLocation(fileId, messageId, channelId) {
    const { query } = getDb();
    await query(`UPDATE ${T_FILES} SET message_id = ?, channel_id = ? WHERE id = ?`, [messageId, channelId, fileId]);
}

async function addAllowedRole(fileId, roleId) {
    const { query } = getDb();
    await query(`INSERT IGNORE INTO ${T_ROLES} (file_id, role_id) VALUES (?, ?)`, [fileId, roleId]);
}

async function removeAllowedRole(fileId, roleId) {
    const { query } = getDb();
    await query(`DELETE FROM ${T_ROLES} WHERE file_id = ? AND role_id = ?`, [fileId, roleId]);
}

async function getAllowedRoles(fileId) {
    const { query } = getDb();
    const rows = await query(`SELECT role_id FROM ${T_ROLES} WHERE file_id = ?`, [fileId]);
    return rows.map(r => r.role_id);
}

async function hasUsed(fileId, userId) {
    const { query } = getDb();
    const rows = await query(`SELECT 1 FROM ${T_USAGE} WHERE file_id = ? AND user_id = ? LIMIT 1`, [fileId, userId]);
    return rows.length > 0;
}

async function recordUsage(fileId, userId) {
    const { query } = getDb();
    await query(`INSERT INTO ${T_USAGE} (file_id, user_id) VALUES (?, ?)`, [fileId, userId]);
    await query(`UPDATE ${T_FILES} SET used_count = used_count + 1 WHERE id = ?`, [fileId]);
}

async function listFiles(botId, guildId) {
    const { query } = getDb();
    return query(`SELECT id, name FROM ${T_FILES} WHERE bot_id = ? AND guild_id = ? ORDER BY created_at DESC LIMIT 25`, [botId, guildId]);
}

/** Letzte per Owner erstellte Datei dieser Guild — Fallback für /tempfile-allowrole ohne name-Angabe. */
async function getLatestFileByCreator(botId, guildId, createdBy) {
    const { query } = getDb();
    const rows = await query(
        `SELECT * FROM ${T_FILES} WHERE bot_id = ? AND guild_id = ? AND created_by = ? ORDER BY created_at DESC LIMIT 1`,
        [botId, guildId, createdBy]
    );
    return rows[0] ?? null;
}

module.exports = {
    resolveBotId, hashPassword, verifyPassword,
    createFile, getFile, getFileById, deleteFile, setMessageLocation,
    addAllowedRole, removeAllowedRole, getAllowedRoles,
    hasUsed, recordUsage, getLatestFileByCreator, listFiles,
};
