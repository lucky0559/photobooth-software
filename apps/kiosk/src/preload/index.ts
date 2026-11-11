import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type KioskBridge } from '../shared/bridge';
import { buildTestPageJpeg } from '../shared/test-page';

const bridge: KioskBridge = {
  getConfig: () => ipcRenderer.invoke(IPC.getConfig),
  setConfig: (patch) => ipcRenderer.invoke(IPC.setConfig, patch),
  setPin: (pin) => ipcRenderer.invoke(IPC.setPin, pin),
  checkPin: (pin) => ipcRenderer.invoke(IPC.checkPin, pin),
  saveOverlay: (templateId, png) => ipcRenderer.invoke(IPC.saveOverlay, templateId, png),
  readOverlay: (templateId) => ipcRenderer.invoke(IPC.readOverlay, templateId),
  print: (jpeg, copies) => ipcRenderer.invoke(IPC.print, jpeg, copies),
  listPrinters: () => ipcRenderer.invoke(IPC.listPrinters),
  // The page is built here and goes through the same validated `print` IPC path.
  printTestPage: async () => ipcRenderer.invoke(IPC.print, await buildTestPageJpeg(), 1),
};

contextBridge.exposeInMainWorld('kiosk', bridge);

// Test hook: initial FakeKioskApi config (JSON string). Only present when the launcher sets it.
const fakeConfig = process.env.PB_FAKE_CONFIG;
if (fakeConfig) contextBridge.exposeInMainWorld('__pbFakeConfig', fakeConfig);

// Test hook: number of fake print calls the main process has recorded. Only when PB_FAKE_PRINT=1.
if (process.env.PB_FAKE_PRINT === '1') {
  contextBridge.exposeInMainWorld('__pbPrintCalls', () => ipcRenderer.invoke(IPC.debugPrintCalls));
}
