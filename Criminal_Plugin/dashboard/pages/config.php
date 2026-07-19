<?php
declare(strict_types=1);

echo '<link rel="stylesheet" href="/assets/css/components-base.css?v=' . filemtime(BH_ROOT . '/assets/css/components-base.css') . '">';

$botId = (int)($context['botId'] ?? $_SESSION['current_bot_id'] ?? 0);
$db    = bh_db();
$csrf  = (string)($_SESSION['csrf_token'] ?? '');
$e     = fn(string $v): string => htmlspecialchars($v, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');

$pk = 'criminal-plugin';

$currencies = [];
if ($botId > 0) {
    try {
        $stmt = $db->prepare('SELECT currency_key, name, symbol FROM bot_economy_currencies WHERE bot_id = ? ORDER BY is_default DESC, name ASC');
        $stmt->execute([$botId]);
        $currencies = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    } catch (Throwable) {}
}

$settings = null;
if ($botId > 0) {
    try {
        $stmt = $db->prepare('SELECT * FROM plugin_criminal_plugin_settings WHERE bot_id = ? LIMIT 1');
        $stmt->execute([$botId]);
        $settings = $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
    } catch (Throwable) {}
}

$successChance = $settings ? (float)$settings['success_chance'] : 50.00;
$stealPercent  = $settings ? (float)$settings['steal_percent'] : 20.00;
$failPenalty   = $settings ? (float)$settings['fail_penalty_percent'] : 15.00;
$allowed       = $settings && $settings['allowed_currencies'] ? (json_decode((string)$settings['allowed_currencies'], true) ?: []) : [];
?>

<div class="bh-card bh-card-lg" style="margin-bottom:20px;">
    <div class="bh-card-header">
        <h2><?= bh_plugin_te($pk, 'config.heading') ?></h2>
    </div>
    <?php if (empty($currencies)): ?>
    <div style="padding:24px;color:var(--text-muted);font-size:13px;">
        <?= bh_plugin_t($pk, 'config.no_currency') ?>
    </div>
    <?php else: ?>
    <div style="padding:20px;display:flex;flex-direction:column;gap:18px;">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;">
            <div class="bh-form-group" style="margin:0;">
                <label class="bh-label"><?= bh_plugin_te($pk, 'config.success_chance_label') ?></label>
                <input type="number" class="bh-input" id="cr-success" min="1" max="99" step="1" value="<?= $e((string)$successChance) ?>">
                <small class="bh-hint"><?= bh_plugin_te($pk, 'config.success_chance_hint') ?></small>
            </div>
            <div class="bh-form-group" style="margin:0;">
                <label class="bh-label"><?= bh_plugin_te($pk, 'config.steal_percent_label') ?></label>
                <input type="number" class="bh-input" id="cr-steal" min="1" max="100" step="1" value="<?= $e((string)$stealPercent) ?>">
                <small class="bh-hint"><?= bh_plugin_te($pk, 'config.steal_percent_hint') ?></small>
            </div>
            <div class="bh-form-group" style="margin:0;">
                <label class="bh-label"><?= bh_plugin_te($pk, 'config.fail_penalty_label') ?></label>
                <input type="number" class="bh-input" id="cr-penalty" min="0" max="100" step="1" value="<?= $e((string)$failPenalty) ?>">
                <small class="bh-hint"><?= bh_plugin_te($pk, 'config.fail_penalty_hint') ?></small>
            </div>
        </div>
        <div>
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;"><?= bh_plugin_te($pk, 'config.allowed_currencies_hint') ?></div>
            <div style="display:flex;flex-wrap:wrap;gap:12px;">
                <?php foreach ($currencies as $c): ?>
                <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;">
                    <input type="checkbox" class="bh-checkbox cr-currency" value="<?= $e($c['currency_key']) ?>"
                           <?= in_array($c['currency_key'], $allowed, true) ? 'checked' : '' ?>>
                    <?= $e($c['symbol']) ?> <?= $e($c['name']) ?>
                </label>
                <?php endforeach; ?>
            </div>
        </div>
        <div style="display:flex;justify-content:flex-end;">
            <button type="button" class="bh-btn bh-btn-primary" id="cr-save-btn"><?= __e('common.save') ?></button>
        </div>
        <div id="cr-save-msg" style="font-size:12px;"></div>
    </div>
    <?php endif; ?>
</div>

<script>
(function () {
    'use strict';
    var CSRF = <?= json_encode($csrf) ?>;
    var I18N = {
        saving: <?= json_encode(bh_plugin_t($pk, 'config.saving')) ?>,
        saved: <?= json_encode(__('common.saved')) ?>,
        error: <?= json_encode(__('common.error')) ?>,
        networkError: <?= json_encode(__('common.network_error')) ?>
    };

    document.getElementById('cr-save-btn')?.addEventListener('click', async function () {
        var msg = document.getElementById('cr-save-msg');
        var currencies = [];
        document.querySelectorAll('.cr-currency:checked').forEach(function (cb) { currencies.push(cb.value); });

        msg.textContent = I18N.saving;
        msg.style.color = 'var(--text-muted)';
        try {
            var res = await fetch('/api/v1/plugins/criminal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    csrf_token: CSRF,
                    action: 'save_settings',
                    success_chance: parseFloat(document.getElementById('cr-success').value) || 50,
                    steal_percent: parseFloat(document.getElementById('cr-steal').value) || 20,
                    fail_penalty_percent: parseFloat(document.getElementById('cr-penalty').value) || 15,
                    allowed_currencies: currencies
                })
            });
            var d = await res.json();
            if (d.ok) { msg.style.color = '#4ade80'; msg.textContent = '✓ ' + I18N.saved; }
            else { msg.style.color = '#ef4444'; msg.textContent = d.error || I18N.error; }
        } catch (e) {
            msg.style.color = '#ef4444';
            msg.textContent = I18N.networkError;
        }
    });
}());
</script>

<?php require __DIR__ . '/commands.php'; ?>
