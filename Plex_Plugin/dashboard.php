<?php
declare(strict_types=1);

$bh->dashboard->sidebar->addItem([
    'label'   => 'Plex',
    'icon'    => 'movie',
    'route'   => '/dashboard/plugins/plex/config',
    'section' => 'PLUGINS',
    'order'   => 110,
]);

$bh->dashboard->page->register('config', [
    'title'  => 'Plex — Konfiguration',
    'icon'   => 'movie',
    'render' => 'pages/config.php',
]);
