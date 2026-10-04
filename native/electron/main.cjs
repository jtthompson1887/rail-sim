const { app, BrowserWindow, dialog, ipcMain, net, protocol, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createFileStorage } = require('./storage.cjs');

protocol.registerSchemesAsPrivileged([
  { scheme: 'rail-sim', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);
const CONTENT_SECURITY_POLICY = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; media-src 'self' blob: data:; object-src 'none'; base-uri 'none'";
let mainWindow;
let approvedClose = false;
let closePending = false;
let closeTimer;
// Keep development launches and packaged installers on the same app-private save directory.
app.setName('Rail Sim');
if (process.env.RAIL_SIM_SMOKE_TEST === '1' && process.env.RAIL_SIM_TEST_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.RAIL_SIM_TEST_USER_DATA));
}

function validSender(event) {
  const url = event.senderFrame?.url ?? '';
  return mainWindow && event.sender === mainWindow.webContents && url.startsWith('rail-sim://app/');
}

async function failedClose(message) {
  clearTimeout(closeTimer);
  closePending = false;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  await dialog.showMessageBox(mainWindow, {
    type: 'error', title: 'Your railway has not been saved',
    message: 'Rail Sim kept the app open because saving did not complete.', detail: message,
    buttons: ['Return to game'],
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 900, minWidth: 800, minHeight: 480,
    title: 'Rail Sim', backgroundColor: '#15252d', autoHideMenuBar: true,
    show: process.env.RAIL_SIM_SMOKE_TEST !== '1',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false,
      contextIsolation: true, sandbox: true, webSecurity: true,
      // Hidden smoke windows still need animation frames and public-input handling.
      backgroundThrottling: process.env.RAIL_SIM_SMOKE_TEST !== '1',
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('rail-sim://app/')) event.preventDefault();
  });
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  mainWindow.on('close', (event) => {
    if (approvedClose) return;
    event.preventDefault();
    if (closePending) return;
    closePending = true;
    mainWindow.webContents.send('rail-sim:before-close');
    closeTimer = setTimeout(() => void failedClose('The save acknowledgement timed out. Try saving again or export your world.'), 10000);
  });
  await mainWindow.loadURL('rail-sim://app/index.html');
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });
  app.whenReady().then(async () => {
    const clientRoot = path.resolve(__dirname, '../../dist/client');
    await protocol.handle('rail-sim', async (request) => {
      const url = new URL(request.url);
      if (url.hostname !== 'app') return new Response('Not found', { status: 404 });
      let decoded;
      try { decoded = decodeURIComponent(url.pathname); }
      catch { return new Response('Invalid path', { status: 400 }); }
      const target = path.resolve(clientRoot, `.${decoded}`);
      if (!target.startsWith(`${clientRoot}${path.sep}`)) return new Response('Forbidden', { status: 403 });
      const response = await net.fetch(pathToFileURL(target).href);
      const headers = new Headers(response.headers);
      headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
      return new Response(response.body, { status: response.status, headers });
    });
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    const storage = createFileStorage(path.join(app.getPath('userData'), 'saves'));
    for (const method of ['read', 'write', 'remove', 'list']) {
      ipcMain.handle(`rail-sim:${method}`, (event, ...args) => {
        if (!validSender(event)) throw new Error('Save request from an unauthorized frame');
        return storage[method](...args);
      });
    }
    ipcMain.on('rail-sim:close-ready', (event, result) => {
      if (!validSender(event) || !closePending) return;
      clearTimeout(closeTimer);
      if (result?.success === true) { approvedClose = true; mainWindow.close(); }
      else void failedClose(String(result?.error ?? 'Saving was interrupted.'));
    });
    await createWindow();
  }).catch((error) => { console.error('Native startup failed', error); app.exit(1); });
  app.on('window-all-closed', () => app.quit());
}
