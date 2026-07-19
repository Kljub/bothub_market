<?php
declare(strict_types=1);

echo '<link rel="stylesheet" href="/assets/css/components-base.css?v=' . filemtime(BH_ROOT . '/assets/css/components-base.css') . '">';

$botId = (int)($context['botId'] ?? $_SESSION['current_bot_id'] ?? 0);
$db    = bh_db();
$csrf  = (string)($_SESSION['csrf_token'] ?? '');
$e     = fn(string $v): string => htmlspecialchars($v, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
$pk    = 'qotd-plugin';

$factsList = [];
if ($botId > 0) {
    try {
        $stmt = $db->prepare('SELECT * FROM plugin_qotd_plugin_facts WHERE bot_id = ? ORDER BY id ASC');
        $stmt->execute([$botId]);
        $factsList = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    } catch (Throwable) {}
}
?>

<div class="bh-card bh-card-lg" style="margin-bottom:20px;">
    <div class="bh-card-header">
        <h2><?= bh_plugin_te($pk, 'config.heading', ['n' => count($factsList)]) ?></h2>
    </div>
    <div style="padding:16px 20px;border-bottom:1px solid var(--border);">
        <div style="display:flex;gap:8px;">
            <input type="text" class="bh-input" id="qotd-new-text" placeholder="<?= bh_plugin_te($pk, 'config.new_text_placeholder') ?>" style="flex:1;">
            <button type="button" class="bh-btn bh-btn-ghost" onclick="BHVarPicker.open(document.getElementById('qotd-new-text'))" title="<?= bh_plugin_te($pk, 'config.insert_var_title') ?>">⌗</button>
            <button type="button" class="bh-btn bh-btn-primary" id="qotd-add-btn"><?= bh_plugin_te($pk, 'config.add_btn') ?></button>
        </div>
        <small class="bh-hint"><?= bh_plugin_t($pk, 'config.available_vars_hint') ?></small>
    </div>
    <div id="qotd-facts-list">
        <?php if (!$factsList): ?>
        <div style="padding:24px;color:var(--text-muted);font-size:13px;">
            <?= bh_plugin_t($pk, 'config.no_facts') ?>
        </div>
        <?php endif; ?>
        <?php foreach ($factsList as $f): ?>
        <div class="bh-module-row" data-id="<?= (int)$f['id'] ?>" style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;">
            <label class="bh-toggle-row" style="margin:0;">
                <input type="checkbox" class="bh-checkbox qotd-fact-enabled" <?= (int)$f['enabled'] ? 'checked' : '' ?>>
                <span class="bh-toggle-switch"></span>
            </label>
            <input type="text" class="bh-input qotd-fact-text" value="<?= $e((string)$f['text']) ?>" style="flex:1;">
            <button type="button" class="bh-btn bh-btn-ghost bh-btn-sm" onclick="BHVarPicker.open(this.previousElementSibling)" title="<?= bh_plugin_te($pk, 'config.insert_var_title') ?>">⌗</button>
            <button type="button" class="bh-btn bh-btn-sm qotd-save-btn"><?= __e('common.save') ?></button>
            <button type="button" class="bh-btn bh-btn-sm bh-btn-danger qotd-delete-btn"><?= __e('common.delete') ?></button>
        </div>
        <?php endforeach; ?>
    </div>
</div>

<?php require BH_ROOT . '/assets/features/builder-var-picker.php'; ?>

<script>
var QOTD_I18N = {
    error: <?= json_encode(__('common.error')) ?>,
    confirmDelete: <?= json_encode(bh_plugin_t($pk, 'config.confirm_delete')) ?>
};

BHVarPicker.registerCategory(<?= json_encode(bh_plugin_t($pk, 'config.var_category')) ?>, [
    { tag: '{PLUGIN_COUNT}',         name: <?= json_encode(bh_plugin_t($pk, 'config.vars.plugin_count.name')) ?>,         desc: <?= json_encode(bh_plugin_t($pk, 'config.vars.plugin_count.desc')) ?>,         type: 'number', example: '14' },
    { tag: '{ENABLED_PLUGIN_COUNT}', name: <?= json_encode(bh_plugin_t($pk, 'config.vars.enabled_plugin_count.name')) ?>, desc: <?= json_encode(bh_plugin_t($pk, 'config.vars.enabled_plugin_count.desc')) ?>, type: 'number', example: '12' },
    { tag: '{STORE_PLUGIN_COUNT}',   name: <?= json_encode(bh_plugin_t($pk, 'config.vars.store_plugin_count.name')) ?>,   desc: <?= json_encode(bh_plugin_t($pk, 'config.vars.store_plugin_count.desc')) ?>,   type: 'number', example: '14' },
    { tag: '{BOT_COUNT}',            name: <?= json_encode(bh_plugin_t($pk, 'config.vars.bot_count.name')) ?>,            desc: <?= json_encode(bh_plugin_t($pk, 'config.vars.bot_count.desc')) ?>,            type: 'number', example: '4' },
    { tag: '{COMMAND_COUNT}',        name: <?= json_encode(bh_plugin_t($pk, 'config.vars.command_count.name')) ?>,        desc: <?= json_encode(bh_plugin_t($pk, 'config.vars.command_count.desc')) ?>,        type: 'number', example: '160' },
    { tag: '{OLDEST_PLUGIN}',        name: <?= json_encode(bh_plugin_t($pk, 'config.vars.oldest_plugin.name')) ?>,        desc: <?= json_encode(bh_plugin_t($pk, 'config.vars.oldest_plugin.desc')) ?>,        type: 'text', example: 'Weather Plugin' },
]);

(function () {
    'use strict';
    var CSRF = <?= json_encode($csrf) ?>;

    document.getElementById('qotd-add-btn').addEventListener('click', async function () {
        var input = document.getElementById('qotd-new-text');
        var text = input.value.trim();
        if (!text) return;
        var res = await fetch('/api/v1/plugins/qotd', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ csrf_token: CSRF, action: 'add_fact', text: text })
        });
        var d = await res.json();
        if (d.ok) location.reload(); else alert(d.error || QOTD_I18N.error);
    });

    document.querySelectorAll('.qotd-save-btn').forEach(function (btn) {
        btn.addEventListener('click', async function () {
            var row = this.closest('.bh-module-row');
            var res = await fetch('/api/v1/plugins/qotd', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    csrf_token: CSRF, action: 'update_fact', id: parseInt(row.dataset.id, 10),
                    text: row.querySelector('.qotd-fact-text').value.trim(),
                    enabled: row.querySelector('.qotd-fact-enabled').checked
                })
            });
            var d = await res.json();
            if (!d.ok) alert(d.error || QOTD_I18N.error);
        });
    });

    document.querySelectorAll('.qotd-delete-btn').forEach(function (btn) {
        btn.addEventListener('click', async function () {
            if (!confirm(QOTD_I18N.confirmDelete)) return;
            var row = this.closest('.bh-module-row');
            var res = await fetch('/api/v1/plugins/qotd', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ csrf_token: CSRF, action: 'delete_fact', id: parseInt(row.dataset.id, 10) })
            });
            var d = await res.json();
            if (d.ok) row.remove(); else alert(d.error || QOTD_I18N.error);
        });
    });
}());
</script>

<?php require __DIR__ . '/commands.php'; ?>
