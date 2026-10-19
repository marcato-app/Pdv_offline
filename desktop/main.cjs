// App de Windows do Vision PDV: abre o mesmo sistema do site, com acesso a pastas e impressora.
const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const KEEP = 30;
const backupDir = () => path.join(app.getPath('documents'), 'VisionPDV', 'backups');
const safeName = (n) => /^[\w.-]+\.json$/.test(n) ? n : null;

if (!app.requestSingleInstanceLock()) app.quit();

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1366,
    height: 800,
    minWidth: 1000,
    minHeight: 640,
    title: 'Vision PDV',
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#F6F5FA',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false },
  });
  win.maximize();
  win.loadFile(path.join(__dirname, 'web', 'index.html'));
  // Links externos abrem no navegador, não dentro do PDV.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(() => {
  // Sem menu: assim as teclas F1 a F12 ficam livres para o caixa.
  Menu.setApplicationMenu(null);

  ipcMain.handle('backup:save', async (_e, name, content) => {
    const n = safeName(name);
    if (!n) throw new Error('Nome inválido');
    fs.mkdirSync(backupDir(), { recursive: true });
    const file = path.join(backupDir(), n);
    fs.writeFileSync(file, content, 'utf8');
    const all = fs.readdirSync(backupDir()).filter((f) => f.endsWith('.json'))
      .map((f) => ({ f, t: fs.statSync(path.join(backupDir(), f)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const old of all.slice(KEEP)) fs.rmSync(path.join(backupDir(), old.f), { force: true });
    return file;
  });
  ipcMain.handle('backup:list', async () => {
    if (!fs.existsSync(backupDir())) return [];
    return fs.readdirSync(backupDir()).filter((f) => f.endsWith('.json')).map((f) => {
      const s = fs.statSync(path.join(backupDir(), f));
      return { name: f, size: s.size, mtime: s.mtimeMs };
    }).sort((a, b) => b.mtime - a.mtime);
  });
  ipcMain.handle('backup:read', async (_e, name) => {
    const n = safeName(name);
    if (!n) throw new Error('Nome inválido');
    return fs.readFileSync(path.join(backupDir(), n), 'utf8');
  });
  ipcMain.handle('backup:open', async () => { fs.mkdirSync(backupDir(), { recursive: true }); await shell.openPath(backupDir()); });
  ipcMain.handle('backup:folder', async () => backupDir());

  ipcMain.handle('print:html', async (_e, html, opts) => {
    const pw = new BrowserWindow({ show: false, webPreferences: { javascript: false } });
    await pw.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await new Promise((resolve, reject) => {
      pw.webContents.print({
        silent: !!opts?.silent,
        deviceName: opts?.deviceName || undefined,
        printBackground: true,
        margins: { marginType: 'none' },
        pageSize: { width: Math.round((opts?.widthMm || 80) * 1000), height: 297000 },
      }, (ok, reason) => (ok || reason === 'cancelled' ? resolve() : reject(new Error(reason))));
    });
    pw.close();
  });

  createWindow();
});

app.on('window-all-closed', () => app.quit());
