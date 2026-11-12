import { app, BrowserWindow, Menu, session } from 'electron';
import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_LOCAL_CONFIG, type LocalConfig } from '../shared/bridge';
import { NO_TEST_SWITCHES, testSwitches, UNPACKAGED_ARG } from '../shared/test-switches';
import { normalizeLocalConfig } from './config-validation';
import { registerIpc } from './ipc';
import { createJsonStore, type JsonStore } from './json-store';
import { findOrphanPhotos, listPhotoFiles, resolvePhotoReadPath, selectPhotosToDelete } from './photos';
import { EMPTY_QUEUE, normalizeQueueFile, type QueueFile } from './queue-store';
import { createNavigationGuard, isAllowedPermissionCheck, isAllowedPermissionRequest } from './security';
import { applyStartupNotices } from './startup';

/** Deletes local photos whose upload finished 7+ days ago (run once on app start). Never throws. */
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
  try {
    queue.update((q) => ({ ...q, completedUploads: q.completedUploads.filter((u) => !expired.has(u)) }));
  } catch (err) {
    console.error('Saving the photo cleanup failed', err);
  }
}

/** Logs (count only, no paths) local photos that no upload job will ever pick up. Never throws. */
function reportOrphanPhotos(queue: JsonStore<QueueFile>, photosDir: string): void {
  try {
    const orphans = findOrphanPhotos(listPhotoFiles(photosDir, { readdirSync, statSync }), queue.get(), Date.now());
    if (orphans.length > 0) console.warn(`Orphan photo sweep: ${orphans.length} local photo(s) have no upload job`);
  } catch (err) {
    console.error('Orphan photo sweep failed', err);
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
const guardNavigation = createNavigationGuard({
  packaged: app.isPackaged,
  devUrl: process.env.ELECTRON_RENDERER_URL,
  indexFileUrl: pathToFileURL(indexFile).href,
});

// Web content is untrusted, in every webContents (the kiosk window and the hidden print window): no new
// windows, no webviews, and no renderer-initiated navigation (any frame) or redirect away from the app
// page. Loads started by main (`loadFile`/`loadURL`, e.g. the print window's temp HTML) do not emit these.
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.on('will-navigate', guardNavigation);
  contents.on('will-frame-navigate', guardNavigation);
  contents.on('will-redirect', guardNavigation);
});

function createWindow(onShown: () => void): void {
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
  win.once('ready-to-show', () => {
    win.show();
    setImmediate(onShown);
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  if (!packaged && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(indexFile);
  }
}

void app.whenReady().then(() => {
  if (app.isPackaged) Menu.setApplicationMenu(null);
  // Only the camera (video capture) may ever be granted; never the microphone.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) =>
    callback(isAllowedPermissionRequest(permission, (details as { mediaTypes?: string[] }).mediaTypes)),
  );
  session.defaultSession.setPermissionCheckHandler((_wc, permission, _origin, details) =>
    isAllowedPermissionCheck(permission, (details as { mediaType?: string }).mediaType),
  );

  const userData = app.getPath('userData');
  const photosDir = join(userData, 'photos');
  const store = createJsonStore<LocalConfig>(join(userData, 'config.json'), DEFAULT_LOCAL_CONFIG, {
    normalize: normalizeLocalConfig,
  });
  const queue = createJsonStore<QueueFile>(join(userData, 'queue.json'), EMPTY_QUEUE, {
    normalize: normalizeQueueFile(photosDir),
  });
  // Damaged settings or dropped upload jobs: Setup shows staff a notice until it is completed.
  applyStartupNotices(store, queue);
  deleteExpiredPhotos(queue, photosDir, Date.now());
  registerIpc(store, join(userData, 'overlays'), photosDir, queue, switches);
  createWindow(() => reportOrphanPhotos(queue, photosDir));
});

app.on('window-all-closed', () => app.quit());
