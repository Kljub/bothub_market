'use strict';

const crypto = require('crypto');
const { getCoreConfig } = require('./core-config');

// Mirrors web/functions/db.php's bh_encrypt()/bh_decrypt() exactly (AES-256-CBC,
// key = sha256(APP_KEY), random 16-byte IV prepended to ciphertext, base64, 'enc:'
// prefix) so tokens written by the PHP dashboard/link flow can be read here, and
// vice versa. Same algorithm as core/src/bot-manager.js's decryptToken().
function getAppKey() {
    return getCoreConfig().appKey;
}

function decrypt(value) {
    if (value == null) return value;
    const str = String(value);
    if (!str.startsWith('enc:')) return str;
    const raw = Buffer.from(str.slice(4), 'base64');
    const key = crypto.createHash('sha256').update(getAppKey()).digest();
    const iv  = raw.subarray(0, 16);
    const enc = raw.subarray(16);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    return decipher.update(enc, undefined, 'utf8') + decipher.final('utf8');
}

module.exports = { decrypt };
