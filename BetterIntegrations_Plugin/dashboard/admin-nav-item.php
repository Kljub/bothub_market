<?php
declare(strict_types=1);

$pk = 'betterintegrations-plugin';

$biActive = ($context['activeView'] ?? '') === 'plugin-betterintegrations-plugin-theme';
$biCls    = $biActive ? ' active' : '';
$biIcon   = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 15A7 7 0 1 1 8 1a5.53 5.53 0 0 1 5.5 5.5c0 1.93-1.57 3.5-3.5 3.5h-1.02c-.28 0-.5.22-.5.5 0 .12.05.24.13.33.5.56.87 1.15.87 1.67 0 1.1-1.5 2-3.5 2Zm-3.75-8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm2.5-2.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm3.25.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm2 3a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"/></svg>';
echo '<li><a href="/dashboard/plugins/betterintegrations-plugin/theme" class="' . $biCls . '">' . $biIcon . '<span>' . bh_plugin_te($pk, 'nav.label') . '</span></a></li>';
