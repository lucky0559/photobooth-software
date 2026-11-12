import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type KioskBridge } from '../shared/bridge';
import { buildTestPageJpeg } from '../shared/test-page';
import { testSwitches, UNPACKAGED_ARG } from '../shared/test-switches';

const bridge: KioskBridge = {
  getConfig: () => ipcRenderer.invoke(IPC.getConfig),
  setConfig: (patch) => ipcRenderer.invoke(IPC.setConfig, patch),
  setPin: (pin, currentPin) => ipcRenderer.invoke(IPC.setPin, pin, currentPin),
  checkPin: (pin) => ipcRenderer.invoke(IPC.checkPin, pin),
  saveOverlay: (templateId, png) => ipcRenderer.invoke(IPC.saveOverlay, templateId, png),
  readOverlay: (templateId) => ipcRenderer.invoke(IPC.readOverlay, templateId),
  print: (jpeg, copies) => ipcRenderer.invoke(IPC.print, jpeg, copies),
  listPrinters: () => ipcRenderer.invoke(IPC.listPrinters),
  // The page is built here and goes through the same validated `print` IPC path.
  printTestPage: async () => ipcRenderer.invoke(IPC.print, await buildTestPageJpeg(), 1),
  savePhoto: (sessionId, jpeg) => ipcRenderer.invoke(IPC.savePhoto, sessionId, jpeg),
  readPhoto: (path) => ipcRenderer.invoke(IPC.readPhoto, path),
  queueAdd: (jobs) => ipcRenderer.invoke(IPC.queueAdd, jobs),
  queueList: () => ipcRenderer.invoke(IPC.queueList),
  queueApply: (result) => ipcRenderer.invoke(IPC.queueApply, result),
};

contextBridge.exposeInMainWorld('kiosk', bridge);

// Test hooks: compiled only into the e2e build, and only honored when the main process says the app is
// not packaged (the flag is absent in a packaged app, so this fails closed).
if (__PB_TEST_BUILD__) {
  const switches = testSwitches(process.env, !process.argv.includes(UNPACKAGED_ARG));
  // Initial FakeKioskApi config (JSON string).
  if (switches.fakeConfig) contextBridge.exposeInMainWorld('__pbFakeConfig', switches.fakeConfig);
  // Number of fake print calls the main process has recorded.
  if (switches.fakePrint) {
    contextBridge.exposeInMainWorld('__pbPrintCalls', () => ipcRenderer.invoke(IPC.debugPrintCalls));
  }
}
