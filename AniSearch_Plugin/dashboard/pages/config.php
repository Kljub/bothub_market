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

$error   = '';
$success = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST' && $botId > 0) {
    if (($_SESSION['csrf_token'] ?? '') !== ($_POST['csrf'] ?? '')) {
        $error = __('common.csrf_invalid');
    } elseif (($_POST['action'] ?? '') === 'save_settings') {
        $channelId = trim((string)($_POST['channel_id'] ?? ''));
        $db->prepare('INSERT INTO plugin_anisearch_plugin_settings (bot_id, channel_id) VALUES (?, ?)
                       ON DUPLICATE KEY UPDATE channel_id = VALUES(channel_id)')
           ->execute([$botId, $channelId ?: null]);
        $success = 'Einstellungen gespeichert.';
    } elseif (($_POST['action'] ?? '') === 'remove_tracked') {
        $anilistId = (int)($_POST['anilist_id'] ?? 0);
        $db->prepare('DELETE FROM plugin_anisearch_plugin_tracked WHERE bot_id = ? AND anilist_id = ?')
           ->execute([$botId, $anilistId]);
        $success = 'Anime wird nicht mehr verfolgt.';
    }
}

$settings = null;
$tracked  = [];
if ($botId > 0) {
    $stmt = $db->prepare('SELECT * FROM plugin_anisearch_plugin_settings WHERE bot_id = ? LIMIT 1');
    $stmt->execute([$botId]);
    $settings = $stmt->fetch(PDO::FETCH_ASSOC) ?: null;

    $stmt = $db->prepare('SELECT * FROM plugin_anisearch_plugin_tracked WHERE bot_id = ? ORDER BY title ASC');
    $stmt->execute([$botId]);
    $tracked = $stmt->fetchAll(PDO::FETCH_ASSOC);
}

$curChannel = (string)($settings['channel_id'] ?? '');

// ── Seed and load command states ────────────────────────────────────────────
$pk = 'anisearch-plugin';
$cmdDefs = [
    ['key' => 'anisearch-plugin:anisearch-anime',    'slash' => 'anisearch-anime',    'desc' => bh_plugin_t($pk, 'anime.desc'),                                      'options' => [['label' => 'titel', 'required' => true, 'type' => 'string']]],
    ['key' => 'anisearch-plugin:anisearch-manga',    'slash' => 'anisearch-manga',    'desc' => bh_plugin_t($pk, 'manga.desc'),                                      'options' => [['label' => 'titel', 'required' => true, 'type' => 'string']]],
    ['key' => 'anisearch-plugin:anisearch-track',    'slash' => 'anisearch-track',    'desc' => bh_plugin_t($pk, 'track.desc'),        'options' => [['label' => 'titel', 'required' => true, 'type' => 'string']]],
    ['key' => 'anisearch-plugin:anisearch-untrack',  'slash' => 'anisearch-untrack',  'desc' => bh_plugin_t($pk, 'untrack.desc'),                                    'options' => [['label' => 'titel', 'required' => true, 'type' => 'string']]],
    ['key' => 'anisearch-plugin:anisearch-list',     'slash' => 'anisearch-list',     'desc' => bh_plugin_t($pk, 'list.desc'),                         'options' => []],
];

$cmdStates = [];
if ($botId > 0) {
    foreach ($cmdDefs as $def) {
        $key = $def['key'];
        $db->prepare('INSERT IGNORE INTO bot_module_states (bot_id, module_key, enabled) VALUES (?, ?, 1)')
           ->execute([$botId, $key]);
        $stmt = $db->prepare('SELECT enabled, settings FROM bot_module_states WHERE bot_id = ? AND module_key = ? LIMIT 1');
        $stmt->execute([$botId, $key]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];
        $cmdStates[$key] = [
            'enabled'  => (bool)($row['enabled'] ?? true),
            'settings' => json_decode($row['settings'] ?? '{}', true) ?: [],
        ];
    }
}

$discordPerms = [
    'Administrator'   => 'Administrator',
    'ManageGuild'     => __('perm.manage_guild'),
    'ManageRoles'     => __('perm.manage_roles'),
    'ManageChannels'  => __('perm.manage_channels'),
    'KickMembers'     => __('perm.kick_members'),
    'BanMembers'      => __('perm.ban_members'),
    'ManageMessages'  => __('perm.manage_messages'),
    'ModerateMembers' => __('perm.moderate_members'),
];

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
        <input type="hidden" name="channel_id" id="ani-channel-id" value="<?= $e($curChannel) ?>">
        <div class="bh-form-group">
            <label class="bh-label">Server</label>
            <select id="ani-guild-select" class="bh-input">
                <option value="">— Server auswählen —</option>
                <?php foreach ($guilds as $g): ?>
                <option value="<?= $e((string)$g['id']) ?>"><?= $e((string)$g['name']) ?></option>
                <?php endforeach; ?>
            </select>
        </div>
        <div class="bh-form-group">
            <label class="bh-label">Ziel-Channel (für neue Episoden)</label>
            <select id="ani-channel-select" class="bh-input">
                <option value="">— zuerst Server wählen —</option>
                <?php if ($curChannel): ?>
                <option value="<?= $e($curChannel) ?>" selected>Aktuell: <?= $e($curChannel) ?></option>
                <?php endif; ?>
            </select>
        </div>
        <button type="submit" class="bh-btn bh-btn-primary">💾 Speichern</button>
    </form>
</div>

<div class="bh-card bh-card-lg" style="margin-bottom:20px;">
    <div class="bh-card-header">
        <h2>Verfolgte Anime (<?= count($tracked) ?>)</h2>
    </div>
    <p class="bh-text-muted bh-text-sm" style="padding:0 16px;margin:8px 0;">Hinzufügen über <code style="background:var(--bg-secondary);padding:1px 5px;border-radius:3px">/anisearch-track</code> im Discord-Server.</p>
    <?php if (!$tracked): ?>
    <p class="bh-text-muted bh-text-sm" style="padding:14px 16px;">Aktuell wird kein Anime verfolgt.</p>
    <?php else: ?>
    <div style="display:flex;flex-direction:column;">
        <?php foreach ($tracked as $t): ?>
        <div style="display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--border);">
            <div style="flex:1;min-width:0;">
                <strong style="font-size:13px;"><?= $e($t['title']) ?></strong>
                <span class="bh-text-muted bh-text-sm"><?= $t['last_known_episode'] !== null ? ' · nächste Episode: ' . (int)$t['last_known_episode'] : '' ?></span>
            </div>
            <form method="post" onsubmit="return confirm('\'<?= $e($t['title']) ?>\' wirklich nicht mehr verfolgen?');">
                <input type="hidden" name="csrf" value="<?= $e($csrf) ?>">
                <input type="hidden" name="action" value="remove_tracked">
                <input type="hidden" name="anilist_id" value="<?= (int)$t['anilist_id'] ?>">
                <button type="submit" class="bh-btn bh-btn-danger" style="font-size:12px;padding:4px 10px;">🗑️</button>
            </form>
        </div>
        <?php endforeach; ?>
    </div>
    <?php endif; ?>
</div>

<div class="bh-card">
    <div class="bh-card-title">🎮 Commands</div>
    <?php foreach ($cmdDefs as $def):
        $rowModuleKey    = $def['key'];
        $rowCmdCode      = '/' . $def['slash'];
        $rowDesc         = $def['desc'];
        $rowOptions      = $def['options'];
        $rowEnabled      = (bool)$cmdStates[$def['key']]['enabled'];
        $rowPermCfg      = (array)$cmdStates[$def['key']]['settings'];
        $rowDiscordPerms = $discordPerms;
        require BH_ROOT . '/assets/features/module-command-row.php';
    endforeach; ?>
</div>

<script>
(function () {
    const BOT_ID = <?= (int)$botId ?>;
    const guildSelect   = document.getElementById('ani-guild-select');
    const channelSelect = document.getElementById('ani-channel-select');
    const channelIdEl   = document.getElementById('ani-channel-id');

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
