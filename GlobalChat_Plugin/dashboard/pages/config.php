<?php
declare(strict_types=1);

echo '<link rel="stylesheet" href="/assets/css/components-base.css?v=' . filemtime(BH_ROOT . '/assets/css/components-base.css') . '">';

$botId = (int)($context['botId'] ?? $_SESSION['current_bot_id'] ?? 0);
$db    = bh_db();
$e     = fn(string $v): string => htmlspecialchars($v, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
$csrf  = (string)($_SESSION['csrf_token'] ?? '');

$success = '';
$error   = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST' && $botId > 0 && ($_POST['action'] ?? '') === 'unlink') {
    if (($_SESSION['csrf_token'] ?? '') !== ($_POST['csrf'] ?? '')) {
        $error = 'Ungültiges CSRF-Token.';
    } else {
        $guildId = trim((string)($_POST['guild_id'] ?? ''));
        $db->prepare('DELETE FROM plugin_globalchat_plugin_links WHERE bot_id = ? AND guild_id = ?')
           ->execute([$botId, $guildId]);
        $success = 'Verlinkung aufgehoben.';
    }
}

$links = [];
if ($botId > 0) {
    try {
        $stmt = $db->prepare('SELECT * FROM plugin_globalchat_plugin_links WHERE bot_id = ? ORDER BY linked_at ASC');
        $stmt->execute([$botId]);
        $links = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    } catch (Throwable) {}
}
?>

<?php if ($error !== ''): ?>
<div class="bh-alert bh-alert-error" style="margin-bottom:16px;"><?= $e($error) ?></div>
<?php endif; ?>
<?php if ($success !== ''): ?>
<div class="bh-alert bh-alert-success" style="margin-bottom:16px;"><?= $e($success) ?></div>
<?php endif; ?>

<div class="bh-card bh-card-lg" style="margin-bottom:20px;">
    <div class="bh-card-header">
        <h2>🌐 Global Chat — Verlinkte Server (<?= count($links) ?>)</h2>
    </div>
    <p class="bh-text-muted bh-text-sm" style="padding:16px 20px 0;margin:0;">
        Server verlinken einen Channel per <code>/globalchat-link</code> auf Discord (Berechtigung "Server verwalten" nötig).
        Nachrichten in einem verlinkten Channel werden an alle anderen verlinkten Channels dieses Bots weitergeleitet.
        Wer im Text mit <code>@username</code> erwähnt wird, bekommt zusätzlich eine DM (echte Discord-Mentions pingen server­übergreifend nicht).
    </p>
    <?php if (!$links): ?>
    <div style="padding:24px;color:var(--text-muted);font-size:13px;">
        Noch kein Server hat einen Channel verlinkt.
    </div>
    <?php else: ?>
    <div style="padding:8px 20px 16px;">
        <?php foreach ($links as $l): ?>
        <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);font-size:13px;">
            <div style="flex:1;">
                Guild <code><?= $e((string)$l['guild_id']) ?></code> → Channel <code><?= $e((string)$l['channel_id']) ?></code>
                <?php if (!(int)$l['enabled']): ?><span class="bh-tag" style="font-size:10px;margin-left:8px;">Deaktiviert</span><?php endif; ?>
            </div>
            <form method="post" onsubmit="return confirm('Verlinkung für Guild <?= $e((string)$l['guild_id']) ?> wirklich aufheben?');">
                <input type="hidden" name="csrf" value="<?= $e($csrf) ?>">
                <input type="hidden" name="action" value="unlink">
                <input type="hidden" name="guild_id" value="<?= $e((string)$l['guild_id']) ?>">
                <button type="submit" class="bh-btn bh-btn-danger" style="font-size:12px;padding:4px 10px;">🗑️ Aufheben</button>
            </form>
        </div>
        <?php endforeach; ?>
    </div>
    <?php endif; ?>
</div>

<?php require __DIR__ . '/commands.php'; ?>
