import { describe, expect, it } from 'vitest';
import { createBrowserBridge } from '../src/renderer/src/web-bridge';
import { MemoryStore } from '../src/renderer/src/web-store';
import type { WebPrintUi } from '../src/renderer/src/web-print';

const SESSION_ID = '550e8400-e29b-41d4-a716-446655440000';
const JOB_ID = '550e8400-e29b-41d4-a716-446655440001';

function printer(): WebPrintUi {
  return {
    print: async () => ({ ok: true }),
    snapshot: () => ({ status: 'idle', message: null }),
    subscribe: () => () => undefined,
    printNow: () => undefined,
    cancel: () => undefined,
  };
}

describe('createBrowserBridge', () => {
  it('initializes defaults, hashes the PIN, and returns only the config view', async () => {
    const bundle = createBrowserBridge(new MemoryStore(), printer());
    await bundle.ready;

    const initial = await bundle.bridge.getConfig();
    expect(initial.pinSet).toBe(false);
    expect(initial.queueUnavailable).toBe(false);
    expect('pinHash' in initial).toBe(false);

    await bundle.bridge.setPin('4826');
    expect(await bundle.bridge.checkPin('4826')).toEqual({ ok: true });
    expect((await bundle.bridge.getConfig()).pinSet).toBe(true);
    await expect(bundle.bridge.setPin('48')).rejects.toThrow('PIN must be 4 to 8 digits');
  });

  it('marks invalid stored fields as recovered and resets only the bad field', async () => {
    const store = new MemoryStore();
    await store.put('meta', 'config', {
      pinHash: null,
      printerName: 'x'.repeat(201),
      cameraDeviceId: 'camera-1',
      cachedSettings: null,
      cachedTemplate: null,
      recoveredFromCorruption: false,
      uploadsDropped: false,
    });
    const bundle = createBrowserBridge(store, printer());
    await bundle.ready;

    const config = await bundle.bridge.getConfig();
    expect(config.recoveredFromCorruption).toBe(true);
    expect(config.printerName).toBeNull();
    expect(config.cameraDeviceId).toBe('camera-1');
  });

  it('stores photos, overlays, and queue retries using validated local paths', async () => {
    const store = new MemoryStore();
    const bundle = createBrowserBridge(store, printer(), () => 1_000);
    await bundle.ready;

    const photo = Uint8Array.from([1, 2, 3]);
    const path = await bundle.bridge.savePhoto(SESSION_ID, photo.buffer);
    expect(path).toBe(`photos/${SESSION_ID}.jpg`);
    expect(Array.from(new Uint8Array(await bundle.bridge.readPhoto(path)))).toEqual([1, 2, 3]);
    await expect(bundle.bridge.readPhoto('https://example.test/photo.jpg')).rejects.toThrow('Invalid photo path');

    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await bundle.bridge.saveOverlay('template_1', png.buffer);
    expect(Array.from(new Uint8Array((await bundle.bridge.readOverlay('template_1'))!))).toEqual(Array.from(png));

    await bundle.bridge.queueAdd([{
      id: JOB_ID,
      kind: 'upload_photo',
      sessionId: SESSION_ID,
      filePath: path,
      attempts: 9,
      nextAttemptAt: 99,
      lastError: 'ignored input fields',
    }]);
    expect(await bundle.bridge.queueList()).toEqual([{
      id: JOB_ID,
      kind: 'upload_photo',
      sessionId: SESSION_ID,
      filePath: path,
      attempts: 0,
      nextAttemptAt: 0,
      lastError: null,
    }]);

    await bundle.bridge.queueApply({ done: [], failed: [{ id: JOB_ID, error: 'offline', nextAttemptAt: 2_000 }] });
    expect((await bundle.bridge.queueList())[0]).toMatchObject({ attempts: 1, nextAttemptAt: 2_000, lastError: 'offline' });
    await bundle.bridge.queueApply({ done: [JOB_ID], failed: [] });
    expect(await bundle.bridge.queueList()).toEqual([]);
  });

  it('preserves a corrupt queue and reports it after saving configuration', async () => {
    const store = new MemoryStore();
    const damaged = { jobs: [{ broken: true }], completedUploads: [] };
    await store.put('meta', 'queue', damaged);
    const bundle = createBrowserBridge(store, printer());
    await bundle.ready;

    expect((await bundle.bridge.getConfig()).queueUnavailable).toBe(true);
    await expect(bundle.bridge.queueAdd([{
      id: JOB_ID,
      kind: 'upload_photo',
      sessionId: SESSION_ID,
      filePath: `photos/${SESSION_ID}.jpg`,
      attempts: 0,
      nextAttemptAt: 0,
      lastError: null,
    }])).rejects.toThrow('saved sync queue is damaged');
    expect((await bundle.bridge.setConfig({ cameraDeviceId: 'front-camera' })).queueUnavailable).toBe(true);
    expect(await store.get('meta', 'queue')).toEqual(damaged);
  });
});
