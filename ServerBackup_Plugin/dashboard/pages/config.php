<?php
declare(strict_types=1);
// Discord Server Backup — Dashboard-Seite
// $context wird vom PluginExtensionRunner injiziert (plugin-page.php)

$botId  = (int)($context['botId'] ?? $_SESSION['current_bot_id'] ?? 0);
$userId = (int)($_SESSION['user_id'] ?? 0);
$db     = bh_db();
$csrf   = (string)($_SESSION['csrf_token'] ?? '');
$e      = fn($v) => htmlspecialchars((string)$v, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');

echo '<link rel="stylesheet" href="/assets/css/components-base.css?v=' . filemtime(BH_ROOT . '/assets/css/components-base.css') . '">';

// Guilds des Bots laden
require_once BH_ROOT . '/functions/modules/builder_shared.php';
$guilds = [];
try { $guilds = bh_get_bot_guilds($botId, $userId); } catch (Throwable) {}

$guildId = trim((string)($_GET['backup_guild'] ?? ''));
if ($guildId === '' && !empty($guilds)) $guildId = (string)($guilds[0]['id'] ?? '');
if ($guildId !== '' && !in_array($guildId, array_column($guilds, 'id'), true)) $guildId = '';

// Settings + Backup der gewählten Guild
$includeDefaults = ['settings' => 1, 'roles' => 1, 'channels' => 1, 'emojis' => 1, 'stickers' => 1, 'bans' => 1];
$includeLabels = [
    'settings' => '⚙️ Server-Einstellungen',
    'roles'    => '🎭 Rollen + Berechtigungen',
    'channels' => '📁 Channels + Berechtigungen (Text, Voice, Kategorien, Foren)',
    'emojis'   => '😀 Emojis / Server-GIFs',
    'stickers' => '🏷️ Sticker',
    'bans'     => '🔨 Bans',
];

$settings = null;
$backup = null;
if ($guildId !== '') {
    try {
        $st = $db->prepare('SELECT * FROM plugin_server_backup_plugin_settings WHERE guild_id = ? LIMIT 1');
        $st->execute([$guildId]);
        $settings = $st->fetch(PDO::FETCH_ASSOC) ?: null;
    } catch (Throwable) {}
    try {
        $st = $db->prepare('SELECT id, guild_name, created_by, trigger_type, counts_json, size_bytes, created_at FROM plugin_server_backup_plugin_backups WHERE guild_id = ? LIMIT 1');
        $st->execute([$guildId]);
        $backup = $st->fetch(PDO::FETCH_ASSOC) ?: null;
    } catch (Throwable) {}
}

$include = $includeDefaults;
if ($settings && !empty($settings['include_json'])) {
    $saved = json_decode((string)$settings['include_json'], true) ?: [];
    foreach ($includeDefaults as $k => $v) {
        if (array_key_exists($k, $saved)) $include[$k] = (int)(bool)$saved[$k];
    }
}
$scheduleEnabled = (int)($settings['schedule_enabled'] ?? 0);
$scheduleDay  = (string)($settings['schedule_day'] ?? '1');
$scheduleTime = (string)($settings['schedule_time'] ?? '09:00');
$timezone     = (string)($settings['timezone'] ?? 'Europe/Berlin');

$counts = $backup ? (json_decode((string)($backup['counts_json'] ?? '{}'), true) ?: []) : [];
$sizeFmt = '';
if ($backup) {
    $b = (int)$backup['size_bytes'];
    $sizeFmt = $b >= 1048576 ? number_format($b / 1048576, 1, ',', '.') . ' MB'
             : ($b >= 1024 ? number_format($b / 1024, 1, ',', '.') . ' KB' : $b . ' B');
}
$dayNames = ['daily' => 'Täglich', '1' => 'Montag', '2' => 'Dienstag', '3' => 'Mittwoch', '4' => 'Donnerstag', '5' => 'Freitag', '6' => 'Samstag', '0' => 'Sonntag'];

// Zielserver für "Auf anderen Server übertragen" — alle Guilds des Bots außer der aktuell gewählten
$transferTargets = array_values(array_filter($guilds, fn($g) => (string)$g['id'] !== $guildId));
?>

<!-- Server-Auswahl -->
<div class="bh-card" style="margin-bottom:16px;">
    <div class="bh-card-header"><span class="bh-card-title">🖥️ Server</span></div>
    <div style="padding:16px 20px;">
        <select id="sbk-guild" class="bh-input" onchange="sbkSwitchGuild(this.value)">
            <option value="">— Server auswählen —</option>
            <?php foreach ($guilds as $g): ?>
            <option value="<?= $e((string)$g['id']) ?>" <?= (string)$g['id'] === $guildId ? 'selected' : '' ?>><?= $e((string)$g['name']) ?></option>
            <?php endforeach; ?>
        </select>
    </div>
</div>

<?php if ($guildId !== ''): ?>

<div id="sbk-alert" class="bh-alert" style="display:none;margin-bottom:14px;"></div>

<!-- Backup-Status -->
<div class="bh-card" style="margin-bottom:16px;">
    <div class="bh-card-header"><span class="bh-card-title">💾 Aktuelles Backup</span></div>
    <div style="padding:16px 20px;">
        <?php if ($backup): ?>
        <div style="display:flex;flex-wrap:wrap;gap:24px;align-items:center;">
            <div>
                <div style="font-size:13px;font-weight:600;color:var(--text-primary);">
                    <?= $e((string)$backup['guild_name']) ?>
                </div>
                <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">
                    Erstellt: <?= $e((string)$backup['created_at']) ?>
                    (<?= $backup['trigger_type'] === 'schedule' ? '⏰ Zeitplan' : '👤 manuell' ?>) · <?= $e($sizeFmt) ?>
                </div>
                <div style="font-size:12px;color:var(--text-secondary);margin-top:8px;display:flex;gap:14px;flex-wrap:wrap;">
                    <span>🎭 <?= (int)($counts['roles'] ?? 0) ?> Rollen</span>
                    <span>📁 <?= (int)($counts['channels'] ?? 0) ?> Channels</span>
                    <span>😀 <?= (int)($counts['emojis'] ?? 0) ?> Emojis</span>
                    <span>🏷️ <?= (int)($counts['stickers'] ?? 0) ?> Sticker</span>
                    <span>🔨 <?= (int)($counts['bans'] ?? 0) ?> Bans</span>
                </div>
            </div>
            <div style="margin-left:auto;display:flex;gap:10px;flex-wrap:wrap;">
                <button type="button" class="bh-btn bh-btn-primary" id="sbk-create-btn" onclick="sbkCreateNow()">🔄 Backup jetzt erstellen</button>
                <a class="bh-btn bh-btn-ghost" href="/api/v1/plugins/server-backup?action=download&guild_id=<?= $e($guildId) ?>">⬇️ Download (JSON)</a>
                <button type="button" class="bh-btn bh-btn-ghost" style="color:#f87171;" onclick="sbkDeleteBackup()">🗑️ Löschen</button>
            </div>
        </div>
        <?php else: ?>
        <div style="padding:12px 0;color:var(--text-muted);font-size:13px;">
            Noch kein Backup vorhanden. Erstelle eins direkt hier, per <code style="color:var(--accent-bright);">/backup create</code> auf dem Server,
            oder aktiviere unten den Zeitplan. Beim Erstellen wird ein bestehendes Backup immer überschrieben.
            <div style="margin-top:12px;">
                <button type="button" class="bh-btn bh-btn-primary" id="sbk-create-btn" onclick="sbkCreateNow()">🔄 Backup jetzt erstellen</button>
            </div>
        </div>
        <?php endif; ?>
    </div>
</div>

<!-- Backup hochladen / wiederherstellen -->
<div class="bh-card" style="margin-bottom:16px;">
    <div class="bh-card-header"><span class="bh-card-title">⬆️ Backup hochladen &amp; wiederherstellen</span></div>
    <div style="padding:16px 20px;">
        <p class="bh-text-muted bh-text-sm" style="margin-bottom:12px;">
            Lädt eine zuvor heruntergeladene <code>backup-*.json</code> hoch und stellt exakt diesen Zustand auf
            <strong><?= $e((string)($guilds[array_search($guildId, array_column($guilds, 'id'), true)]['name'] ?? '')) ?></strong> wieder her.
            <br><strong style="color:#f87171;">Achtung, destruktiv:</strong> Rollen/Channels/Emojis/Sticker, die im Backup fehlen, werden auf diesem Server
            <strong>gelöscht</strong>. Was im Backup vorhanden UND schon da ist (per Name erkannt), bleibt unangetastet — nur wirklich Fehlendes wird neu angelegt.
            Bans werden nie automatisch entfernt (kein Auto-Unban).
        </p>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
            <input type="file" id="sbk-upload-file" accept=".json,application/json" class="bh-input" style="max-width:340px;">
            <button type="button" class="bh-btn bh-btn-primary" id="sbk-upload-btn" onclick="sbkUploadBackup()">⬆️ Hochladen &amp; wiederherstellen</button>
        </div>
        <div id="sbk-upload-result" style="margin-top:12px;font-size:12px;color:var(--text-secondary);white-space:pre-wrap;"></div>
    </div>
</div>

<?php if (!empty($transferTargets) && $backup): ?>
<!-- Auf anderen Server übertragen -->
<div class="bh-card" style="margin-bottom:16px;">
    <div class="bh-card-header"><span class="bh-card-title">📤 Auf anderen Server übertragen</span></div>
    <div style="padding:16px 20px;">
        <p class="bh-text-muted bh-text-sm" style="margin-bottom:12px;">
            Überträgt das aktuelle Backup dieses Servers auf einen anderen Server, auf dem der Bot ebenfalls ist.
            Auch hier gilt: additiv, keine bestehenden Daten werden gelöscht/überschrieben.
        </p>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
            <select id="sbk-transfer-target" class="bh-input" style="max-width:340px;">
                <?php foreach ($transferTargets as $g): ?>
                <option value="<?= $e((string)$g['id']) ?>"><?= $e((string)$g['name']) ?></option>
                <?php endforeach; ?>
            </select>
            <button type="button" class="bh-btn bh-btn-primary" id="sbk-transfer-btn" onclick="sbkTransferBackup()">📤 Übertragen</button>
        </div>
        <div id="sbk-transfer-result" style="margin-top:12px;font-size:12px;color:var(--text-secondary);white-space:pre-wrap;"></div>
    </div>
</div>
<?php endif; ?>

<!-- Include / Exclude -->
<div class="bh-card" style="margin-bottom:16px;">
    <div class="bh-card-header"><span class="bh-card-title">📦 Backup-Inhalt (Include / Exclude)</span></div>
    <div style="padding:16px 20px;display:flex;flex-direction:column;gap:12px;">
        <?php foreach ($includeLabels as $key => $label): ?>
        <label style="display:flex;align-items:center;gap:12px;cursor:pointer;font-size:13px;color:var(--text-primary);">
            <input type="checkbox" class="bh-checkbox sbk-include" data-key="<?= $e($key) ?>" <?= $include[$key] ? 'checked' : '' ?>>
            <span><?= $label ?></span>
        </label>
        <?php endforeach; ?>
        <small class="bh-hint">Gilt für alle zukünftigen Backups (Command und Zeitplan) dieses Servers.</small>
    </div>
</div>

<!-- Zeitplan -->
<div class="bh-card" style="margin-bottom:16px;">
    <div class="bh-card-header"><span class="bh-card-title">⏰ Automatisches Backup (Zeitplan)</span></div>
    <div style="padding:16px 20px;">
        <label style="display:flex;align-items:center;gap:12px;cursor:pointer;font-size:13px;color:var(--text-primary);margin-bottom:16px;">
            <input type="checkbox" class="bh-checkbox" id="sbk-schedule-enabled" <?= $scheduleEnabled ? 'checked' : '' ?>>
            <span>Zeitplan aktiv — das alte Backup wird bei jedem Lauf überschrieben</span>
        </label>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;">
            <div>
                <label class="bh-label">Wochentag</label>
                <select id="sbk-schedule-day" class="bh-input">
                    <?php foreach ($dayNames as $val => $label): ?>
                    <option value="<?= $e((string)$val) ?>" <?= (string)$val === $scheduleDay ? 'selected' : '' ?>><?= $e($label) ?></option>
                    <?php endforeach; ?>
                </select>
            </div>
            <div>
                <label class="bh-label">Uhrzeit</label>
                <input type="time" id="sbk-schedule-time" class="bh-input" value="<?= $e($scheduleTime) ?>">
            </div>
            <div>
                <label class="bh-label">Zeitzone</label>
                <input type="text" id="sbk-timezone" class="bh-input" value="<?= $e($timezone) ?>" placeholder="Europe/Berlin">
            </div>
        </div>
        <small class="bh-hint" style="display:block;margin-top:10px;">Beispiel: Montag, 09:00, Europe/Berlin = jeden Montag um 9 Uhr.</small>
    </div>
</div>

<div style="display:flex;justify-content:flex-end;margin-bottom:24px;">
    <button type="button" class="bh-btn bh-btn-primary" id="sbk-save-btn" onclick="sbkSave()">Einstellungen speichern</button>
</div>

<?php endif; ?>

<script>
var SBK_CSRF = <?= json_encode($csrf) ?>;
var SBK_GUILD = <?= json_encode($guildId) ?>;

function sbkSwitchGuild(gid) {
    var url = new URL(location.href);
    if (gid) url.searchParams.set('backup_guild', gid); else url.searchParams.delete('backup_guild');
    location.href = url.toString();
}

function sbkFlash(ok, msg) {
    var el = document.getElementById('sbk-alert');
    if (!el) return;
    el.style.display = 'block';
    el.style.padding = '10px 14px';
    el.style.borderRadius = '6px';
    el.style.fontSize = '13px';
    el.style.background = ok ? 'rgba(74,222,128,.08)' : 'rgba(248,113,113,.08)';
    el.style.border = '1px solid ' + (ok ? '#4ade80' : '#f87171');
    el.style.color = ok ? '#4ade80' : '#f87171';
    el.textContent = msg;
    setTimeout(function () { el.style.display = 'none'; }, 4000);
}

function sbkFormatResult(result) {
    if (!result) return '';
    var lines = [];
    if (result.settings) lines.push('Einstellungen: ' + (result.settings.applied ? '✓ übernommen' : ('✗ ' + (result.settings.error || 'nicht übernommen'))));
    ['roles', 'channels', 'emojis', 'stickers', 'bans'].forEach(function (key) {
        var labels = { roles: 'Rollen', channels: 'Channels', emojis: 'Emojis', stickers: 'Sticker', bans: 'Bans' };
        var r = result[key];
        if (!r) return;
        var parts = [r.created + ' erstellt'];
        if (r.matched)      parts.push(r.matched + ' schon vorhanden');
        if (r.deleted)      parts.push(r.deleted + ' gelöscht');
        if (r.failed)       parts.push(r.failed + ' fehlgeschlagen');
        lines.push(labels[key] + ': ' + parts.join(', '));
        (r.errors || []).forEach(function (err) { lines.push('  ⚠ ' + err); });
    });
    return lines.join('\n');
}

async function sbkSave() {
    if (!SBK_GUILD) return;
    var include = {};
    document.querySelectorAll('.sbk-include').forEach(function (el) { include[el.dataset.key] = el.checked ? 1 : 0; });
    var btn = document.getElementById('sbk-save-btn');
    btn.disabled = true;
    try {
        var res = await fetch('/api/v1/plugins/server-backup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                csrf_token: SBK_CSRF,
                action: 'save_settings',
                guild_id: SBK_GUILD,
                include: include,
                schedule_enabled: document.getElementById('sbk-schedule-enabled').checked ? 1 : 0,
                schedule_day: document.getElementById('sbk-schedule-day').value,
                schedule_time: document.getElementById('sbk-schedule-time').value,
                timezone: document.getElementById('sbk-timezone').value
            })
        });
        var json = await res.json();
        sbkFlash(json.ok, json.ok ? '✓ Einstellungen gespeichert' : ('Fehler: ' + (json.error || 'unbekannt')));
    } catch (e) {
        sbkFlash(false, 'Netzwerkfehler');
    }
    btn.disabled = false;
}

async function sbkCreateNow() {
    if (!SBK_GUILD) return;
    var btn = document.getElementById('sbk-create-btn');
    var originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ Erstelle Backup…';
    try {
        var res = await fetch('/api/v1/plugins/server-backup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ csrf_token: SBK_CSRF, action: 'create_now', guild_id: SBK_GUILD })
        });
        var json = await res.json();
        if (json.ok) {
            location.reload();
        } else {
            sbkFlash(false, 'Fehler: ' + (json.error || 'unbekannt'));
            btn.disabled = false;
            btn.textContent = originalText;
        }
    } catch (e) {
        sbkFlash(false, 'Netzwerkfehler');
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

async function sbkDeleteBackup() {
    if (!SBK_GUILD) return;
    if (!confirm('Backup für diesen Server wirklich löschen?')) return;
    try {
        var res = await fetch('/api/v1/plugins/server-backup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ csrf_token: SBK_CSRF, action: 'delete_backup', guild_id: SBK_GUILD })
        });
        var json = await res.json();
        if (json.ok) location.reload();
        else sbkFlash(false, 'Fehler: ' + (json.error || 'unbekannt'));
    } catch (e) {
        sbkFlash(false, 'Netzwerkfehler');
    }
}

async function sbkUploadBackup() {
    if (!SBK_GUILD) return;
    var fileInput = document.getElementById('sbk-upload-file');
    var resultBox = document.getElementById('sbk-upload-result');
    if (!fileInput.files.length) { sbkFlash(false, 'Bitte zuerst eine backup-*.json Datei auswählen.'); return; }
    if (!confirm('Backup auf diesen Server wiederherstellen?\n\nACHTUNG: Rollen/Channels/Emojis/Sticker, die NICHT im Backup sind, werden GELÖSCHT. Das kann nicht rückgängig gemacht werden. Bans werden nie automatisch entfernt.')) return;

    var btn = document.getElementById('sbk-upload-btn');
    btn.disabled = true;
    resultBox.textContent = '⏳ Wende Backup an — kann bei großen Servern mehrere Minuten dauern…';

    try {
        var form = new FormData();
        form.append('action', 'upload_backup');
        form.append('csrf_token', SBK_CSRF);
        form.append('guild_id', SBK_GUILD);
        form.append('backup_file', fileInput.files[0]);
        var res = await fetch('/api/v1/plugins/server-backup', { method: 'POST', body: form });
        var json = await res.json();
        if (json.ok) {
            resultBox.textContent = '✓ Backup angewendet.\n' + sbkFormatResult(json.result);
        } else {
            resultBox.textContent = '✗ Fehler: ' + (json.error || 'unbekannt');
        }
    } catch (e) {
        resultBox.textContent = '✗ Netzwerkfehler';
    }
    btn.disabled = false;
}

async function sbkTransferBackup() {
    if (!SBK_GUILD) return;
    var targetSelect = document.getElementById('sbk-transfer-target');
    var resultBox = document.getElementById('sbk-transfer-result');
    var target = targetSelect.value;
    if (!target) return;
    var targetName = targetSelect.options[targetSelect.selectedIndex].textContent;
    if (!confirm('Backup dieses Servers auf "' + targetName + '" übertragen? Rollen/Channels/Emojis/Sticker/Bans werden dort neu erstellt (bestehende bleiben unangetastet, Duplikate möglich).')) return;

    var btn = document.getElementById('sbk-transfer-btn');
    btn.disabled = true;
    resultBox.textContent = '⏳ Übertrage — kann bei großen Servern mehrere Minuten dauern…';

    try {
        var res = await fetch('/api/v1/plugins/server-backup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ csrf_token: SBK_CSRF, action: 'transfer_backup', guild_id: SBK_GUILD, target_guild_id: target })
        });
        var json = await res.json();
        if (json.ok) {
            resultBox.textContent = '✓ Übertragen.\n' + sbkFormatResult(json.result);
        } else {
            resultBox.textContent = '✗ Fehler: ' + (json.error || 'unbekannt');
        }
    } catch (e) {
        resultBox.textContent = '✗ Netzwerkfehler';
    }
    btn.disabled = false;
}
</script>
