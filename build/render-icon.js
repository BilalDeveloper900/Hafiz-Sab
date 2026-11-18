// Renders build/icon.svg to build/icon.png (1024px, transparent) using Electron itself, so no extra dependency.
// Run: npm run icon
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } });
  const svg = fs.readFileSync(path.join(__dirname, 'icon.svg'), 'utf8');
  await win.loadURL(`data:text/html,<style>html,body{margin:0;background:transparent}</style>${encodeURIComponent(svg.replace('<svg ', '<svg width="1024" height="1024" '))}`);
  await new Promise((r) => setTimeout(r, 300));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  fs.writeFileSync(path.join(__dirname, 'icon.png'), img.resize({ width: 1024, height: 1024 }).toPNG());
  app.quit();
});
