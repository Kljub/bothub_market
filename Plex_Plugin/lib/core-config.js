'use strict';

const path = require('path');

// core/src/config.js lives at a different relative path in dev (/mnt/.../BotHub/core/src)
// vs. the Docker container (/app/src, per docker-compose's `./core/src:/app/src` mount)
// — same dual-candidate pattern as plugins/aichat-plugin/index.js's getDbQuery().
let _config = null;
function getCoreConfig() {
    if (_config) return _config;
    const candidates = [
        path.resolve(__dirname, '../../../core/src/config'),
        path.resolve(__dirname, '../../../src/config'),
    ];
    for (const c of candidates) {
        try { _config = require(c); break; } catch (_) {}
    }
    return _config ?? {};
}

// Domain-Entrypoint: admin-konfigurierbar unter /admin/settings?tab=general
// (app_settings.domain_entrypoint), fällt sonst auf DASHBOARD_BASE_URL (.env) über
// getCoreConfig() zurück — gleicher Vorrang wie web/functions/db.php::bh_domain_entrypoint().
async function getDashboardBaseUrl() {
    try {
        const { getDbQuery } = require('./raw-db');
        const dbQuery = getDbQuery();
        if (dbQuery) {
            const rows = await dbQuery("SELECT `value` FROM app_settings WHERE `key` = 'domain_entrypoint' LIMIT 1");
            const configured = (rows[0]?.value ?? '').trim().replace(/\/+$/, '');
            if (configured) return configured;
        }
    } catch (_) {}
    return (getCoreConfig().dashboardBaseUrl ?? '').replace(/\/+$/, '');
}

module.exports = { getCoreConfig, getDashboardBaseUrl };
