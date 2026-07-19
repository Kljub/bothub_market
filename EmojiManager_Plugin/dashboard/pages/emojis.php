<?php
declare(strict_types=1);

echo '<link rel="stylesheet" href="/assets/css/components-base.css?v=' . filemtime(BH_ROOT . '/assets/css/components-base.css') . '">';

$botId = (int)($context['botId'] ?? $_SESSION['current_bot_id'] ?? 0);
$db    = bh_db();
$e     = fn(string $v): string => htmlspecialchars($v, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');

// Uploads liegen pro Bot in storage/ (nicht im Plugin-Ordner selbst — der landet sonst im
// öffentlichen Plugin-Template beim GitHub-Push), gleiches Muster wie Custom Nodes
// (storage/custom-nodes/{botId}/...).
$emojisDir = dirname(BH_ROOT) . '/storage/emojimanager/' . $botId;
if (!is_dir($emojisDir)) @mkdir($emojisDir, 0755, true);

$ALLOWED_EXT = ['png', 'gif', 'webp', 'jpg', 'jpeg'];
$MAX_BYTES   = 2 * 1024 * 1024;

$error   = '';
$success = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST' && $botId > 0) {
    // PHP leert $_POST/$_FILES komplett (auch das csrf-Feld!), wenn der Body
    // post_max_size überschreitet — zeigt sonst irreführend "Ungültiges CSRF-Token"
    // statt des eigentlichen Problems (Datei zu groß fürs Server-Limit).
    if (empty($_POST) && empty($_FILES) && (int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 0) {
        $error = 'Datei zu groß — überschreitet das Server-Limit (' . ini_get('post_max_size') . ').';
    } elseif (($_SESSION['csrf_token'] ?? '') !== ($_POST['csrf'] ?? '')) {
        $error = 'Ungültiges CSRF-Token.';
    } elseif (($_POST['action'] ?? '') === 'upload') {
        $name = strtolower(trim((string)($_POST['name'] ?? '')));
        $name = preg_replace('/[^a-z0-9_\-]/', '', $name);

        if ($name === '' || strlen($name) > 32) {
            $error = 'Ungültiger Name (nur a-z, 0-9, _, - · max. 32 Zeichen).';
        } elseif (empty($_FILES['emoji_file']) || $_FILES['emoji_file']['error'] !== UPLOAD_ERR_OK) {
            $error = 'Datei-Upload fehlgeschlagen.';
        } else {
            $file = $_FILES['emoji_file'];
            $ext  = strtolower(pathinfo((string)$file['name'], PATHINFO_EXTENSION));
            if (!in_array($ext, $ALLOWED_EXT, true)) {
                $error = 'Nur ' . implode(', ', $ALLOWED_EXT) . ' erlaubt.';
            } elseif ($file['size'] > $MAX_BYTES) {
                $error = 'Datei zu groß (max. 2 MB).';
            } else {
                $stmt = $db->prepare('SELECT id FROM plugin_emojimanager_plugin_emojis WHERE bot_id = ? AND name = ? LIMIT 1');
                $stmt->execute([$botId, $name]);
                if ($stmt->fetch()) {
                    $error = "Ein Emoji namens \"$name\" existiert bereits.";
                } else {
                    $filename = $botId . '_' . bin2hex(random_bytes(6)) . '.' . $ext;
                    if (move_uploaded_file($file['tmp_name'], $emojisDir . '/' . $filename)) {
                        $db->prepare('INSERT INTO plugin_emojimanager_plugin_emojis (bot_id, name, filename, uploaded_by) VALUES (?, ?, ?, ?)')
                           ->execute([$botId, $name, $filename, (string)($_SESSION['username'] ?? '')]);
                        $success = "Emoji \"$name\" hochgeladen.";
                    } else {
                        $error = 'Datei konnte nicht gespeichert werden.';
                    }
                }
            }
        }
    } elseif (($_POST['action'] ?? '') === 'delete') {
        $id = (int)($_POST['id'] ?? 0);
        $stmt = $db->prepare('SELECT filename FROM plugin_emojimanager_plugin_emojis WHERE id = ? AND bot_id = ? LIMIT 1');
        $stmt->execute([$id, $botId]);
        $row = $stmt->fetch();
        if ($row) {
            @unlink($emojisDir . '/' . $row['filename']);
            $db->prepare('DELETE FROM plugin_emojimanager_plugin_emojis WHERE id = ? AND bot_id = ?')->execute([$id, $botId]);
            $success = 'Emoji gelöscht.';
        }
    }
}

$emojiList = [];
if ($botId > 0) {
    $stmt = $db->prepare('SELECT id, name, filename, use_count, uploaded_by FROM plugin_emojimanager_plugin_emojis WHERE bot_id = ? ORDER BY name ASC');
    $stmt->execute([$botId]);
    $emojiList = $stmt->fetchAll(PDO::FETCH_ASSOC);
}

// ── Commands (gleiche Route, keine eigene Seite — Muster wie bei allen anderen Plugins) ──
$commands = [
    'emojimanager-plugin:emoji-menu' => ['cmd' => '/emoji-menu', 'label' => 'Emoji Menu', 'desc' => 'Öffnet das (nur für dich sichtbare) Emoji-Auswahlmenü', 'defaultPerms' => []],
];

$cmdStates = [];
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
    $stmt = $db->prepare('SELECT module_key, enabled, settings FROM bot_module_states WHERE bot_id = ? AND module_key LIKE "emojimanager-plugin:%"');
    $stmt->execute([$botId]);
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $cmdStates[$r['module_key']] = [
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
        <h2>Emoji hochladen</h2>
    </div>
    <form method="post" enctype="multipart/form-data" style="padding:14px 16px;display:flex;gap:10px;flex-wrap:wrap;align-items:end;">
        <input type="hidden" name="csrf" value="<?= $e($csrf) ?>">
        <input type="hidden" name="action" value="upload">
        <div>
            <label class="bh-text-sm bh-text-muted" style="display:block;margin-bottom:4px;">Name (im Menü angezeigt)</label>
            <input type="text" name="name" class="bh-input" placeholder="z.B. pogchamp" maxlength="32" required pattern="[a-z0-9_\-]+" style="width:220px;">
        </div>
        <div>
            <label class="bh-text-sm bh-text-muted" style="display:block;margin-bottom:4px;">Bild (png, gif, webp, jpg — max. 2 MB)</label>
            <input type="file" name="emoji_file" accept=".png,.gif,.webp,.jpg,.jpeg" required>
        </div>
        <button type="submit" class="bh-btn bh-btn-primary">⬆️ Hochladen</button>
    </form>
</div>

<div class="bh-card bh-card-lg" style="margin-bottom:20px;">
    <div class="bh-card-title">🎮 Commands</div>
    <?php foreach ($commands as $mk => $mod):
        $isOn     = $cmdStates[$mk]['enabled'] ?? true;
        $cfg      = $cmdStates[$mk]['settings'] ?? [];
        $hasPerms = !empty($cfg['allowed_roles']) || !empty($cfg['banned_roles'])
                 || !empty($cfg['required_permissions']) || !empty($cfg['banned_channels']);
        $panelId  = 'perm-' . str_replace(':', '-', $mk);
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

            <label class="bh-toggle">
                <input type="checkbox" class="bh-cmd-toggle" <?= $isOn ? 'checked' : '' ?>
                       onchange="bhToggleMod('<?= $e($mk) ?>',this.checked,this,true)">
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

<div class="bh-card bh-card-lg">
    <div class="bh-card-header">
        <h2>Emojis (<?= count($emojiList) ?>) <span class="bh-text-muted bh-text-sm">— max. 25 im Menü sichtbar</span></h2>
    </div>
    <?php if (!$emojiList): ?>
    <p class="bh-text-muted bh-text-sm" style="padding:14px 16px;">Noch keine Emojis hochgeladen.</p>
    <?php else: ?>
    <div style="display:flex;flex-direction:column;">
        <?php foreach ($emojiList as $em): ?>
        <div style="display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--border);">
            <div style="flex:1;min-width:0;">
                <strong style="font-size:13px;"><?= $e($em['name']) ?></strong>
                <span class="bh-text-muted bh-text-sm"> · <?= (int)$em['use_count'] ?>× gesendet<?= $em['uploaded_by'] ? ' · von ' . $e($em['uploaded_by']) : '' ?></span>
            </div>
            <form method="post" onsubmit="return confirm('Emoji \'<?= $e($em['name']) ?>\' wirklich löschen?');">
                <input type="hidden" name="csrf" value="<?= $e($csrf) ?>">
                <input type="hidden" name="action" value="delete">
                <input type="hidden" name="id" value="<?= (int)$em['id'] ?>">
                <button type="submit" class="bh-btn bh-btn-danger" style="font-size:12px;padding:4px 10px;">🗑️</button>
            </form>
        </div>
        <?php endforeach; ?>
    </div>
    <?php endif; ?>
</div>

<script>
window.BH_CSRF   = <?= json_encode($csrf) ?>;
window.BH_BOT_ID = <?= (int)$botId ?>;
</script>
