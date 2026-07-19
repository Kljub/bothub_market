<?php
declare(strict_types=1);

echo '<link rel="stylesheet" href="/assets/css/components-base.css?v=' . filemtime(BH_ROOT . '/assets/css/components-base.css') . '">';

$botId = (int)($context['botId'] ?? $_SESSION['current_bot_id'] ?? 0);
$db    = bh_db();
$csrf  = (string)($_SESSION['csrf_token'] ?? '');
$e     = fn(string $v): string => htmlspecialchars($v, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');

$commands = [
    'globalchat-plugin:globalchat-link'   => ['cmd' => '/globalchat-link',   'label' => 'Global Chat Link',   'desc' => 'Channel mit Cross-Server-Chat verlinken', 'defaultPerms' => ['ManageGuild']],
    'globalchat-plugin:globalchat-unlink' => ['cmd' => '/globalchat-unlink', 'label' => 'Global Chat Unlink', 'desc' => 'Verlinkung entfernen',                    'defaultPerms' => ['ManageGuild']],
];

$states = [];
if ($botId > 0) {
    foreach ($commands as $key => $meta) {
        $stmt = $db->prepare('SELECT COUNT(*) FROM bot_module_states WHERE bot_id = ? AND module_key = ?');
        $stmt->execute([$botId, $key]);
        if ((int)$stmt->fetchColumn() === 0) {
            $settingsJson = $meta['defaultPerms'] ? json_encode(['required_permissions' => $meta['defaultPerms']]) : '{}';
            $db->prepare('INSERT IGNORE INTO bot_module_states (bot_id, module_key, enabled, settings) VALUES (?, ?, 1, ?)')
               ->execute([$botId, $key, $settingsJson]);
        }
    }
    $stmt = $db->prepare('SELECT module_key, enabled, settings FROM bot_module_states WHERE bot_id = ? AND module_key LIKE "globalchat-plugin:%"');
    $stmt->execute([$botId]);
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $states[$r['module_key']] = [
            'enabled'  => (bool)$r['enabled'],
            'settings' => json_decode((string)($r['settings'] ?? '{}'), true) ?? [],
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

<div class="bh-card bh-card-lg">
    <div class="bh-card-header">
        <h2>Global-Chat-Commands (<?= count($commands) ?>)</h2>
    </div>
    <div id="globalchat-commands">
        <?php foreach ($commands as $mk => $mod):
            $isOn    = $states[$mk]['enabled'] ?? true;
            $cfg     = $states[$mk]['settings'] ?? [];
            $hasPerms = !empty($cfg['allowed_roles']) || !empty($cfg['banned_roles'])
                     || !empty($cfg['required_permissions']) || !empty($cfg['banned_channels']);
            $panelId = 'perm-globalchat-' . str_replace(':', '-', $mk);
        ?>
        <div class="bh-module-row">
            <div style="display:flex;align-items:center;gap:12px;padding:10px 16px;flex:1;min-width:0;">
                <?php
                $cmdHeading = [
                    'code' => (string)$mod['cmd'], 'key' => str_replace(':', '-', $mk), 'label' => (string)$mod['label'],
                    'desc' => (string)$mod['desc'], 'label_color' => $isOn ? 'var(--text-primary)' : 'var(--text-muted)',
                ];
                require BH_ROOT . '/assets/features/command-heading.php';
                ?>

                <button class="bh-perm-btn <?= $hasPerms ? 'has-perms' : '' ?>" title="Berechtigungen" onclick="bhTogglePerms('<?= $e($panelId) ?>')">
                    <svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13">
                        <path d="M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.464 1.464 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311c.446.82.023 1.841-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.464 1.464 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.464 1.464 0 0 1 2.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.464 1.464 0 0 1 2.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.464 1.464 0 0 1 .872-2.105l.34-.1c1.4-.413 1.4-2.397 0-2.81l-.34-.1a1.464 1.464 0 0 1-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.464 1.464 0 0 1-2.105-.872l-.1-.34zM8 10.93a2.929 2.929 0 1 1 0-5.86 2.929 2.929 0 0 1 0 5.858z"/>
                    </svg>
                </button>

                <label class="bh-toggle" style="--toggle-color:#3b82f6;">
                    <input type="checkbox" class="bh-cmd-toggle" <?= $isOn ? 'checked' : '' ?>
                           onchange="bhCmdUpdateLabel('<?= $e(str_replace(':', '-', $mk)) ?>',this.checked); bhToggleMod('<?= $e($mk) ?>',this.checked,this,true)">
                    <span class="bh-toggle-track"><span class="bh-toggle-thumb"></span></span>
                </label>
            </div>

            <?php
            $permModuleKey    = $mk;
            $permPanelId      = $panelId;
            $permCfg          = $cfg;
            $permDiscordPerms = $discordPerms;
            require BH_ROOT . '/assets/features/permissions-panel.php';
            ?>
        </div>
        <?php endforeach; ?>
    </div>
</div>

<style>
.bh-module-row { border-bottom: 1px solid var(--border); }
.bh-module-row:last-child { border-bottom: none; }
.bh-module-row > div:first-child:hover { background: var(--bg-hover); }
.bh-toggle { position: relative; display: inline-flex; cursor: pointer; flex-shrink: 0; }
.bh-toggle input { position: absolute; opacity: 0; width: 0; height: 0; }
.bh-toggle-track { width: 36px; height: 20px; background: var(--border-bright); border-radius: 10px; transition: background .2s; display: flex; align-items: center; padding: 2px; }
.bh-toggle input:checked ~ .bh-toggle-track { background: var(--toggle-color, var(--accent)); }
.bh-toggle-thumb { width: 16px; height: 16px; background: #fff; border-radius: 50%; transition: transform .2s; box-shadow: 0 1px 3px rgba(0,0,0,.3); }
.bh-toggle input:checked ~ .bh-toggle-track .bh-toggle-thumb { transform: translateX(16px); }
.bh-perm-btn { background: none; border: 1px solid var(--border); width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: var(--radius-sm); cursor: pointer; color: var(--text-secondary); flex-shrink: 0; }
.bh-perm-btn:hover { background: var(--bg-hover); border-color: var(--border-bright); color: var(--text-primary); }
.bh-perm-btn.has-perms { border-color: #3b82f6; color: #3b82f6; background: #3b82f610; }
</style>

<script>
window.BH_CSRF   = <?= json_encode($csrf) ?>;
window.BH_BOT_ID = <?= (int)$botId ?>;
</script>
