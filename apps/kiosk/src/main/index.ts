import { app, BrowserWindow, Menu, session } from 'electron';
import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_LOCAL_CONFIG, type LocalConfig } from '../shared/bridge';
import { NO_TEST_SWITCHES, testSwitches, UNPACKAGED_ARG } from '../shared/test-switches';
import { isLocalConfig } from './config-validation';
import { registerIpc } from './ipc';
import { createJsonStore, type JsonStore } from './json-store';
import { findOrphanPhotos, resolvePhotoReadPath, selectPhotosToDelete } from './photos';
import { EMPTY_QUEUE, queueFileValidator, type QueueFile } from './queue-store';
import { isAllowedNavigation, isAllowedPermission } from './security';

/** Deletes local photos whose upload finished 7+ days ago (run once on app start). */
function deleteExpiredPhotos(queue: JsonStore<QueueFile>, photosDir: string, now: number): void {
  const expired = new Set(selectPhotosToDelete(now, queue.get().completedUploads));
  if (expired.size === 0) return;
  for (const u of expired) {
    try {
      rmSync(resolvePhotoReadPath(photosDir, u.filePath), { force: true });
    } catch (err) {
      console.error('Deleting old photo failed', err);
    }
  }
  queue.update((q) => ({ ...q, completedUploads: q.completedUploads.filter((u) => !expired.has(u)) }));
}

/** Logs (count only, no paths) local photos that no upload job will ever pick up. */
function reportOrphanPhotos(queue: JsonStore<QueueFile>, photosDir: string, now: number): void {
  try {
    const files = readdirSync(photosDir).map((name) => ({ name, mtimeMs: statSync(join(photosDir, name)).mtimeMs }));
    const orphans = findOrphanPhotos(files, queue.get(), now);
    if (orphans.length > 0) console.warn(`Orphan photo sweep: ${orphans.length} local photo(s) have no upload job`);
  } catch {
    // No photos dir yet, or unreadable: nothing to report.
  }
}

// Test-only switches exist only in the e2e build, and are ignored at runtime when packaged.
const switches = __PB_TEST_BUILD__ ? testSwitches(process.env, app.isPackaged) : NO_TEST_SWITCHES;

// Must run before anything reads userData (tests point this at a temp dir).
if (switches.userData) app.setPath('userData', switches.userData);

if (switches.fakeCamera) {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
}

const indexFile = join(__dirname, '../renderer/index.html');
const navigationPolicy = {
  packaged: app.isPackaged,
  devUrl: process.env.ELECTRON_RENDERER_URL,
  indexFileUrl: pathToFileURL(indexFile).href,
};

// The renderer is untrusted: no new windows, no webviews, no navigation away from the app page.
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

function lockNavigation(win: BrowserWindow): void {
  const guard = (event: { preventDefault(): void }, url: string): void => {
    if (!isAllowedNavigation(url, navigationPolicy)) event.preventDefault();
  };
  win.webContents.on('will-navigate', guard);
  win.webContents.on('will-redirect', guard);
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
      webviewTag: false,
      // Tells the preload it may honor test switches; absent (fail closed) in a packaged app.
      additionalArguments: packaged ? [] : [UNPACKAGED_ARG],
    },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  lockNavigation(win);

  if (!packaged && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(indexFile);
  }
}

void app.whenReady().then(() => {
  if (app.isPackaged) Menu.setApplicationMenu(null);
  // Only the camera may ever be granted.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(isAllowedPermission(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => isAllowedPermission(permission));

  const userData = app.getPath('userData');
  const photosDir = join(userData, 'photos');
  const store = createJsonStore<LocalConfig>(join(userData, 'config.json'), DEFAULT_LOCAL_CONFIG, { validate: isLocalConfig });
  // A damaged config resets to first-run Setup; flag it so Setup shows staff a notice.
  if (store.recoveredFromCorruption) store.update((c) => ({ ...c, recoveredFromCorruption: true }));
  const queue = createJsonStore<QueueFile>(join(userData, 'queue.json'), EMPTY_QUEUE, {
    validate: queueFileValidator(photosDir),
  });
  const now = Date.now();
  deleteExpiredPhotos(queue, photosDir, now);
  reportOrphanPhotos(queue, photosDir, now);
  registerIpc(store, join(userData, 'overlays'), photosDir, queue, switches);
  createWindow();
});

app.on('window-all-closed', () => app.quit());
