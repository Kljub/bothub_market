<?php
declare(strict_types=1);

$bh->dashboard->sidebar->addItem([
    'label'   => 'TempAttachments',
    'icon'    => 'paperclip',
    'route'   => '/dashboard/plugins/tempattachments-plugin/commands',
    'section' => 'PLUGINS',
    'order'   => 160,
]);

$bh->dashboard->page->register('commands', [
    'title'  => 'TempAttachments — Commands',
    'icon'   => 'paperclip',
    'render' => 'pages/commands.php',
]);
