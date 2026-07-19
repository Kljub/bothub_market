<?php
declare(strict_types=1);

echo '<link rel="stylesheet" href="/assets/css/components-base.css?v=' . filemtime(BH_ROOT . '/assets/css/components-base.css') . '">';

$pk = 'betterintegrations-plugin';

if (!bh_has_perm('admin.panel')) {
    echo '<div class="bh-alert bh-alert-error">' . bh_plugin_te($pk, 'theme.access_denied') . '</div>';
    return;
}

$db = bh_db();
$e  = fn(string $v): string => htmlspecialchars($v, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');

// ── Basiswerte (identisch zur Skala in variables.css) ───────────────────────
$COLOR_DEFAULTS = [
    '--color-primary'        => ['label' => bh_plugin_t($pk, 'color.primary'),        'default' => '#a78bfa'],
    '--color-primary-bright' => ['label' => bh_plugin_t($pk, 'color.primary_bright'), 'default' => '#c4b5fd'],
    '--accent'               => ['label' => bh_plugin_t($pk, 'color.accent'),         'default' => '#909090'],
    '--bg-body'               => ['label' => bh_plugin_t($pk, 'color.bg_body'),        'default' => '#0d0d0d'],
    '--bg-card'               => ['label' => bh_plugin_t($pk, 'color.bg_card'),        'default' => '#1a1a1a'],
    '--bg-sidebar'            => ['label' => bh_plugin_t($pk, 'color.bg_sidebar'),     'default' => '#111111'],
    '--text-primary'         => ['label' => bh_plugin_t($pk, 'color.text_primary'),   'default' => '#e0e0e0'],
    '--text-secondary'       => ['label' => bh_plugin_t($pk, 'color.text_secondary'), 'default' => '#a0a0a0'],
    '--border'               => ['label' => bh_plugin_t($pk, 'color.border'),         'default' => '#2a2a2a'],
];
$RADIUS_DEFAULTS  = ['--radius-sm' => 6, '--radius-md' => 10, '--radius-lg' => 16];
$SPACE_BASE       = ['--space-1' => 4, '--space-2' => 8, '--space-3' => 12, '--space-4' => 16, '--space-5' => 24, '--space-6' => 32];
$FONT_BASE        = ['--font-xs' => 11, '--font-sm' => 12, '--font-base' => 13, '--font-md' => 14, '--font-lg' => 16, '--font-xl' => 20];

$error   = '';
$success = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (($_SESSION['csrf_token'] ?? '') !== ($_POST['csrf'] ?? '')) {
        $error = __('common.csrf_invalid');
    } elseif (($_POST['action'] ?? '') === 'save_theme') {
        $colors = [];
        foreach ($COLOR_DEFAULTS as $var => $cfg) {
            $val = (string)($_POST['color'][$var] ?? $cfg['default']);
            $colors[$var] = preg_match('/^#[0-9a-fA-F]{6}$/', $val) ? $val : $cfg['default'];
        }
        $radius = [];
        foreach ($RADIUS_DEFAULTS as $var => $default) {
            $radius[$var] = max(0, min(40, (int)($_POST['radius'][$var] ?? $default)));
        }
        $spacingScale = max(80, min(130, (int)($_POST['spacing_scale'] ?? 100)));
        $fontScale    = max(85, min(125, (int)($_POST['font_scale']    ?? 100)));

        $theme = ['colors' => $colors, 'radius' => $radius, 'spacing_scale' => $spacingScale, 'font_scale' => $fontScale];
        $db->prepare("INSERT INTO app_settings (`key`, `value`) VALUES ('betterintegrations_theme', ?)
                       ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)")
           ->execute([json_encode($theme)]);
        $success = bh_plugin_t($pk, 'theme.saved');
    } elseif (($_POST['action'] ?? '') === 'reset_theme') {
        $db->prepare("DELETE FROM app_settings WHERE `key` = 'betterintegrations_theme'")->execute();
        $success = bh_plugin_t($pk, 'theme.reset_done');
    }
}

$theme = [];
try {
    $stmt = $db->query("SELECT `value` FROM app_settings WHERE `key` = 'betterintegrations_theme' LIMIT 1");
    $theme = json_decode((string)($stmt->fetchColumn() ?: '{}'), true) ?: [];
} catch (Throwable) {}

$curColors  = array_merge(array_map(fn($c) => $c['default'], $COLOR_DEFAULTS), $theme['colors'] ?? []);
$curRadius  = array_merge($RADIUS_DEFAULTS, $theme['radius'] ?? []);
$curSpacing = (int)($theme['spacing_scale'] ?? 100);
$curFont    = (int)($theme['font_scale'] ?? 100);

$csrf = (string)($_SESSION['csrf_token'] ?? '');
?>

<?php if ($error !== ''): ?>
<div class="bh-alert bh-alert-error" style="margin-bottom:16px;"><?= $e($error) ?></div>
<?php endif; ?>
<?php if ($success !== ''): ?>
<div class="bh-alert bh-alert-success" style="margin-bottom:16px;"><?= $e($success) ?></div>
<?php endif; ?>

<p class="bh-text-muted bh-text-sm" style="margin-bottom:16px;">
    <?= bh_plugin_t($pk, 'theme.intro', ['profile_link' => '<a href="/dashboard/profile">' . bh_plugin_te($pk, 'theme.profile_link_label') . '</a>']) ?>
</p>

<form method="post" id="bi-theme-form">
<input type="hidden" name="csrf" value="<?= $e($csrf) ?>">
<input type="hidden" name="action" value="save_theme">

<div class="bh-card bh-card-lg" style="margin-bottom:20px;">
    <div class="bh-card-header"><h2><?= bh_plugin_te($pk, 'theme.section_colors') ?></h2></div>
    <div style="padding:14px 16px;display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:20px;">
        <?php foreach ($COLOR_DEFAULTS as $var => $cfg):
            $val = $e((string)$curColors[$var]);
            $id  = 'bi-c-' . ltrim($var, '-');
        ?>
        <div>
            <label class="bh-label" style="margin-bottom:8px;"><?= $e($cfg['label']) ?></label>
            <div style="display:flex;align-items:center;gap:8px;">
                <input type="color" id="<?= $id ?>" name="color[<?= $e($var) ?>]" value="<?= $val ?>"
                       data-var="<?= $e($var) ?>" oninput="biApplyLive()" style="width:40px;height:36px;padding:0;border:1px solid var(--border);border-radius:var(--radius-sm);background:none;cursor:pointer;">
                <span style="font-size:12px;color:var(--text-muted);font-family:monospace;"><?= $e($var) ?></span>
            </div>
        </div>
        <?php endforeach; ?>
    </div>
</div>

<div class="bh-card bh-card-lg" style="margin-bottom:20px;">
    <div class="bh-card-header"><h2><?= bh_plugin_te($pk, 'theme.section_radius') ?></h2></div>
    <div style="padding:14px 16px;display:flex;gap:16px;flex-wrap:wrap;">
        <?php foreach ($RADIUS_DEFAULTS as $var => $default): $id = 'bi-r-' . ltrim($var, '-'); ?>
        <div style="flex:1;min-width:140px;">
            <label class="bh-label"><?= $e($var) ?> <?= bh_plugin_te($pk, 'theme.unit_px') ?></label>
            <input type="number" id="<?= $id ?>" name="radius[<?= $e($var) ?>]" class="bh-input"
                   value="<?= (int)$curRadius[$var] ?>" min="0" max="40" data-var="<?= $e($var) ?>" oninput="biApplyLive()">
        </div>
        <?php endforeach; ?>
    </div>
</div>

<div class="bh-card bh-card-lg" style="margin-bottom:20px;">
    <div class="bh-card-header"><h2><?= bh_plugin_te($pk, 'theme.section_spacing_font') ?></h2></div>
    <div style="padding:14px 16px;display:flex;gap:24px;flex-wrap:wrap;">
        <div style="flex:1;min-width:220px;">
            <label class="bh-label" style="display:flex;justify-content:space-between;">
                <span><?= bh_plugin_te($pk, 'theme.spacing_scale_label') ?></span>
                <span id="bi-spacing-display" style="color:var(--color-primary);font-weight:700;"><?= $curSpacing ?>%</span>
            </label>
            <input type="range" name="spacing_scale" id="bi-spacing" min="80" max="130" step="5"
                   value="<?= $curSpacing ?>" oninput="document.getElementById('bi-spacing-display').textContent=this.value+'%';biApplyLive();"
                   style="width:100%;accent-color:var(--color-primary);">
        </div>
        <div style="flex:1;min-width:220px;">
            <label class="bh-label" style="display:flex;justify-content:space-between;">
                <span><?= bh_plugin_te($pk, 'theme.font_scale_label') ?></span>
                <span id="bi-font-display" style="color:var(--color-primary);font-weight:700;"><?= $curFont ?>%</span>
            </label>
            <input type="range" name="font_scale" id="bi-font" min="85" max="125" step="5"
                   value="<?= $curFont ?>" oninput="document.getElementById('bi-font-display').textContent=this.value+'%';biApplyLive();"
                   style="width:100%;accent-color:var(--color-primary);">
        </div>
    </div>
</div>

<div style="display:flex;gap:8px;">
    <button type="submit" class="bh-btn bh-btn-primary">💾 <?= __e('common.save') ?></button>
    <button type="submit" name="action" value="reset_theme" formnovalidate class="bh-btn bh-btn-ghost"
            onclick="return biConfirmReset();"><?= __e('common.reset') ?></button>
</div>
</form>

<div class="bh-card bh-card-lg" style="margin-top:20px;">
    <div class="bh-card-header"><h2>🧩 <?= bh_plugin_te($pk, 'theme.cb_heading') ?></h2></div>
    <div style="padding:14px 16px;font-size:13px;color:var(--text-secondary);line-height:1.7;">
        <p style="margin:0 0 10px;"><?= bh_plugin_t($pk, 'theme.cb_p1') ?></p>
        <p style="margin:0 0 10px;"><?= bh_plugin_t($pk, 'theme.cb_p2') ?></p>
        <p style="margin:0;color:var(--text-muted);font-size:12px;">⚠️ <?= bh_plugin_t($pk, 'theme.cb_warning') ?></p>
    </div>
</div>

<script>
const BI_SPACE_BASE = <?= json_encode($SPACE_BASE) ?>;
const BI_FONT_BASE  = <?= json_encode($FONT_BASE) ?>;
const BI_I18N = <?= json_encode(['resetConfirm' => bh_plugin_t($pk, 'theme.reset_confirm')]) ?>;

function biConfirmReset() {
    return confirm(BI_I18N.resetConfirm);
}

function biApplyLive() {
    let css = ':root{';
    document.querySelectorAll('[data-var]').forEach(function (el) {
        css += el.getAttribute('data-var') + ':' + el.value + (el.type === 'number' ? 'px' : '') + ';';
    });
    const spacingScale = (parseInt(document.getElementById('bi-spacing').value, 10) || 100) / 100;
    Object.keys(BI_SPACE_BASE).forEach(function (v) {
        css += v + ':' + Math.round(BI_SPACE_BASE[v] * spacingScale) + 'px;';
    });
    const fontScale = (parseInt(document.getElementById('bi-font').value, 10) || 100) / 100;
    Object.keys(BI_FONT_BASE).forEach(function (v) {
        css += v + ':' + Math.round(BI_FONT_BASE[v] * fontScale) + 'px;';
    });
    css += '}';
    let tag = document.getElementById('bh-instance-theme-preview');
    if (!tag) { tag = document.createElement('style'); tag.id = 'bh-instance-theme-preview'; document.head.appendChild(tag); }
    tag.textContent = css;
}
</script>
