<?php
declare(strict_types=1);

$bh->dashboard->sidebar->addItem([
    'label'   => 'Emoji Manager',
    'icon'    => 'mood-smile',
    'route'   => '/dashboard/plugins/emojimanager-plugin/emojis',
    'section' => 'PLUGINS',
    'order'   => 167,
]);

$bh->dashboard->page->register('emojis', [
    'title'  => 'Emoji Manager',
    'icon'   => 'mood-smile',
    'render' => 'pages/emojis.php',
]);
