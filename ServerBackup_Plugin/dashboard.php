<?php
declare(strict_types=1);

$bh->dashboard->sidebar->addItem([
    'label'   => 'Server Backup',
    'icon'    => 'database-export',
    'route'   => '/dashboard/plugins/server-backup-plugin/config',
    'section' => 'PLUGINS',
    'order'   => 140,
]);

$bh->dashboard->page->register('config', [
    'title'  => 'Server Backup',
    'icon'   => 'database-export',
    'render' => 'pages/config.php',
]);
