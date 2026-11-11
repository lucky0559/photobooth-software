import { app, BrowserWindow, Menu } from 'electron';
import { join } from 'node:path';
import { DEFAULT_LOCAL_CONFIG, type LocalConfig } from '../shared/bridge';
import { registerIpc } from './ipc';
import { createJsonStore } from './json-store';

// Must run before anything reads userData (tests point this at a temp dir).
if (process.env.PB_USER_DATA) app.setPath('userData', process.env.PB_USER_DATA);

if (process.env.PB_FAKE_CAMERA === '1') {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
}

function createWindow(): void {
  const packaged = app.isPackaged;
  const win = new BrowserWindow({
    width: 1080,
    height: 1920,
    show: false,
    kiosk: packaged,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !packaged,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  if (!packaged && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

void app.whenReady().then(() => {
  if (app.isPackaged) Menu.setApplicationMenu(null);
  const userData = app.getPath('userData');
  const store = createJsonStore<LocalConfig>(join(userData, 'config.json'), DEFAULT_LOCAL_CONFIG);
  registerIpc(store, join(userData, 'overlays'));
  createWindow();
});

app.on('window-all-closed', () => app.quit());
