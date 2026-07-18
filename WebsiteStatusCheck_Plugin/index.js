'use strict';

const path = require('path');
const monitor = require('./lib/monitor');

let _dbQuery = null;
function getDbQuery() {
    if (_dbQuery) return _dbQuery;
    const candidates = [
        path.resolve(__dirname, '../../core/src/plugin-runtime/db'),
        path.resolve(__dirname, '../../src/plugin-runtime/db'),
    ];
    for (const c of candidates) {
        try { _dbQuery = require(c).query; break; } catch (_) {}
    }
    return _dbQuery;
}

const STATUS_META = {
    green:  { emoji: '🟢', label: 'Online',  color: 0x22c55e },
    yellow: { emoji: '🟡', label: 'Warnung', color: 0xeab308 },
    red:    { emoji: '🔴', label: 'Offline', color: 0xef4444 },
};
const STATUS_RANK = { green: 0, yellow: 1, red: 2 }; // höher = schlimmer, für Aggregat-Farbe im Single-Embed-Modus

function statusLine(status, latencyMs) {
    const meta = STATUS_META[status];
    return `${meta.emoji} **${meta.label}**${latencyMs != null ? ` · ${latencyMs}ms` : ''}`;
}

module.exports = async function (bh) {
    bh.logger.info('Website Status Check Plugin geladen');

    async function runCheckCycle(botId) {
        const settings = await monitor.getSettings(botId);
        if (!settings || !settings.channel_id) {
            bh.logger.warn(`Website Status Check: bot ${botId} hat noch keinen Ziel-Channel konfiguriert — überspringe Check.`);
            return;
        }

        const sites = await monitor.listSites(botId);
        if (!sites.length) {
            bh.logger.info(`Website Status Check: bot ${botId} hat noch keine Webseiten konfiguriert — überspringe Check.`);
            return;
        }

        const results = [];
        for (const site of sites) {
            const { status, latencyMs } = await monitor.checkSite(bh, site.url);
            await monitor.recordCheck(site.id, status, latencyMs);
            results.push({ site, status, latencyMs });
        }

        // Discords <t:UNIX:R>-Format rendert client-seitig einen live mitlaufenden
        // Countdown ("in 5 Minuten" etc.) — kein eigener Re-Render-Timer nötig, das
        // Embed muss dafür nicht laufend neu bearbeitet werden.
        const nextCheckUnix = Math.floor((Date.now() + (settings.interval_minutes || 5) * 60_000) / 1000);
        // Einzeilig statt Feld (Name+Value wären 2 Zeilen) — steht oben in der
        // Description, da der Title-Slot schon vom Seiten-/Gruppennamen belegt ist.
        const nextCheckLine = `⏱️ **Nächster Check:** <t:${nextCheckUnix}:R>`;

        // Nur EIN Countdown über alle Embeds hinweg (sonst zeigt jede Seite/Gruppe
        // denselben Wert redundant an) — "Haupt Counter" ist die zuerst angelegte Seite
        // (results ist bereits nach sites.id ASC sortiert, also results[0] = älteste).
        // Liegt diese Seite in einer Gruppe, bekommt die Gruppe den Countdown, sonst die
        // Standalone-Seite selbst.
        const mainSite = results[0]?.site;
        const mainKey  = mainSite
            ? ((mainSite.group_name || '').trim() ? `group:${mainSite.group_name.trim()}` : `site:${mainSite.id}`)
            : null;

        // Sites mit gemeinsamem group_name teilen sich EIN Embed (Gruppen-Ansicht),
        // Sites ohne Gruppe (group_name NULL/leer) bekommen weiterhin ihr eigenes
        // Embed — ersetzt den alten globalen single/multi-Modus durch pro-Seite-Wahl.
        const grouped    = new Map(); // groupName -> results[]
        const standalone = [];
        for (const r of results) {
            const g = (r.site.group_name || '').trim();
            if (g) {
                if (!grouped.has(g)) grouped.set(g, []);
                grouped.get(g).push(r);
            } else {
                standalone.push(r);
            }
        }

        for (const { site, status, latencyMs } of standalone) {
            const isMain = mainKey === `site:${site.id}`;
            const payload = {
                embeds: [{
                    color: STATUS_META[status].color,
                    title: site.name,
                    description: isMain
                        ? `${nextCheckLine}\n${statusLine(status, latencyMs)}`
                        : statusLine(status, latencyMs),
                    timestamp: true,
                }],
            };
            await postOrEdit(botId, settings.channel_id, site.message_id, payload,
                (newId) => monitor.setSiteMessage(site.id, newId));
        }

        for (const [groupName, groupResults] of grouped) {
            const isMain = mainKey === `group:${groupName}`;
            const worst = groupResults.reduce((acc, r) => STATUS_RANK[r.status] > STATUS_RANK[acc] ? r.status : acc, 'green');
            const group = await monitor.getOrCreateGroup(botId, groupName);
            const descLines = [];
            if (isMain) descLines.push(nextCheckLine);
            if (group?.description) descLines.push(group.description);
            const payload = {
                embeds: [{
                    color: STATUS_META[worst].color,
                    title: `📡 ${groupName}`,
                    description: descLines.length ? descLines.join('\n') : undefined,
                    fields: groupResults.map(({ site, status, latencyMs }) => ({
                        name: site.name, value: statusLine(status, latencyMs), inline: false,
                    })),
                    timestamp: true,
                }],
            };
            await postOrEdit(botId, settings.channel_id, group?.message_id, payload,
                (newId) => monitor.setGroupMessage(group.id, newId));
        }

        await monitor.updateSettings(botId, { last_run_at: new Date() });
    }

    async function postOrEdit(botId, channelId, messageId, payload, onNewMessage) {
        if (messageId) {
            try {
                await bh.messaging.edit(channelId, messageId, payload);
                return;
            } catch (_) {
                // Nachricht wurde vermutlich gelöscht — neu posten und ID aktualisieren.
            }
        }
        try {
            const msg = await bh.messaging.send(channelId, payload);
            await onNewMessage(msg.id);
        } catch (e) {
            bh.logger.warn(`Website Status Check: Posten fehlgeschlagen (bot ${botId}): ${e.message}`);
        }
    }

    // Sofort-Trigger für das Dashboard — wird nach dem Hinzufügen einer Webseite
    // aufgerufen, damit der erste Check nicht bis zum nächsten 60s-Tick wartet.
    bh.http.post('/trigger', async (req, res) => {
        const botId = Number(req.body?.botId);
        if (!botId) { res.status(400).json({ ok: false, error: 'botId erforderlich' }); return; }
        try {
            await runCheckCycle(botId);
            res.json({ ok: true });
        } catch (e) {
            bh.logger.warn(`Website Status Check: Sofort-Trigger fehlgeschlagen (bot ${botId}): ${e.message}`);
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // Alle 60s prüfen, ob für irgendeinen Bot das konfigurierte Intervall abgelaufen ist —
    // vermeidet einen dynamisch neu zu erstellenden Timer pro Bot bei Intervall-Änderung
    // im Dashboard (nächster Tick liest die aktuellen Settings einfach neu).
    bh.scheduler.interval(60_000, async () => {
        const dbQuery = getDbQuery();
        if (!dbQuery) return;
        let rows;
        try {
            rows = await dbQuery('SELECT bot_id, interval_minutes, last_run_at FROM plugin_websitestatuscheck_plugin_settings');
        } catch (_) { return; }

        for (const row of rows) {
            const dueMs = (row.interval_minutes || 5) * 60_000;
            const lastRun = row.last_run_at ? new Date(row.last_run_at).getTime() : 0;
            if (Date.now() - lastRun < dueMs) continue;
            try { await runCheckCycle(row.bot_id); }
            catch (e) { bh.logger.warn(`Website Status Check: Check-Zyklus fehlgeschlagen (bot ${row.bot_id}): ${e.message}`); }
        }
    }, { key: 'websitestatuscheck-tick' });

    bh.plugin.onEnable(async () => { bh.logger.info('Website Status Check Plugin aktiviert'); });
    bh.plugin.onDisable(async () => { bh.logger.info('Website Status Check Plugin deaktiviert'); });
};
