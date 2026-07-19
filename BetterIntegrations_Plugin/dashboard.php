<?php
declare(strict_types=1);

// Instanzweite Einstellung, kein Bot-Kontext — gehört in den Admin-Bereich statt in
// die (bot-gebundene) Plugins-Sidebar-Sektion. addSection() rendert direkt in die
// bestehende ADMIN-Sidebar-Liste in layout.php (siehe dashboard/admin-nav-item.php).
$bh->dashboard->admin->addSection([
    'key'    => 'theme',
    'title'  => 'BetterIntegrations',
    'render' => 'admin-nav-item.php',
    'order'  => 80,
]);

// sidebar.item wird NICHT sichtbar gerendert (die generische Plugins-Sidebar-Sektion ist
// entfernt) — aber modules/index.php (Bot > Module > Plugins-Tab) löst darüber die Karten-
// URL für jedes Plugin auf; ohne diesen Eintrag fällt es auf den falschen generischen
// Fallback /dashboard/modules/{key} zurück → 404, weil dort kein Modul dieses Namens existiert.
$bh->dashboard->sidebar->addItem([
    'label'   => 'BetterIntegrations',
    'icon'    => 'palette',
    'route'   => '/dashboard/plugins/betterintegrations-plugin/theme',
    'section' => 'ADMIN',
    'order'   => 80,
]);

$bh->dashboard->page->register('theme', [
    'title'  => 'BetterIntegrations — Theme',
    'icon'   => 'palette',
    'render' => 'pages/theme.php',
]);
