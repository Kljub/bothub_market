<?php
declare(strict_types=1);

$bh->dashboard->sidebar->addItem([
    'label'   => 'Global Chat',
    'icon'    => 'world',
    'route'   => '/dashboard/plugins/globalchat-plugin/config',
    'section' => 'PLUGINS',
    'order'   => 155,
]);

$bh->dashboard->page->register('config', [
    'title'  => 'Global Chat — Status',
    'icon'   => 'world',
    'render' => 'pages/config.php',
]);

$bh->dashboard->page->register('commands', [
    'title'  => 'Global Chat — Commands',
    'icon'   => 'terminal-2',
    'render' => 'pages/commands.php',
]);
