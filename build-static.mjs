import fs from 'node:fs';

fs.rmSync('public', { recursive: true, force: true });
fs.mkdirSync('public', { recursive: true });

fs.copyFileSync('index.html', 'public/index.html');
fs.copyFileSync('logo.png', 'public/logo.png');
fs.copyFileSync('favicon.png', 'public/favicon.png');
fs.cpSync('dist', 'public/dist', { recursive: true });

console.log('Static frontend generated in public/');
