<?php
declare(strict_types=1);

echo '<link rel="stylesheet" href="/assets/css/components-base.css?v=' . filemtime(BH_ROOT . '/assets/css/components-base.css') . '">';

$botId = (int)($context['botId'] ?? $_SESSION['current_bot_id'] ?? 0);
$db    = bh_db();
$csrf  = (string)($_SESSION['csrf_token'] ?? '');
$e     = fn(string $v): string => htmlspecialchars($v, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');

$currencies = [];
$jobsList = [];
if ($botId > 0) {
    try {
        $stmt = $db->prepare('SELECT currency_key, name, symbol FROM bot_economy_currencies WHERE bot_id = ? ORDER BY is_default DESC, name ASC');
        $stmt->execute([$botId]);
        $currencies = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    } catch (Throwable) {}
    try {
        $stmt = $db->prepare('SELECT * FROM plugin_work_plugin_jobs WHERE bot_id = ? ORDER BY sort_order ASC, name ASC');
        $stmt->execute([$botId]);
        $jobsList = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    } catch (Throwable) {}
}

function fmtCooldown(int $s): string {
    if ($s < 60) return $s . 's';
    if ($s < 3600) return round($s / 60) . 'm';
    if ($s < 86400) return round($s / 3600, 1) . 'h';
    return round($s / 86400, 1) . 'd';
}
?>

<div class="bh-card bh-card-lg" style="margin-bottom:20px;">
    <div class="bh-card-header" style="display:flex;align-items:center;justify-content:space-between;">
        <h2>💼 Work — Jobs</h2>
        <button type="button" class="bh-btn bh-btn-primary bh-btn-sm" id="wp-new-btn" <?= empty($currencies) ? 'disabled' : '' ?>>+ Neuer Job</button>
    </div>
    <?php if (empty($currencies)): ?>
    <div style="padding:24px;color:var(--text-muted);font-size:13px;">
        Noch keine Currency eingerichtet. Lege zuerst unter <strong>Economy</strong> eine Currency an, bevor du Jobs anlegen kannst.
    </div>
    <?php else: ?>
    <div class="bh-card-body" style="padding:0;">
        <?php if (!$jobsList): ?>
        <div style="padding:24px;color:var(--text-muted);font-size:13px;">
            Noch keine Jobs eingerichtet. Ohne Jobs funktioniert <code>/job-accept</code> &amp; <code>/work</code> nicht.
        </div>
        <?php endif; ?>
        <?php foreach ($jobsList as $j): ?>
        <div class="bh-module-row wp-row" data-key="<?= $e($j['job_key']) ?>"
             style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:12px;">
            <div style="flex:1;min-width:0;">
                <div style="font-weight:600;color:var(--text-primary);display:flex;align-items:center;gap:8px;">
                    <span style="font-size:18px;"><?= $e($j['emoji']) ?></span>
                    <?= $e($j['name']) ?>
                    <code style="font-size:11px;color:var(--text-muted);"><?= $e($j['job_key']) ?></code>
                    <?php if (!(int)$j['enabled']): ?><span class="bh-tag" style="font-size:10px;">Deaktiviert</span><?php endif; ?>
                </div>
                <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">
                    💰 <?= (int)$j['pay_min'] ?>–<?= (int)$j['pay_max'] ?>
                    · ⏱️ Cooldown: <?= fmtCooldown((int)$j['cooldown_seconds']) ?>
                    <?php if ($j['currency_key']): ?> · Currency: <?= $e((string)$j['currency_key']) ?><?php else: ?> · Currency: Default<?php endif; ?>
                </div>
            </div>
            <button type="button" class="bh-btn bh-btn-sm wp-edit-btn"
                    data-job="<?= $e(json_encode($j, JSON_UNESCAPED_UNICODE)) ?>">Bearbeiten</button>
            <button type="button" class="bh-btn bh-btn-sm bh-btn-danger wp-delete-btn"
                    data-key="<?= $e($j['job_key']) ?>">Löschen</button>
        </div>
        <?php endforeach; ?>
    </div>
    <?php endif; ?>
</div>

<!-- Create/Edit Modal -->
<div id="wp-modal-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);align-items:center;justify-content:center;z-index:9999;">
    <div class="bh-card" style="width:90%;max-width:480px;padding:20px;">
        <h3 id="wp-modal-title" style="margin:0 0 16px;">Neuer Job</h3>
        <div class="bh-form">
            <div class="bh-form-group">
                <label class="bh-label">Key (nur a-z, 0-9, _)</label>
                <input type="text" class="bh-input" id="wp-f-key" maxlength="32" placeholder="pizzabote">
            </div>
            <div class="bh-form-group">
                <label class="bh-label">Name</label>
                <input type="text" class="bh-input" id="wp-f-name" maxlength="64" placeholder="Pizzabote">
            </div>
            <div class="bh-form-group">
                <label class="bh-label">Emoji</label>
                <input type="text" class="bh-input" id="wp-f-emoji" maxlength="16" placeholder="🍕">
            </div>
            <div class="bh-form-group">
                <label class="bh-label">Beschreibung</label>
                <input type="text" class="bh-input" id="wp-f-desc" maxlength="255" placeholder="Liefert Pizza aus.">
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                <div class="bh-form-group">
                    <label class="bh-label">Min. Gehalt</label>
                    <input type="number" class="bh-input" id="wp-f-paymin" value="10" min="0">
                </div>
                <div class="bh-form-group">
                    <label class="bh-label">Max. Gehalt</label>
                    <input type="number" class="bh-input" id="wp-f-paymax" value="50" min="1">
                </div>
            </div>
            <div class="bh-form-group">
                <label class="bh-label">Cooldown (Sekunden)</label>
                <input type="number" class="bh-input" id="wp-f-cooldown" value="3600" min="1">
                <small class="bh-hint">3600 = 1 Stunde. Höheres Gehalt sollte i.d.R. mit höherem Cooldown balanciert werden.</small>
            </div>
            <div class="bh-form-group">
                <label class="bh-label">Currency</label>
                <select class="bh-input" id="wp-f-currency">
                    <option value="">Default-Currency</option>
                    <?php foreach ($currencies as $c): ?>
                    <option value="<?= $e($c['currency_key']) ?>"><?= $e($c['symbol']) ?> <?= $e($c['name']) ?></option>
                    <?php endforeach; ?>
                </select>
            </div>
            <div class="bh-form-group">
                <label class="bh-toggle-row">
                    <div class="bh-toggle-row-content">
                        <span class="bh-toggle-title">Aktiv</span>
                        <span class="bh-toggle-desc">Nur aktive Jobs erscheinen in /job-list und sind annehmbar.</span>
                    </div>
                    <input type="checkbox" class="bh-checkbox" id="wp-f-enabled" checked>
                    <span class="bh-toggle-switch"></span>
                </label>
            </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:16px;">
            <button type="button" class="bh-btn bh-btn-primary" id="wp-save-btn">Speichern</button>
            <button type="button" class="bh-btn bh-btn-ghost" id="wp-cancel-btn">Abbrechen</button>
        </div>
        <div id="wp-modal-msg" style="margin-top:10px;font-size:12px;"></div>
    </div>
</div>

<script>
(function () {
    'use strict';
    var CSRF = <?= json_encode($csrf) ?>;
    var isUpdate = false;
    var originalKey = null;

    var overlay = document.getElementById('wp-modal-overlay');

    function openModal(edit, data) {
        isUpdate = !!edit;
        originalKey = edit ? data.job_key : null;
        document.getElementById('wp-modal-title').textContent = edit ? 'Job bearbeiten' : 'Neuer Job';
        document.getElementById('wp-f-key').value = edit ? data.job_key : '';
        document.getElementById('wp-f-key').disabled = !!edit;
        document.getElementById('wp-f-name').value = edit ? data.name : '';
        document.getElementById('wp-f-emoji').value = edit ? data.emoji : '💼';
        document.getElementById('wp-f-desc').value = edit ? data.description : '';
        document.getElementById('wp-f-paymin').value = edit ? data.pay_min : 10;
        document.getElementById('wp-f-paymax').value = edit ? data.pay_max : 50;
        document.getElementById('wp-f-cooldown').value = edit ? data.cooldown_seconds : 3600;
        document.getElementById('wp-f-currency').value = edit && data.currency_key ? data.currency_key : '';
        document.getElementById('wp-f-enabled').checked = edit ? !!Number(data.enabled) : true;
        document.getElementById('wp-modal-msg').textContent = '';
        overlay.style.display = 'flex';
    }
    function closeModal() { overlay.style.display = 'none'; }

    document.getElementById('wp-new-btn')?.addEventListener('click', function () { openModal(false, null); });
    document.getElementById('wp-cancel-btn').addEventListener('click', closeModal);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });

    document.querySelectorAll('.wp-edit-btn').forEach(function (btn) {
        btn.addEventListener('click', function () { openModal(true, JSON.parse(this.dataset.job)); });
    });

    document.querySelectorAll('.wp-delete-btn').forEach(function (btn) {
        btn.addEventListener('click', async function () {
            if (!confirm('Job "' + this.dataset.key + '" wirklich löschen? Alle Anstellungen bei diesem Job werden entfernt.')) return;
            var res = await fetch('/api/v1/plugins/work', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ csrf_token: CSRF, action: 'delete_job', job_key: this.dataset.key })
            });
            var d = await res.json();
            if (d.ok) location.reload(); else alert(d.error || 'Fehler');
        });
    });

    document.getElementById('wp-save-btn').addEventListener('click', async function () {
        var msg = document.getElementById('wp-modal-msg');
        var payload = {
            csrf_token: CSRF,
            action: 'save_job',
            is_update: isUpdate,
            job_key: isUpdate ? originalKey : document.getElementById('wp-f-key').value.trim().toLowerCase(),
            name: document.getElementById('wp-f-name').value.trim(),
            emoji: document.getElementById('wp-f-emoji').value.trim() || '💼',
            description: document.getElementById('wp-f-desc').value.trim(),
            pay_min: parseInt(document.getElementById('wp-f-paymin').value, 10) || 0,
            pay_max: parseInt(document.getElementById('wp-f-paymax').value, 10) || 1,
            cooldown_seconds: parseInt(document.getElementById('wp-f-cooldown').value, 10) || 3600,
            currency_key: document.getElementById('wp-f-currency').value || null,
            enabled: document.getElementById('wp-f-enabled').checked,
        };
        if (!/^[a-z0-9_]{1,32}$/.test(payload.job_key) || !payload.name) {
            msg.style.color = '#ef4444';
            msg.textContent = 'Key (a-z, 0-9, _) und Name sind Pflicht.';
            return;
        }
        if (payload.pay_max < payload.pay_min) {
            msg.style.color = '#ef4444';
            msg.textContent = 'Max. Gehalt muss ≥ Min. Gehalt sein.';
            return;
        }
        var res = await fetch('/api/v1/plugins/work', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        var d = await res.json();
        if (d.ok) { location.reload(); } else { msg.style.color = '#ef4444'; msg.textContent = d.error || 'Fehler'; }
    });
}());
</script>

<?php require __DIR__ . '/commands.php'; ?>
