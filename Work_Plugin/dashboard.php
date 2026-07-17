<?php
declare(strict_types=1);

$bh->dashboard->sidebar->addItem([
    'label'   => 'Work',
    'icon'    => 'briefcase',
    'route'   => '/dashboard/plugins/work-plugin/config',
    'section' => 'PLUGINS',
    'order'   => 145,
]);

$bh->dashboard->page->register('config', [
    'title'  => 'Work — Jobs',
    'icon'   => 'briefcase',
    'render' => 'pages/config.php',
]);

$bh->dashboard->page->register('commands', [
    'title'  => 'Work — Commands',
    'icon'   => 'terminal-2',
    'render' => 'pages/commands.php',
]);
