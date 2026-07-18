<?php
declare(strict_types=1);

echo '<link rel="stylesheet" href="/assets/css/components-base.css?v=' . filemtime(BH_ROOT . '/assets/css/components-base.css') . '">';

$botId  = (int)($context['botId'] ?? $_SESSION['current_bot_id'] ?? 0);
$userId = (int)($_SESSION['user_id'] ?? 0);
$db     = bh_db();
$e      = fn(string $v): string => htmlspecialchars($v, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');

require_once BH_ROOT . '/functions/modules/builder_shared.php';
$guilds = [];
try { $guilds = bh_get_bot_guilds($botId, $userId); } catch (Throwable) {}

$INTERVALS = [1 => '1 Minute', 5 => '5 Minuten', 10 => '10 Minuten', 15 => '15 Minuten', 30 => '30 Minuten', 60 => '1 Stunde', 1440 => '24 Stunden'];

// Core sofort per HTTP triggern statt auf den nächsten 60s-Tick zu warten — gleiches
// Muster wie der Stat-Channels "Sofort-Tick" (core_runners-Endpoint + APP_KEY-Bearer-
// Auth, POST an die vom Plugin registrierte /trigger-Route).
function bhwsc_trigger_now(PDO $db, int $botId): void {
    try {
        $coreRow = $db->query(
            "SELECT endpoint FROM core_runners WHERE last_seen > DATE_SUB(NOW(), INTERVAL 2 MINUTE) LIMIT 1"
        )->fetch();
        if (!$coreRow) return;
        $appKey = defined('BH_APP_KEY') ? BH_APP_KEY : getenv('APP_KEY');
        $url    = rtrim((string)$coreRow['endpoint'], '/') . '/plugins/websitestatuscheck-plugin/trigger';
        $ctx    = stream_context_create(['http' => [
            'method'        => 'POST',
            'timeout'       => 15,
            'ignore_errors' => true,
            'header'        => "Content-Type: application/json\r\nAuthorization: Bearer $appKey\r\n",
            'content'       => json_encode(['botId' => $botId]),
        ]]);
        file_get_contents($url, false, $ctx);
    } catch (Throwable) {}
}

$error   = '';
$success = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST' && $botId > 0) {
    if (($_SESSION['csrf_token'] ?? '') !== ($_POST['csrf'] ?? '')) {
        $error = 'Ungültiges CSRF-Token.';
    } elseif (($_POST['action'] ?? '') === 'save_settings') {
        $channelId = trim((string)($_POST['channel_id'] ?? ''));
        $interval  = (int)($_POST['interval_minutes'] ?? 5);
        if (!isset($INTERVALS[$interval])) $interval = 5;

        $db->prepare('INSERT INTO plugin_websitestatuscheck_plugin_settings (bot_id, channel_id, interval_minutes)
                       VALUES (?, ?, ?)
                       ON DUPLICATE KEY UPDATE channel_id = VALUES(channel_id), interval_minutes = VALUES(interval_minutes)')
           ->execute([$botId, $channelId ?: null, $interval]);

        bhwsc_trigger_now($db, $botId);
        $success = 'Einstellungen gespeichert — Check läuft sofort.';
    } elseif (($_POST['action'] ?? '') === 'add_site') {
        $name  = trim((string)($_POST['name'] ?? ''));
        $url   = trim((string)($_POST['url'] ?? ''));
        $group = trim((string)($_POST['group_name'] ?? ''));
        if ($name === '' || $url === '' || !filter_var($url, FILTER_VALIDATE_URL)) {
            $error = 'Name und eine gültige URL sind erforderlich.';
        } else {
            $db->prepare('INSERT INTO plugin_websitestatuscheck_plugin_sites (bot_id, name, url, group_name) VALUES (?, ?, ?, ?)')
               ->execute([$botId, $name, $url, $group !== '' ? $group : null]);

            bhwsc_trigger_now($db, $botId);
            $success = 'Webseite hinzugefügt — erster Check läuft sofort.';
        }
    } elseif (($_POST['action'] ?? '') === 'delete_site') {
        $id = (int)($_POST['id'] ?? 0);
        $db->prepare('DELETE FROM plugin_websitestatuscheck_plugin_sites WHERE id = ? AND bot_id = ?')->execute([$id, $botId]);
        $success = 'Webseite entfernt.';
    } elseif (($_POST['action'] ?? '') === 'set_group_description') {
        $groupName = trim((string)($_POST['group_name'] ?? ''));
        $desc      = trim((string)($_POST['description'] ?? ''));
        if ($groupName !== '') {
            $db->prepare('INSERT INTO plugin_websitestatuscheck_plugin_groups (bot_id, name, description) VALUES (?, ?, ?)
                           ON DUPLICATE KEY UPDATE description = VALUES(description)')
               ->execute([$botId, $groupName, $desc !== '' ? $desc : null]);
            bhwsc_trigger_now($db, $botId);
            $success = 'Gruppenbeschreibung gespeichert.';
        }
    }
}

$settings = null;
$sites    = [];
$groupDescriptions = [];
if ($botId > 0) {
    $stmt = $db->prepare('SELECT * FROM plugin_websitestatuscheck_plugin_settings WHERE bot_id = ? LIMIT 1');
    $stmt->execute([$botId]);
    $settings = $stmt->fetch(PDO::FETCH_ASSOC) ?: null;

    $stmt = $db->prepare('SELECT * FROM plugin_websitestatuscheck_plugin_sites WHERE bot_id = ? ORDER BY group_name IS NULL DESC, group_name ASC, id ASC');
    $stmt->execute([$botId]);
    $sites = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $stmt = $db->prepare('SELECT name, description FROM plugin_websitestatuscheck_plugin_groups WHERE bot_id = ?');
    $stmt->execute([$botId]);
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $groupDescriptions[$row['name']] = (string)($row['description'] ?? '');
    }
}

$curChannel  = (string)($settings['channel_id'] ?? '');
$curInterval = (int)($settings['interval_minutes'] ?? 5);

$STATUS_LABELS = ['green' => '🟢 Online', 'yellow' => '🟡 Warnung', 'red' => '🔴 Offline'];

$csrf = (string)($_SESSION['csrf_token'] ?? '');
?>

<?php if ($error !== ''): ?>
<div class="bh-alert bh-alert-error" style="margin-bottom:16px;"><?= $e($error) ?></div>
<?php endif; ?>
<?php if ($success !== ''): ?>
<div class="bh-alert bh-alert-success" style="margin-bottom:16px;"><?= $e($success) ?></div>
<?php endif; ?>

<div class="bh-card bh-card-lg" style="margin-bottom:20px;">
    <div class="bh-card-header">
        <h2>Einstellungen</h2>
    </div>
    <form method="post" style="padding:14px 16px;display:flex;gap:10px;flex-wrap:wrap;align-items:end;">
        <input type="hidden" name="csrf" value="<?= $e($csrf) ?>">
        <input type="hidden" name="action" value="save_settings">
        <input type="hidden" name="channel_id" id="wsc-channel-id" value="<?= $e($curChannel) ?>">
        <div class="bh-form-group">
            <label class="bh-label">Server</label>
            <select id="wsc-guild-select" class="bh-input">
                <option value="">— Server auswählen —</option>
                <?php foreach ($guilds as $g): ?>
                <option value="<?= $e((string)$g['id']) ?>"><?= $e((string)$g['name']) ?></option>
                <?php endforeach; ?>
            </select>
        </div>
        <div class="bh-form-group">
            <label class="bh-label">Ziel-Channel</label>
            <select id="wsc-channel-select" class="bh-input" required>
                <option value="">— zuerst Server wählen —</option>
                <?php if ($curChannel): ?>
                <option value="<?= $e($curChannel) ?>" selected>Aktuell: <?= $e($curChannel) ?></option>
                <?php endif; ?>
            </select>
        </div>
        <div class="bh-form-group">
            <label class="bh-label">Check-Intervall</label>
            <select name="interval_minutes" class="bh-input">
                <?php foreach ($INTERVALS as $val => $label): ?>
                <option value="<?= (int)$val ?>" <?= $curInterval === $val ? 'selected' : '' ?>><?= $e($label) ?></option>
                <?php endforeach; ?>
            </select>
        </div>
        <button type="submit" class="bh-btn bh-btn-primary">💾 Speichern</button>
    </form>
</div>

<div class="bh-card bh-card-lg" style="margin-bottom:20px;">
    <div class="bh-card-header">
        <h2>Webseite hinzufügen</h2>
    </div>
    <p class="bh-text-muted bh-text-sm" style="padding:0 16px;margin:8px 0;">Gruppe optional — Webseiten mit derselben Gruppe teilen sich ein Embed, ohne Gruppe bekommt jede Webseite ihr eigenes.</p>
    <form method="post" style="padding:14px 16px;display:flex;gap:10px;flex-wrap:wrap;align-items:end;">
        <input type="hidden" name="csrf" value="<?= $e($csrf) ?>">
        <input type="hidden" name="action" value="add_site">
        <div class="bh-form-group">
            <label class="bh-label">Name</label>
            <input type="text" name="name" class="bh-input" placeholder="z.B. Haupt-Webseite" maxlength="64" required>
        </div>
        <div class="bh-form-group">
            <label class="bh-label">URL</label>
            <input type="url" name="url" class="bh-input" placeholder="https://example.com" required style="min-width:260px;">
        </div>
        <div class="bh-form-group">
            <label class="bh-label">Gruppe (optional)</label>
            <input type="text" name="group_name" class="bh-input" placeholder="z.B. Produktiv-Server" maxlength="64" list="wsc-group-list">
            <datalist id="wsc-group-list">
                <?php foreach (array_unique(array_filter(array_column($sites, 'group_name'))) as $g): ?>
                <option value="<?= $e((string)$g) ?>">
                <?php endforeach; ?>
            </datalist>
        </div>
        <button type="submit" class="bh-btn bh-btn-primary">➕ Hinzufügen</button>
    </form>
</div>

<div class="bh-card bh-card-lg">
    <div class="bh-card-header">
        <h2>Überwachte Webseiten (<?= count($sites) ?>)</h2>
    </div>
    <?php if (!$sites): ?>
    <p class="bh-text-muted bh-text-sm" style="padding:14px 16px;">Noch keine Webseiten konfiguriert.</p>
    <?php else: ?>
    <div style="display:flex;flex-direction:column;">
        <?php $lastGroup = '__unset__'; foreach ($sites as $s):
            $g = (string)($s['group_name'] ?? '');
            if ($g !== $lastGroup):
                $lastGroup = $g;
        ?>
        <div style="padding:8px 16px 2px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted);">
            <?= $g !== '' ? '📡 ' . $e($g) : 'Ohne Gruppe (eigenes Embed)' ?>
        </div>
        <?php if ($g !== ''): ?>
        <form method="post" style="padding:2px 16px 8px;display:flex;gap:8px;align-items:center;">
            <input type="hidden" name="csrf" value="<?= $e($csrf) ?>">
            <input type="hidden" name="action" value="set_group_description">
            <input type="hidden" name="group_name" value="<?= $e($g) ?>">
            <input type="text" name="description" class="bh-input bh-text-sm" style="flex:1;" maxlength="200"
                   placeholder="Beschreibung für diese Gruppe (optional)"
                   value="<?= $e($groupDescriptions[$g] ?? '') ?>">
            <button type="submit" class="bh-btn bh-btn-secondary" style="font-size:11px;padding:4px 10px;">💾</button>
        </form>
        <?php endif; ?>
        <?php endif; ?>
        <div style="display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--border);">
            <div style="flex:1;min-width:0;">
                <strong style="font-size:13px;"><?= $e($s['name']) ?></strong>
                <span class="bh-text-muted bh-text-sm"> · <?= $e($s['url']) ?></span>
                <div class="bh-text-muted bh-text-sm">
                    <?= $s['last_status'] ? $e($STATUS_LABELS[$s['last_status']] ?? $s['last_status']) : 'Noch nicht geprüft' ?>
                    <?= $s['last_latency_ms'] !== null ? ' · ' . (int)$s['last_latency_ms'] . 'ms' : '' ?>
                </div>
            </div>
            <form method="post" onsubmit="return confirm('Webseite \'<?= $e($s['name']) ?>\' wirklich entfernen?');">
                <input type="hidden" name="csrf" value="<?= $e($csrf) ?>">
                <input type="hidden" name="action" value="delete_site">
                <input type="hidden" name="id" value="<?= (int)$s['id'] ?>">
                <button type="submit" class="bh-btn bh-btn-danger" style="font-size:12px;padding:4px 10px;">🗑️</button>
            </form>
        </div>
        <?php endforeach; ?>
    </div>
    <?php endif; ?>
</div>

<script>
(function () {
    const BOT_ID = <?= (int)$botId ?>;
    const guildSelect   = document.getElementById('wsc-guild-select');
    const channelSelect = document.getElementById('wsc-channel-select');
    const channelIdEl   = document.getElementById('wsc-channel-id');

    if (guildSelect) {
        guildSelect.addEventListener('change', async function () {
            channelSelect.innerHTML = '<option value="">— lädt… —</option>';
            if (!this.value || !window.BHPicker) return;
            try {
                const data = await BHPicker.getGuildData(BOT_ID, this.value);
                channelSelect.innerHTML = '<option value="">— Channel auswählen —</option>';
                (data.channels || []).forEach(function (c) {
                    const o = document.createElement('option');
                    o.value = c.id;
                    o.textContent = '#' + c.name;
                    channelSelect.appendChild(o);
                });
            } catch (e) { channelSelect.innerHTML = '<option value="">— Fehler beim Laden —</option>'; }
        });
    }
    if (channelSelect) {
        channelSelect.addEventListener('change', function () { channelIdEl.value = this.value; });
    }
})();
</script>
