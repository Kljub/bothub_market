<?php
declare(strict_types=1);

echo '<link rel="stylesheet" href="/assets/css/components-base.css?v=' . filemtime(BH_ROOT . '/assets/css/components-base.css') . '">';

$botId = (int)($context['botId'] ?? $_SESSION['current_bot_id'] ?? 0);
$db    = bh_db();
$csrf  = (string)($_SESSION['csrf_token'] ?? '');
$e     = fn(string $v): string => htmlspecialchars($v, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');

$pk = 'casino-plugin';
$games = [
    'coinflip'  => ['label' => '🪙 Coinflip',  'desc' => bh_plugin_t($pk, 'games.coinflip.desc')],
    'dice'      => ['label' => '🎲 Dice',      'desc' => bh_plugin_t($pk, 'games.dice.desc')],
    'slots'     => ['label' => '🎰 Slots',     'desc' => bh_plugin_t($pk, 'games.slots.desc')],
    'roulette'  => ['label' => '🎡 Roulette',  'desc' => bh_plugin_t($pk, 'games.roulette.desc')],
    'blackjack' => ['label' => '🃏 BlackJack', 'desc' => bh_plugin_t($pk, 'games.blackjack.desc')],
];

$currencies = [];
if ($botId > 0) {
    try {
        $stmt = $db->prepare('SELECT currency_key, name, symbol FROM bot_economy_currencies WHERE bot_id = ? ORDER BY is_default DESC, name ASC');
        $stmt->execute([$botId]);
        $currencies = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    } catch (Throwable) {}
}

$gameSettings = [];
if ($botId > 0) {
    try {
        $stmt = $db->prepare('SELECT * FROM plugin_casino_plugin_game_settings WHERE bot_id = ?');
        $stmt->execute([$botId]);
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $gameSettings[$r['game_key']] = $r;
        }
    } catch (Throwable) {}
}

$defaults = [
    'coinflip'  => ['rtp' => 97.00, 'min_bet' => 10, 'max_bet' => 1000],
    'dice'      => ['rtp' => 95.00, 'min_bet' => 10, 'max_bet' => 1000],
    'slots'     => ['rtp' => 94.00, 'min_bet' => 10, 'max_bet' => 500],
    'roulette'  => ['rtp' => 95.00, 'min_bet' => 10, 'max_bet' => 500],
    'blackjack' => ['rtp' => 98.00, 'min_bet' => 10, 'max_bet' => 1000],
];
?>

<div class="bh-card bh-card-lg" style="margin-bottom:20px;">
    <div class="bh-card-header">
        <h2><?= bh_plugin_te($pk, 'games.title') ?></h2>
    </div>
    <?php if (empty($currencies)): ?>
    <div style="padding:24px;color:var(--text-muted);font-size:13px;">
        <?= bh_plugin_t($pk, 'games.no_currency') ?>
    </div>
    <?php else: ?>
    <div id="casino-games-list">
        <?php foreach ($games as $key => $meta):
            $gs = $gameSettings[$key] ?? null;
            $enabled = $gs ? (bool)$gs['enabled'] : true;
            $rtp     = $gs ? (float)$gs['rtp'] : $defaults[$key]['rtp'];
            $minBet  = $gs ? (int)$gs['min_bet'] : $defaults[$key]['min_bet'];
            $maxBet  = $gs ? (int)$gs['max_bet'] : $defaults[$key]['max_bet'];
            $allowed = $gs && $gs['allowed_currencies'] ? (json_decode((string)$gs['allowed_currencies'], true) ?: []) : [];
        ?>
        <div class="bh-module-row" style="padding:16px;border-bottom:1px solid var(--border);" data-game="<?= $e($key) ?>">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px;">
                <div>
                    <div style="font-weight:600;font-size:14px;"><?= $meta['label'] ?></div>
                    <div style="font-size:11px;color:var(--text-muted);"><?= $e($meta['desc']) ?></div>
                </div>
                <label class="bh-toggle-row" style="margin:0;">
                    <input type="checkbox" class="bh-checkbox cg-enabled" <?= $enabled ? 'checked' : '' ?>>
                    <span class="bh-toggle-switch"></span>
                </label>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;align-items:end;">
                <div class="bh-form-group" style="margin:0;">
                    <label class="bh-label"><?= bh_plugin_te($pk, 'games.rtp_label') ?></label>
                    <input type="number" class="bh-input cg-rtp" min="10" max="100" step="0.5" value="<?= $e((string)$rtp) ?>">
                </div>
                <div class="bh-form-group" style="margin:0;">
                    <label class="bh-label"><?= bh_plugin_te($pk, 'games.min_bet_label') ?></label>
                    <input type="number" class="bh-input cg-min" min="1" value="<?= $e((string)$minBet) ?>">
                </div>
                <div class="bh-form-group" style="margin:0;">
                    <label class="bh-label"><?= bh_plugin_te($pk, 'games.max_bet_label') ?></label>
                    <input type="number" class="bh-input cg-max" min="1" value="<?= $e((string)$maxBet) ?>">
                </div>
            </div>
            <div style="margin-top:10px;">
                <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;"><?= bh_plugin_te($pk, 'games.allowed_currencies_hint') ?></div>
                <div style="display:flex;flex-wrap:wrap;gap:12px;">
                    <?php foreach ($currencies as $c): ?>
                    <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;">
                        <input type="checkbox" class="bh-checkbox cg-currency" value="<?= $e($c['currency_key']) ?>"
                               <?= in_array($c['currency_key'], $allowed, true) ? 'checked' : '' ?>>
                        <?= $e($c['symbol']) ?> <?= $e($c['name']) ?>
                    </label>
                    <?php endforeach; ?>
                </div>
            </div>
        </div>
        <?php endforeach; ?>
    </div>
    <div style="padding:16px;display:flex;justify-content:flex-end;">
        <button type="button" class="bh-btn bh-btn-primary" id="casino-save-btn"><?= bh_plugin_te($pk, 'games.save_btn') ?></button>
    </div>
    <div id="casino-save-msg" style="padding:0 16px 16px;font-size:12px;"></div>
    <?php endif; ?>
</div>

<script>
(function () {
    'use strict';
    var CSRF = <?= json_encode($csrf) ?>;
    var I18N = {
        saving: <?= json_encode(bh_plugin_t($pk, 'games.saving')) ?>,
        saved: <?= json_encode(bh_plugin_t($pk, 'games.saved')) ?>,
        error: <?= json_encode(bh_plugin_t($pk, 'games.error')) ?>,
        networkError: <?= json_encode(bh_plugin_t($pk, 'games.network_error')) ?>
    };

    document.getElementById('casino-save-btn')?.addEventListener('click', async function () {
        var msg = document.getElementById('casino-save-msg');
        var rows = document.querySelectorAll('#casino-games-list [data-game]');
        var games = [];
        rows.forEach(function (row) {
            var currencies = [];
            row.querySelectorAll('.cg-currency:checked').forEach(function (cb) { currencies.push(cb.value); });
            games.push({
                game_key: row.dataset.game,
                enabled: row.querySelector('.cg-enabled').checked,
                rtp: parseFloat(row.querySelector('.cg-rtp').value) || 95,
                min_bet: parseInt(row.querySelector('.cg-min').value, 10) || 10,
                max_bet: parseInt(row.querySelector('.cg-max').value, 10) || 1000,
                allowed_currencies: currencies,
            });
        });

        msg.textContent = I18N.saving;
        msg.style.color = 'var(--text-muted)';
        try {
            var res = await fetch('/api/v1/plugins/casino', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ csrf_token: CSRF, action: 'save_games', games: games })
            });
            var d = await res.json();
            if (d.ok) { msg.style.color = '#4ade80'; msg.textContent = I18N.saved; }
            else { msg.style.color = '#ef4444'; msg.textContent = d.error || I18N.error; }
        } catch (e) {
            msg.style.color = '#ef4444';
            msg.textContent = I18N.networkError;
        }
    });
}());
</script>

<?php require __DIR__ . '/commands.php'; ?>
