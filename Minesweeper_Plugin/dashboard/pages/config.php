<?php
declare(strict_types=1);

echo '<link rel="stylesheet" href="/assets/css/components-base.css?v=' . filemtime(BH_ROOT . '/assets/css/components-base.css') . '">';

$botId = (int)($context['botId'] ?? $_SESSION['current_bot_id'] ?? 0);
$db    = bh_db();
$csrf  = (string)($_SESSION['csrf_token'] ?? '');
$e     = fn(string $v): string => htmlspecialchars($v, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');

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
        $stmt = $db->prepare('SELECT * FROM plugin_minesweeper_plugin_settings WHERE bot_id = ? LIMIT 1');
        $stmt->execute([$botId]);
        $settings = $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
    } catch (Throwable) {}
}

$enabled = $settings ? (bool)$settings['enabled'] : true;
$rtp     = $settings ? (float)$settings['rtp'] : 97.00;
$minBet  = $settings ? (int)$settings['min_bet'] : 10;
$maxBet  = $settings ? (int)$settings['max_bet'] : 1000;
$allowed = $settings && $settings['allowed_currencies'] ? (json_decode((string)$settings['allowed_currencies'], true) ?: []) : [];
?>

<div class="bh-card bh-card-lg" style="margin-bottom:20px;">
    <div class="bh-card-header" style="display:flex;align-items:center;justify-content:space-between;">
        <h2>💣 Minesweeper — Einstellungen</h2>
        <label class="bh-toggle-row" style="margin:0;">
            <input type="checkbox" class="bh-checkbox" id="ms-enabled" <?= $enabled ? 'checked' : '' ?>>
            <span class="bh-toggle-switch"></span>
        </label>
    </div>
    <?php if (empty($currencies)): ?>
    <div style="padding:24px;color:var(--text-muted);font-size:13px;">
        Noch keine Currency eingerichtet. Lege zuerst unter <strong>Economy</strong> eine Currency an.
    </div>
    <?php else: ?>
    <div style="padding:20px;display:flex;flex-direction:column;gap:18px;">
        <p class="bh-text-muted bh-text-sm" style="margin:0;">
            5x5-Feld (Discords Maximum: 5 Reihen × 5 Buttons). Der User wählt beim Start die Minen-Anzahl (1-24) —
            der faire Multiplikator steigt automatisch mit mehr Minen. Die RTP unten skaliert diesen fairen Wert
            (= Hausvorteil), ganz wie bei den Casino-Spielen. Unverändert = fairer Standardwert (97%).
        </p>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:16px;">
            <div class="bh-form-group" style="margin:0;">
                <label class="bh-label">RTP % (10-100)</label>
                <input type="number" class="bh-input" id="ms-rtp" min="10" max="100" step="0.5" value="<?= $e((string)$rtp) ?>">
            </div>
            <div class="bh-form-group" style="margin:0;">
                <label class="bh-label">Min. Einsatz</label>
                <input type="number" class="bh-input" id="ms-min" min="1" value="<?= $e((string)$minBet) ?>">
            </div>
            <div class="bh-form-group" style="margin:0;">
                <label class="bh-label">Max. Einsatz</label>
                <input type="number" class="bh-input" id="ms-max" min="1" value="<?= $e((string)$maxBet) ?>">
            </div>
        </div>
        <div>
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;">Erlaubte Currencies (keine Auswahl = alle erlaubt)</div>
            <div style="display:flex;flex-wrap:wrap;gap:12px;">
                <?php foreach ($currencies as $c): ?>
                <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;">
                    <input type="checkbox" class="bh-checkbox ms-currency" value="<?= $e($c['currency_key']) ?>"
                           <?= in_array($c['currency_key'], $allowed, true) ? 'checked' : '' ?>>
                    <?= $e($c['symbol']) ?> <?= $e($c['name']) ?>
                </label>
                <?php endforeach; ?>
            </div>
        </div>
        <div style="display:flex;justify-content:flex-end;">
            <button type="button" class="bh-btn bh-btn-primary" id="ms-save-btn">Speichern</button>
        </div>
        <div id="ms-save-msg" style="font-size:12px;"></div>
    </div>
    <?php endif; ?>
</div>

<script>
(function () {
    'use strict';
    var CSRF = <?= json_encode($csrf) ?>;

    document.getElementById('ms-save-btn')?.addEventListener('click', async function () {
        var msg = document.getElementById('ms-save-msg');
        var currencies = [];
        document.querySelectorAll('.ms-currency:checked').forEach(function (cb) { currencies.push(cb.value); });

        msg.textContent = 'Speichert…';
        msg.style.color = 'var(--text-muted)';
        try {
            var res = await fetch('/api/v1/plugins/minesweeper', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    csrf_token: CSRF,
                    action: 'save_settings',
                    enabled: document.getElementById('ms-enabled').checked,
                    rtp: parseFloat(document.getElementById('ms-rtp').value) || 97,
                    min_bet: parseInt(document.getElementById('ms-min').value, 10) || 10,
                    max_bet: parseInt(document.getElementById('ms-max').value, 10) || 1000,
                    allowed_currencies: currencies
                })
            });
            var d = await res.json();
            if (d.ok) { msg.style.color = '#4ade80'; msg.textContent = '✓ Gespeichert'; }
            else { msg.style.color = '#ef4444'; msg.textContent = d.error || 'Fehler'; }
        } catch (e) {
            msg.style.color = '#ef4444';
            msg.textContent = 'Netzwerkfehler';
        }
    });
}());
</script>

<?php require __DIR__ . '/commands.php'; ?>
