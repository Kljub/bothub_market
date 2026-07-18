<?php
declare(strict_types=1);

$bh->dashboard->sidebar->addItem([
    'label'   => 'Website Status Check',
    'icon'    => 'antenna',
    'route'   => '/dashboard/plugins/websitestatuscheck-plugin/config',
    'section' => 'PLUGINS',
    'order'   => 169,
]);

$bh->dashboard->page->register('config', [
    'title'  => 'Website Status Check — Einstellungen',
    'icon'   => 'antenna',
    'render' => 'pages/config.php',
]);
