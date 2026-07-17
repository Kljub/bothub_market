<?php
declare(strict_types=1);
if (!defined('BH_ROOT')) exit;

require_once BH_ROOT . '/functions/modules/plex.php';
require_once BH_ROOT . '/functions/modules/builder_shared.php';

echo '<link rel="stylesheet" href="/assets/css/components-base.css?v=' . filemtime(BH_ROOT . '/assets/css/components-base.css') . '">';

$botId = (int)($context['botId'] ?? $_SESSION['current_bot_id'] ?? 0);
$csrf  = (string)($_SESSION['csrf_token'] ?? '');
$esc   = fn(string $s): string => htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');

$clientId = '';
if ($botId > 0) {
    try {
        $stmt = bh_db()->prepare('SELECT client_id FROM bots WHERE id = ? LIMIT 1');
        $stmt->execute([$botId]);
        $clientId = (string)($stmt->fetchColumn() ?: '');
    } catch (Throwable) {}
}

$settings = $clientId !== '' ? bh_plex_get_settings($clientId) : null;
$serverUrl      = (string)($settings['plex_server_url'] ?? '');
$hasAdminToken  = !empty($settings['plex_admin_token_enc']);
$overseerrUrl   = (string)($settings['overseerr_url'] ?? '');
$hasOverseerrKey = !empty($settings['overseerr_api_key_enc']);
$webhookSecret  = (string)($settings['webhook_secret'] ?? '');

$dashboardBaseUrl = bh_domain_entrypoint();

// ── Guilds + aktive Guild ───────────────────────────────────────────────────
$guilds  = [];
$guildId = trim((string)($_GET['guild_id'] ?? ''));
if ($botId > 0) {
    try { $guilds = bh_get_bot_guilds($botId, (int)($_SESSION['user_id'] ?? 0)); } catch (Throwable) {}
}
if ($guildId === '' && !empty($guilds)) $guildId = (string)($guilds[0]['id'] ?? '');
if ($guildId !== '' && !in_array($guildId, array_column($guilds, 'id'), true)) $guildId = '';

$guildSettings = ($clientId !== '' && $guildId !== '') ? bh_plex_get_guild_settings($clientId, $guildId) : null;
$guildEnabled  = $guildSettings !== null;

// Library-Sections + Titel-Mapping (für Tag-Anzeige + Datalist)
$librarySections = [];
if ($settings && !empty($settings['plex_server_url']) && !empty($settings['plex_admin_token_enc'])) {
    $librarySections = bh_plex_fetch_library_sections(
        (string)$settings['plex_server_url'],
        bh_decrypt((string)$settings['plex_admin_token_enc'])
    );
}
$libraryTitleById = [];
foreach ($librarySections as $s) { $libraryTitleById[$s['id']] = $s['title']; }

// ── Command-Permissions laden ────────────────────────────────────────────────
$commands = [
    'link'            => ['label' => '/link', 'desc' => 'Plex-Account mit Discord verknüpfen'],
    'unlink'          => ['label' => '/unlink', 'desc' => 'Verknüpfung entfernen'],
    'plex-recommend'  => ['label' => '/plex-recommend', 'desc' => 'Empfehlung basierend auf Watch-History'],
    'plex-status'     => ['label' => '/plex-status', 'desc' => 'Server-Status anzeigen (Hidden/Public wählbar)'],
    'plex-nowplaying' => ['label' => '/plex-nowplaying', 'desc' => 'Aktive Wiedergaben anzeigen'],
    'plex-search'     => ['label' => '/plex-search', 'desc' => 'Bibliotheks-Suche'],
    'plex-request'    => ['label' => '/plex-request', 'desc' => 'Anfrage über Overseerr stellen'],
    'plex-random'     => ['label' => '/plex-random', 'desc' => 'Zufälliger Vorschlag mit Reroll'],
];
$cmdStates = [];
if ($botId > 0) {
    foreach (array_keys($commands) as $key) {
        $moduleKey = 'plex:' . $key;
        bh_db()->prepare('INSERT IGNORE INTO bot_module_states (bot_id, module_key, enabled) VALUES (?, ?, 1)')
               ->execute([$botId, $moduleKey]);
        $stmt = bh_db()->prepare('SELECT enabled, settings FROM bot_module_states WHERE bot_id = ? AND module_key = ? LIMIT 1');
        $stmt->execute([$botId, $moduleKey]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];
        $cmdStates[$key] = [
            'enabled'  => (bool)($row['enabled'] ?? true),
            'settings' => json_decode($row['settings'] ?? '{}', true) ?: [],
        ];
    }
}

$discordPerms = [
    'Administrator'   => 'Administrator',
    'ManageGuild'     => 'Server verwalten',
    'ManageRoles'     => 'Rollen verwalten',
    'ManageChannels'  => 'Kanäle verwalten',
    'KickMembers'     => 'Mitglieder kicken',
    'BanMembers'      => 'Mitglieder bannen',
    'ManageMessages'  => 'Nachrichten verwalten',
    'ModerateMembers' => 'Mitglieder per Timeout sperren',
];
?>
<style>
.bh-module-row { border-bottom: 1px solid var(--border); }
.bh-module-row:last-child { border-bottom: none; }
.bh-toggle { position: relative; display: inline-flex; cursor: pointer; flex-shrink: 0; }
.bh-toggle input { position: absolute; opacity: 0; width: 0; height: 0; }
.bh-toggle-track { width: 36px; height: 20px; background: var(--border-bright); border-radius: 10px; transition: background .2s; display: flex; align-items: center; padding: 2px; }
.bh-toggle input:checked ~ .bh-toggle-track { background: var(--toggle-color, var(--accent)); }
.bh-toggle-thumb { width: 16px; height: 16px; background: #fff; border-radius: 50%; transition: transform .2s; box-shadow: 0 1px 3px rgba(0,0,0,.3); }
.bh-toggle input:checked ~ .bh-toggle-track .bh-toggle-thumb { transform: translateX(16px); }
.bh-perm-btn.has-perms { border-color: #3b82f6 !important; color: #3b82f6 !important; background: #3b82f610 !important; }
</style>

<?php if ($botId <= 0): ?>
    <div class="bh-alert bh-alert-error">Kein Bot ausgewählt. Bitte zuerst einen Bot im Dashboard wählen.</div>
<?php else: ?>

<div id="plex-alert" class="bh-alert" style="display:none"></div>

<!-- ── Plex-Server + Overseerr ──────────────────────────────────────────── -->
<div class="bh-card bh-card-flush" style="margin-bottom:20px;">
    <div class="bh-card-title">Plex-Server</div>
    <div class="bh-card-content" style="display:flex;flex-direction:column;gap:16px;">
        <div style="display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap;">
            <div style="flex:1;min-width:160px;"><div class="bh-label">Server-URL</div>
                <div class="bh-hint" style="margin-top:3px;">z.B. http://192.168.1.10:32400</div></div>
            <div style="flex:2;min-width:220px;">
                <input type="text" id="plex-server-url" class="bh-input" style="width:100%;"
                       value="<?= $esc($serverUrl) ?>" placeholder="http://plex-server:32400">
            </div>
        </div>
        <div style="display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap;">
            <div style="flex:1;min-width:160px;"><div class="bh-label">Admin-Token</div>
                <div class="bh-hint" id="plex-admin-token-hint" style="margin-top:3px;"><?= $hasAdminToken ? 'Bereits gesetzt — leer lassen um beizubehalten.' : 'Noch nicht gesetzt.' ?></div></div>
            <div style="flex:2;min-width:220px;display:flex;gap:8px;">
                <input type="password" id="plex-admin-token" class="bh-input" style="flex:1;font-family:monospace;"
                       placeholder="<?= $hasAdminToken ? '••••••••' : 'X-Plex-Token' ?>" autocomplete="off" spellcheck="false">
                <button type="button" class="bh-btn bh-btn-ghost plex-eye-btn" data-target="plex-admin-token" style="padding:6px 10px;">👁</button>
                <button type="button" id="plex-oauth-btn" class="bh-btn bh-btn-ghost" style="padding:6px 12px;white-space:nowrap;">🔑 Mit Plex.tv verbinden</button>
            </div>
        </div>
        <?php if ($hasAdminToken): ?>
        <div style="display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap;">
            <div style="flex:1;min-width:160px;"><div class="bh-label">Server-Erkennung</div>
                <div class="bh-hint" style="margin-top:3px;">Statt IP von Hand: Server über Plex.tv finden — auch über die Standard-Domain per Relay erreichbar, wenn keine lokale Verbindung möglich ist.</div></div>
            <div style="flex:2;min-width:220px;">
                <button type="button" id="plex-find-servers-btn" class="bh-btn bh-btn-ghost" style="margin-bottom:8px;">🔍 Verfügbare Server laden</button>
                <select id="plex-server-select" class="bh-input" style="width:100%;display:none;"></select>
            </div>
        </div>
        <?php endif; ?>
        <div style="display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap;">
            <div style="flex:1;min-width:160px;"><div class="bh-label">Overseerr-URL</div></div>
            <div style="flex:2;min-width:220px;">
                <input type="text" id="plex-overseerr-url" class="bh-input" style="width:100%;"
                       value="<?= $esc($overseerrUrl) ?>" placeholder="http://overseerr:5055 (optional)">
            </div>
        </div>
        <div style="display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap;">
            <div style="flex:1;min-width:160px;"><div class="bh-label">Overseerr-API-Key</div>
                <div class="bh-hint" style="margin-top:3px;"><?= $hasOverseerrKey ? 'Bereits gesetzt — leer lassen um beizubehalten.' : 'Optional, für /plex-request.' ?></div></div>
            <div style="flex:2;min-width:220px;display:flex;gap:8px;">
                <input type="password" id="plex-overseerr-key" class="bh-input" style="flex:1;font-family:monospace;"
                       placeholder="<?= $hasOverseerrKey ? '••••••••' : 'API-Key' ?>" autocomplete="off" spellcheck="false">
                <button type="button" class="bh-btn bh-btn-ghost plex-eye-btn" data-target="plex-overseerr-key" style="padding:6px 10px;">👁</button>
            </div>
        </div>

        <?php if ($webhookSecret !== ''): ?>
        <div style="border-top:1px solid var(--border);padding-top:16px;">
            <div class="bh-label">Webhook-URLs</div>
            <div class="bh-hint" style="margin:4px 0 8px;">In Plex (Webhooks-Settings) bzw. Overseerr (Notifications → Webhook Agent) eintragen.</div>
            <code style="display:block;font-size:11px;background:var(--bg-hover);padding:6px 8px;border-radius:4px;margin-bottom:6px;word-break:break-all;"><?= $esc($dashboardBaseUrl) ?>/webhooks/plex/media/<?= $esc($webhookSecret) ?></code>
            <code style="display:block;font-size:11px;background:var(--bg-hover);padding:6px 8px;border-radius:4px;word-break:break-all;"><?= $esc($dashboardBaseUrl) ?>/webhooks/plex/overseerr/<?= $esc($webhookSecret) ?></code>
            <button type="button" class="bh-btn bh-btn-ghost" id="plex-regen-secret-btn" style="margin-top:8px;font-size:12px;">Secret neu generieren</button>
        </div>
        <?php endif; ?>

        <div style="display:flex;justify-content:flex-end;">
            <button type="button" id="plex-save-settings-btn" class="bh-btn bh-btn-primary" style="min-width:120px;">Speichern</button>
        </div>
    </div>
</div>

<!-- ── Server-Freigabe + Guild-Konfiguration ────────────────────────────── -->
<div class="bh-card bh-card-flush" style="margin-bottom:20px;">
    <div class="bh-card-title">Server-Freigabe</div>
    <div class="bh-card-content" style="display:flex;flex-direction:column;gap:16px;">
        <select id="plex-guild-select" class="bh-input" style="max-width:320px;">
            <option value="">— Server auswählen —</option>
            <?php foreach ($guilds as $g): ?>
            <option value="<?= $esc((string)$g['id']) ?>" <?= $g['id'] === $guildId ? 'selected' : '' ?>><?= $esc((string)$g['name']) ?></option>
            <?php endforeach; ?>
        </select>

        <?php if ($guildId !== ''): ?>
        <label class="bh-toggle" style="--toggle-color:var(--color-primary);">
            <input type="checkbox" id="plex-guild-enabled" <?= $guildEnabled ? 'checked' : '' ?>>
            <span class="bh-toggle-track"><span class="bh-toggle-thumb"></span></span>
        </label>
        <span style="font-size:12px;color:var(--text-muted);margin-left:-8px;">Plex-Plugin für diesen Server freigeschaltet</span>

        <div id="plex-guild-panel" style="<?= $guildEnabled ? '' : 'display:none;opacity:.5;pointer-events:none;' ?>display:flex;flex-direction:column;gap:14px;border-top:1px solid var(--border);padding-top:14px;">
            <div style="display:flex;gap:20px;flex-wrap:wrap;">
                <div style="flex:1;min-width:200px;">
                    <div class="bh-label">Neue-Inhalte-Channel</div>
                    <select id="plex-new-content-channel" class="bh-input" style="width:100%;margin-top:4px;"><option value="">— Kein Channel —</option></select>
                </div>
                <div style="flex:1;min-width:200px;">
                    <div class="bh-label">Live-Status-Channel</div>
                    <select id="plex-live-status-channel" class="bh-input" style="width:100%;margin-top:4px;"><option value="">— Kein Channel —</option></select>
                </div>
                <div style="flex:1;min-width:200px;">
                    <div class="bh-label">Verknüpft-Rolle</div>
                    <select id="plex-linked-role" class="bh-input" style="width:100%;margin-top:4px;"><option value="">— Keine Rolle —</option></select>
                </div>
            </div>
            <div>
                <div class="bh-label">Freigegebene Bibliotheken <span style="font-weight:400;color:var(--text-muted);">(leer = nichts freigegeben)</span></div>
                <div class="bh-tag-input" id="plex-libraries" data-field="allowed_library_ids" style="margin-top:4px;">
                    <?php foreach (($guildSettings['allowed_library_ids'] ?? []) as $libId): ?>
                    <span class="bh-tag" data-value="<?= $esc((string)$libId) ?>"><?= $esc($libraryTitleById[$libId] ?? $libId) ?><button onclick="bhRemoveTag(this)">×</button></span>
                    <?php endforeach; ?>
                    <input type="text" list="plex-libs-datalist" placeholder="Bibliothek hinzufügen..." onkeydown="plexAddLibraryTag(event,this)" autocomplete="off">
                </div>
                <datalist id="plex-libs-datalist">
                    <?php foreach ($librarySections as $s): ?>
                    <option value="<?= $esc($s['title']) ?>" data-id="<?= $esc($s['id']) ?>"><?= $esc($s['title']) ?></option>
                    <?php endforeach; ?>
                </datalist>
                <?php if (empty($guildSettings['allowed_library_ids'])): ?>
                <div class="bh-alert bh-alert-warn" style="margin-top:8px;font-size:12px;">Keine Bibliotheken freigegeben — Commands finden keine Ergebnisse bis mindestens eine Bibliothek gewählt wird.</div>
                <?php endif; ?>
            </div>
            <div style="display:flex;justify-content:flex-end;">
                <button type="button" id="plex-save-guild-btn" class="bh-btn bh-btn-primary" style="min-width:120px;">Server-Einstellungen speichern</button>
            </div>
        </div>
        <?php endif; ?>
    </div>
</div>

<!-- ── Commands ─────────────────────────────────────────────────────────── -->
<div class="bh-card bh-card-flush" style="margin-bottom:20px;">
    <div class="bh-card-title">Commands</div>
    <div>
    <?php foreach ($commands as $key => $meta):
        $moduleKey = 'plex:' . $key;
        $state     = $cmdStates[$key] ?? ['enabled' => true, 'settings' => []];
        $hasPerms  = !empty($state['settings']['allowed_roles']) || !empty($state['settings']['banned_roles'])
                  || !empty($state['settings']['banned_channels']) || !empty($state['settings']['required_permissions']);
        $panelId   = 'perm-plex-' . $key;
    ?>
        <div class="bh-module-row">
            <div style="display:flex;align-items:center;gap:12px;padding:10px 16px;">
                <div style="flex:1;overflow:hidden;">
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                        <code style="font-size:11px;color:var(--accent-bright);background:var(--bg-hover);padding:2px 7px;border-radius:var(--radius-sm);"><?= $esc($meta['label']) ?></code>
                    </div>
                    <div style="font-size:11px;color:var(--text-muted);margin-top:2px;"><?= $esc($meta['desc']) ?></div>
                </div>
                <button class="bh-perm-btn <?= $hasPerms ? 'has-perms' : '' ?>" title="Berechtigungen" onclick="bhTogglePerms('<?= $panelId ?>')">
                    <svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13"><path d="M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.464 1.464 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311c.446.82.023 1.841-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.464 1.464 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.464 1.464 0 0 1 2.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.464 1.464 0 0 1 2.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.464 1.464 0 0 1 .872-2.105l.34-.1c1.4-.413 1.4-2.397 0-2.81l-.34-.1a1.464 1.464 0 0 1-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.464 1.464 0 0 1-2.105-.872l-.1-.34zM8 10.93a2.929 2.929 0 1 1 0-5.86 2.929 2.929 0 0 1 0 5.858z"/></svg>
                </button>
                <label class="bh-toggle" style="--toggle-color:#3b82f6;">
                    <input type="checkbox" class="bh-cmd-toggle" <?= $state['enabled'] ? 'checked' : '' ?>
                           onchange="bhToggleMod('<?= $esc($moduleKey) ?>', this.checked, this, true)">
                    <span class="bh-toggle-track"><span class="bh-toggle-thumb"></span></span>
                </label>
            </div>
            <?php
            $permModuleKey    = $moduleKey;
            $permPanelId      = $panelId;
            $permCfg          = $state['settings'];
            $permDiscordPerms = $discordPerms;
            require BH_ROOT . '/assets/features/permissions-panel.php';
            ?>
        </div>
    <?php endforeach; ?>
    </div>
</div>

<?php endif; ?>

<script>
(function () {
    'use strict';
    if (!window.BH_CSRF)   window.BH_CSRF   = <?= json_encode($csrf) ?>;
    if (!window.BH_BOT_ID) window.BH_BOT_ID = <?= (int)$botId ?>;

    // bhTogglePerms/bhSavePerms kommen aus dem globalen bh-permissions.js
    // (perm-panel Markup/IDs sind identisch zu allen anderen Modulen) — keine
    // lokale Kopie hier, damit es einheitlich mit den restlichen Modulen bleibt.

    function flash(msg, ok) {
        var el = document.getElementById('plex-alert');
        if (!el) return;
        el.className = 'bh-alert ' + (ok ? 'bh-alert-ok' : 'bh-alert-error');
        el.textContent = msg;
        el.style.display = 'block';
        clearTimeout(el._t);
        el._t = setTimeout(function () { el.style.display = 'none'; }, 3500);
    }

    async function callApi(body) {
        var res = await fetch('/api/v1/plugins/plex', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(Object.assign({ csrf_token: window.BH_CSRF }, body)),
        });
        return res.json();
    }

    // ── Admin-Token via Plex.tv OAuth-PIN-Flow ─────────────────────────────
    var oauthBtn = document.getElementById('plex-oauth-btn');
    if (oauthBtn) {
        var oauthPollTimer = null;
        oauthBtn.addEventListener('click', async function () {
            clearTimeout(oauthPollTimer);
            oauthBtn.disabled = true;
            oauthBtn.textContent = 'Öffne Plex.tv…';
            try {
                var start = await callApi({ action: 'start_admin_oauth' });
                if (!start.ok) { flash(start.error || 'Fehler beim Start.', false); oauthBtn.disabled = false; oauthBtn.textContent = '🔑 Mit Plex.tv verbinden'; return; }

                var authWindow = window.open(start.authUrl, '_blank', 'noopener');
                if (!authWindow) flash('Popup blockiert — bitte Popups für diese Seite erlauben.', false);

                oauthBtn.textContent = 'Warte auf Anmeldung…';
                var attempts = 0;
                var poll = async function () {
                    attempts++;
                    var d = await callApi({ action: 'poll_admin_oauth' });
                    if (d.ok && d.linked) {
                        flash('✅ Admin-Token via Plex.tv verbunden.', true);
                        setTimeout(function () { location.reload(); }, 800);
                        return;
                    }
                    if (!d.ok) {
                        flash(d.error === 'expired' ? 'Zeitüberschreitung — bitte erneut versuchen.' : (d.error || 'Fehler.'), false);
                        oauthBtn.disabled = false;
                        oauthBtn.textContent = '🔑 Mit Plex.tv verbinden';
                        return;
                    }
                    if (attempts >= 150) {
                        flash('Zeitüberschreitung — bitte erneut versuchen.', false);
                        oauthBtn.disabled = false;
                        oauthBtn.textContent = '🔑 Mit Plex.tv verbinden';
                        return;
                    }
                    oauthPollTimer = setTimeout(poll, 2000);
                };
                oauthPollTimer = setTimeout(poll, 2500);
            } catch (e) {
                flash('Netzwerkfehler.', false);
                oauthBtn.disabled = false;
                oauthBtn.textContent = '🔑 Mit Plex.tv verbinden';
            }
        });
    }

    // ── Server-Erkennung via Plex.tv ────────────────────────────────────────
    var findServersBtn = document.getElementById('plex-find-servers-btn');
    var serverSelect   = document.getElementById('plex-server-select');
    if (findServersBtn && serverSelect) {
        findServersBtn.addEventListener('click', async function () {
            findServersBtn.disabled = true;
            findServersBtn.textContent = 'Suche…';
            try {
                var d = await callApi({ action: 'fetch_plex_servers' });
                if (!d.ok) { flash(d.error === 'no_admin_token' ? 'Bitte zuerst Admin-Token setzen.' : (d.error || 'Fehler.'), false); return; }
                if (!d.servers || !d.servers.length) { flash('Keine Server auf diesem Plex-Account gefunden.', false); return; }

                serverSelect.innerHTML = '<option value="">— Server/Verbindung wählen —</option>';
                d.servers.forEach(function (server) {
                    server.connections.forEach(function (c) {
                        var tag = c.local ? '🏠 lokal' : (c.relay ? '🔀 Relay/Standard-Domain' : '🌐 extern');
                        var opt = new Option(server.name + ' — ' + tag, JSON.stringify({ uri: c.uri, accessToken: server.accessToken }));
                        serverSelect.appendChild(opt);
                    });
                });
                serverSelect.style.display = '';
                flash(d.servers.length + ' Server gefunden — Verbindung auswählen.', true);
            } catch (e) {
                flash('Netzwerkfehler.', false);
            } finally {
                findServersBtn.disabled = false;
                findServersBtn.textContent = '🔍 Verfügbare Server laden';
            }
        });

        serverSelect.addEventListener('change', async function () {
            if (!serverSelect.value) return;
            var picked = JSON.parse(serverSelect.value);
            serverSelect.disabled = true;
            var d = await callApi({ action: 'select_plex_server', uri: picked.uri, access_token: picked.accessToken });
            if (d.ok) {
                flash('✅ Server verbunden: ' + picked.uri, true);
                setTimeout(function () { location.reload(); }, 800);
            } else {
                flash(d.error || 'Fehler beim Speichern.', false);
                serverSelect.disabled = false;
            }
        });
    }

    // ── Eye toggles ────────────────────────────────────────────────────────
    document.querySelectorAll('.plex-eye-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var input = document.getElementById(btn.dataset.target);
            if (input) input.type = input.type === 'password' ? 'text' : 'password';
        });
    });

    // ── Bot-wide settings save ─────────────────────────────────────────────
    var saveSettingsBtn = document.getElementById('plex-save-settings-btn');
    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener('click', async function () {
            saveSettingsBtn.disabled = true;
            try {
                var d = await callApi({
                    action: 'save_settings',
                    plex_server_url:   document.getElementById('plex-server-url').value,
                    plex_admin_token:  document.getElementById('plex-admin-token').value,
                    overseerr_url:     document.getElementById('plex-overseerr-url').value,
                    overseerr_api_key: document.getElementById('plex-overseerr-key').value,
                });
                flash(d.ok ? 'Einstellungen gespeichert.' : (d.error || 'Fehler.'), !!d.ok);
                if (d.ok) setTimeout(function () { location.reload(); }, 600);
            } catch (e) { flash('Netzwerkfehler.', false); }
            saveSettingsBtn.disabled = false;
        });
    }

    var regenBtn = document.getElementById('plex-regen-secret-btn');
    if (regenBtn) {
        regenBtn.addEventListener('click', async function () {
            if (!confirm('Neues Webhook-Secret generieren? Bestehende Webhook-URLs in Plex/Overseerr müssen dann aktualisiert werden.')) return;
            var d = await callApi({ action: 'regenerate_webhook_secret' });
            if (d.ok) location.reload();
        });
    }

    // ── Guild selector ─────────────────────────────────────────────────────
    var guildSelect = document.getElementById('plex-guild-select');
    if (guildSelect) {
        guildSelect.addEventListener('change', function () {
            var url = new URL(location.href);
            url.searchParams.set('guild_id', this.value);
            location.href = url.toString();
        });
    }

    var guildId = <?= json_encode($guildId) ?>;

    // ── Guild-enabled toggle ───────────────────────────────────────────────
    var guildEnabledToggle = document.getElementById('plex-guild-enabled');
    if (guildEnabledToggle) {
        guildEnabledToggle.addEventListener('change', async function () {
            var d = await callApi({ action: 'set_guild_enabled', guild_id: guildId, enabled: this.checked });
            if (d.ok) location.reload();
        });
    }

    // ── Channel/Role selects via BHPicker ──────────────────────────────────
    if (guildId && window.BHPicker) {
        var newContentSel = document.getElementById('plex-new-content-channel');
        var liveStatusSel = document.getElementById('plex-live-status-channel');
        var roleSel       = document.getElementById('plex-linked-role');
        var currentChannels = { new: <?= json_encode((string)($guildSettings['new_content_channel_id'] ?? '')) ?>, live: <?= json_encode((string)($guildSettings['live_status_channel_id'] ?? '')) ?> };
        var currentRole = <?= json_encode((string)($guildSettings['role_id'] ?? '')) ?>;

        BHPicker.getGuildData(window.BH_BOT_ID, guildId).then(function (data) {
            (data.channels || []).forEach(function (c) {
                if (newContentSel) newContentSel.appendChild(new Option('#' + c.name, c.id, false, c.id === currentChannels.new));
                if (liveStatusSel) liveStatusSel.appendChild(new Option('#' + c.name, c.id, false, c.id === currentChannels.live));
            });
            (data.roles || []).forEach(function (r) {
                if (roleSel) roleSel.appendChild(new Option(r.name, r.id, false, r.id === currentRole));
            });
        }).catch(function (e) { console.error('BHPicker.getGuildData failed:', e); });
    }

    // ── Library tag input (validates against datalist, stores section id) ─
    // Fügt eine einzelne Bibliothek als Tag hinzu (Titel muss exakt auf einen
    // Datalist-Eintrag matchen). Gibt true zurück wenn ein Tag hinzugefügt oder
    // bereits vorhanden war, false bei unbekanntem Titel.
    function plexAddOneLibraryTag(title, container) {
        title = title.trim();
        if (!title) return true;
        var option = document.querySelector('#plex-libs-datalist option[value="' + CSS.escape(title) + '"]');
        if (!option) { flash('Unbekannte Bibliothek: ' + title, false); return false; }
        var id = option.dataset.id;
        if (container.querySelector('[data-value="' + id + '"]')) return true;
        var tag = document.createElement('span');
        tag.className = 'bh-tag';
        tag.dataset.value = id;
        tag.textContent = title;
        var btn = document.createElement('button');
        btn.textContent = '×';
        btn.onclick = function () { bhRemoveTag(btn); };
        tag.appendChild(btn);
        container.insertBefore(tag, container.querySelector('input'));
        return true;
    }

    // Mehrere Bibliotheken auf einmal freigeben, komma-getrennt (Tippen mit
    // Komma zwischen den Namen oder direktes Einfügen einer Liste).
    window.plexAddLibraryTag = function (evt, input) {
        if (evt.key !== 'Enter' && evt.key !== ',') return;
        evt.preventDefault();
        var container = input.closest('.bh-tag-input');
        input.value.split(',').forEach(function (title) { plexAddOneLibraryTag(title, container); });
        input.value = '';
    };

    var libsInput = document.querySelector('#plex-libraries input[list="plex-libs-datalist"]');
    if (libsInput) {
        libsInput.addEventListener('paste', function (evt) {
            var text = (evt.clipboardData || window.clipboardData).getData('text');
            if (text.indexOf(',') === -1) return; // einzelner Titel: normale Paste-Behandlung, per Enter bestätigen
            evt.preventDefault();
            var container = libsInput.closest('.bh-tag-input');
            text.split(',').forEach(function (title) { plexAddOneLibraryTag(title, container); });
            libsInput.value = '';
        });
    }

    // ── Save guild settings ────────────────────────────────────────────────
    var saveGuildBtn = document.getElementById('plex-save-guild-btn');
    if (saveGuildBtn) {
        saveGuildBtn.addEventListener('click', async function () {
            saveGuildBtn.disabled = true;
            var libTags = Array.from(document.querySelectorAll('#plex-libraries .bh-tag')).map(function (t) { return t.dataset.value; });
            try {
                var d = await callApi({
                    action: 'save_guild_settings',
                    guild_id: guildId,
                    new_content_channel_id: (document.getElementById('plex-new-content-channel') || {}).value || '',
                    live_status_channel_id: (document.getElementById('plex-live-status-channel') || {}).value || '',
                    role_id: (document.getElementById('plex-linked-role') || {}).value || '',
                    allowed_library_ids: libTags,
                });
                flash(d.ok ? 'Server-Einstellungen gespeichert.' : (d.error || 'Fehler.'), !!d.ok);
                if (d.ok) setTimeout(function () { location.reload(); }, 600);
            } catch (e) { flash('Netzwerkfehler.', false); }
            saveGuildBtn.disabled = false;
        });
    }
}());
</script>
