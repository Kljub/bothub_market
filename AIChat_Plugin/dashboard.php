<?php
declare(strict_types=1);

$bh->dashboard->sidebar->addItem([
    'label'   => 'AI Chat',
    'icon'    => 'message-chatbot',
    'route'   => '/dashboard/plugins/aichat-plugin/config',
    'section' => 'PLUGINS',
    'order'   => 130,
]);

$bh->dashboard->page->register('config', [
    'title'  => 'AI Chat — Konfiguration',
    'icon'   => 'message-chatbot',
    'render' => 'pages/config.php',
]);
