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

$MODE_LABELS = [
    'media' => 'Nur Medien (Bilder/Videos)',
    'gif'   => 'Nur GIFs',
    'emoji' => 'Nur Emojis',
    'text'  => 'Nur Text',
];

$error   = '';
$success = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST' && $botId > 0) {
    if (($_SESSION['csrf_token'] ?? '') !== ($_POST['csrf'] ?? '')) {
        $error = 'Ungültiges CSRF-Token.';
    } elseif (($_POST['action'] ?? '') === 'add') {
        $guildId     = trim((string)($_POST['guild_id'] ?? ''));
        $channelId   = trim((string)($_POST['channel_id'] ?? ''));
        $channelName = trim((string)($_POST['channel_name'] ?? ''));
        $mode        = (string)($_POST['mode'] ?? '');

        if ($guildId === '' || $channelId === '') {
            $error = 'Server und Channel müssen ausgewählt sein.';
        } elseif (!isset($MODE_LABELS[$mode])) {
            $error = 'Ungültiger Modus.';
        } else {
            $db->prepare('INSERT INTO plugin_mediachannel_plugin_channels (bot_id, guild_id, channel_id, channel_name, mode)
                           VALUES (?, ?, ?, ?, ?)
                           ON DUPLICATE KEY UPDATE mode = VALUES(mode), channel_name = VALUES(channel_name)')
               ->execute([$botId, $guildId, $channelId, $channelName ?: null, $mode]);
            $success = 'Channel-Regel gespeichert.';
        }
    } elseif (($_POST['action'] ?? '') === 'delete') {
        $id = (int)($_POST['id'] ?? 0);
        $db->prepare('DELETE FROM plugin_mediachannel_plugin_channels WHERE id = ? AND bot_id = ?')->execute([$id, $botId]);
        $success = 'Channel-Regel gelöscht.';
    }
}

$rules = [];
if ($botId > 0) {
    $stmt = $db->prepare('SELECT id, guild_id, channel_id, channel_name, mode FROM plugin_mediachannel_plugin_channels WHERE bot_id = ? ORDER BY created_at DESC');
    $stmt->execute([$botId]);
    $rules = $stmt->fetchAll(PDO::FETCH_ASSOC);
}

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
        <h2>Channel-Regel hinzufügen</h2>
    </div>
    <form method="post" id="mc-add-form" style="padding:14px 16px;display:flex;gap:10px;flex-wrap:wrap;align-items:end;">
        <input type="hidden" name="csrf" value="<?= $e($csrf) ?>">
        <input type="hidden" name="action" value="add">
        <input type="hidden" name="channel_name" id="mc-channel-name">
        <div class="bh-form-group">
            <label class="bh-label">Server</label>
            <select id="mc-guild-select" name="guild_id" class="bh-input" required>
                <option value="">— Server auswählen —</option>
                <?php foreach ($guilds as $g): ?>
                <option value="<?= $e((string)$g['id']) ?>"><?= $e((string)$g['name']) ?></option>
                <?php endforeach; ?>
            </select>
        </div>
        <div class="bh-form-group">
            <label class="bh-label">Channel</label>
            <select id="mc-channel-select" name="channel_id" class="bh-input" required>
                <option value="">— zuerst Server wählen —</option>
            </select>
        </div>
        <div class="bh-form-group">
            <label class="bh-label">Modus</label>
            <select name="mode" class="bh-input" required>
                <?php foreach ($MODE_LABELS as $key => $label): ?>
                <option value="<?= $e($key) ?>"><?= $e($label) ?></option>
                <?php endforeach; ?>
            </select>
        </div>
        <button type="submit" class="bh-btn bh-btn-primary">➕ Hinzufügen</button>
    </form>
</div>

<div class="bh-card bh-card-lg">
    <div class="bh-card-header">
        <h2>Channel-Regeln (<?= count($rules) ?>)</h2>
    </div>
    <?php if (!$rules): ?>
    <p class="bh-text-muted bh-text-sm" style="padding:14px 16px;">Noch keine Channel-Regeln konfiguriert.</p>
    <?php else: ?>
    <div style="display:flex;flex-direction:column;">
        <?php foreach ($rules as $r): ?>
        <div style="display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--border);">
            <div style="flex:1;min-width:0;">
                <strong style="font-size:13px;">#<?= $e((string)($r['channel_name'] ?: $r['channel_id'])) ?></strong>
                <span class="bh-text-muted bh-text-sm"> · <?= $e($MODE_LABELS[$r['mode']] ?? $r['mode']) ?></span>
            </div>
            <form method="post" onsubmit="return confirm('Regel wirklich löschen?');">
                <input type="hidden" name="csrf" value="<?= $e($csrf) ?>">
                <input type="hidden" name="action" value="delete">
                <input type="hidden" name="id" value="<?= (int)$r['id'] ?>">
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
    const guildSelect   = document.getElementById('mc-guild-select');
    const channelSelect = document.getElementById('mc-channel-select');
    const channelNameEl = document.getElementById('mc-channel-name');

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
        channelSelect.addEventListener('change', function () {
            channelNameEl.value = this.options[this.selectedIndex]?.textContent?.replace(/^#/, '') || '';
        });
    }
})();
</script>
