<?php
declare(strict_types=1);

$bh->dashboard->sidebar->addItem([
    'label'   => 'Question of the Day',
    'icon'    => 'bulb',
    'route'   => '/dashboard/plugins/qotd-plugin/config',
    'section' => 'PLUGINS',
    'order'   => 150,
]);

$bh->dashboard->page->register('config', [
    'title'  => 'QOTD — Facts',
    'icon'   => 'bulb',
    'render' => 'pages/config.php',
]);

$bh->dashboard->page->register('commands', [
    'title'  => 'QOTD — Commands',
    'icon'   => 'terminal-2',
    'render' => 'pages/commands.php',
]);
