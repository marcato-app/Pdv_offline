// App de Windows do Vision PDV: abre o mesmo sistema do site, com acesso a pastas e impressora.
const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const KEEP = 30;
// O app abre o sistema da nuvem (sempre atualizado). O próprio sistema guarda uma cópia para funcionar sem internet.
const CLOUD = process.env.VISION_URL || 'https://visionpdv.marcatoapp.com.br/'; // VISION_URL: só para testes
const backupDir = () => path.join(app.getPath('documents'), 'VisionPDV', 'backups');
const safeName = (n) => /^[\w.-]+\.json$/.test(n) ? n : null;

if (!app.requestSingleInstanceLock()) app.quit();

let win;
let pdvWin;

// Ajustes comuns às janelas (gestão e caixa).
function setup(w) {
  // Balança no cabo serial/USB: libera o acesso e escolhe a porta automaticamente.
  const ses = w.webContents.session;
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'serial' || permission === 'media' || permission === 'clipboard-sanitized-write');
  // Câmera para ler código de barras.
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(['media', 'clipboard-sanitized-write'].includes(permission)));
  ses.setDevicePermissionHandler((details) => details.deviceType === 'serial');
  ses.removeAllListeners('select-serial-port');
  ses.on('select-serial-port', (event, portList, _wc, callback) => {
    event.preventDefault();
    callback(portList.length ? portList[0].portId : '');
  });
  w.webContents.setUserAgent(w.webContents.getUserAgent() + ' VisionPDVApp');
  // Sem internet e sem cópia guardada (primeira abertura): mostra a tela de "conecte à internet".
  w.webContents.on('did-fail-load', (_e, code, _desc, url, isMain) => {
    if (isMain && code !== -3 && url.startsWith(CLOUD)) w.loadFile(path.join(__dirname, 'offline.html'));
  });
  // Ctrl+R recarrega; Ctrl+Shift+I abre a tela técnica (para o suporte ver erros); F11 liga/desliga a tela cheia.
  w.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { e.preventDefault(); w.setFullScreen(!w.isFullScreen()); return; }
    if (!input.control) return;
    if (input.key.toLowerCase() === 'r' && !input.shift) { e.preventDefault(); w.webContents.reload(); }
    if (input.key.toLowerCase() === 'i' && input.shift) { e.preventDefault(); w.webContents.toggleDevTools(); }
  });
  // Links de outros sites abrem no navegador, não dentro do PDV.
  w.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  w.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(CLOUD) && !url.startsWith('file:')) { e.preventDefault(); shell.openExternal(url); }
  });
}

const prefs = (extra) => ({ preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, additionalArguments: extra || [] });

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
    webPreferences: prefs(),
  });
  setup(win);
  win.maximize();
  win.loadURL(CLOUD);
  win.on('closed', () => { win = null; });
}

// Frente de caixa: janela própria, em tela cheia (cobre a barra de tarefas do Windows).
function openPdv(url) {
  // Só endereços do próprio sistema.
  if (typeof url !== 'string' || !(url.startsWith(CLOUD) || url.startsWith('file:'))) url = CLOUD + 'pdv';
  if (pdvWin && !pdvWin.isDestroyed()) {
    if (pdvWin.isMinimized()) pdvWin.restore();
    pdvWin.setFullScreen(true);
    pdvWin.focus();
    return;
  }
  pdvWin = new BrowserWindow({
    fullscreen: true,
    title: 'Vision PDV - Caixa',
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#F6F5FA',
    autoHideMenuBar: true,
    webPreferences: prefs(['--vision-pdv']),
  });
  setup(pdvWin);
  pdvWin.loadURL(url);
  pdvWin.on('closed', () => { pdvWin = null; if (win && !win.isDestroyed()) win.focus(); });
}

function focusMain() {
  if (!win || win.isDestroyed()) { createWindow(); return; }
  if (pdvWin && !pdvWin.isDestroyed()) pdvWin.minimize();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

app.on('second-instance', () => {
  const w = pdvWin && !pdvWin.isDestroyed() ? pdvWin : win;
  if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
});

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

  ipcMain.handle('pdv:open', async (_e, url) => openPdv(url));
  ipcMain.handle('pdv:focusMain', async () => focusMain());
  ipcMain.handle('win:fullscreen', async (e, on) => { BrowserWindow.fromWebContents(e.sender)?.setFullScreen(!!on); });

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

// Fechou a gestão: o caixa continua aberto (e vice-versa). O app só fecha quando não sobra janela.
app.on('window-all-closed', () => app.quit());
