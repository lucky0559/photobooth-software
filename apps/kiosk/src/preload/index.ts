import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type KioskBridge } from '../shared/bridge';

const bridge: KioskBridge = {
  getConfig: () => ipcRenderer.invoke(IPC.getConfig),
  setConfig: (patch) => ipcRenderer.invoke(IPC.setConfig, patch),
  setPin: (pin) => ipcRenderer.invoke(IPC.setPin, pin),
  checkPin: (pin) => ipcRenderer.invoke(IPC.checkPin, pin),
  saveOverlay: (templateId, png) => ipcRenderer.invoke(IPC.saveOverlay, templateId, png),
  readOverlay: (templateId) => ipcRenderer.invoke(IPC.readOverlay, templateId),
};

contextBridge.exposeInMainWorld('kiosk', bridge);

// Test hook: initial FakeKioskApi config (JSON string). Only present when the launcher sets it.
const fakeConfig = process.env.PB_FAKE_CONFIG;
if (fakeConfig) contextBridge.exposeInMainWorld('__pbFakeConfig', fakeConfig);
