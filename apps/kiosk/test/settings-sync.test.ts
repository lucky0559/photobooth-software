import { DEFAULT_SETTINGS, type KioskSettings, type Template } from '@pb/core';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { DEFAULT_LOCAL_CONFIG, toConfigView, type ConfigView } from '../src/shared/bridge';
import { attractStatus, syncSettings, type SyncApi, type SyncBridge } from '../src/renderer/src/state/settings-sync';

const TEMPLATE: Template = { id: 'tpl-1', name: 'Strip', layout: 'strip_2x6', overlayPath: 'tpl-1.png' };
const ONLINE: KioskSettings = { ...DEFAULT_SETTINGS, priceCentavos: 5000, activeTemplateId: 'tpl-1' };

function fakeBridge(initial: Partial<ConfigView> = {}) {
  let config: ConfigView = { ...toConfigView(DEFAULT_LOCAL_CONFIG), ...initial };
  const overlays = new Map<string, ArrayBuffer>();
  const bridge: SyncBridge = {
    getConfig: async () => config,
    setConfig: async (patch) => (config = { ...config, ...patch }),
    saveOverlay: async (id, png) => {
      overlays.set(id, png);
    },
  };
  return { bridge, overlays, config: () => config };
}

function fakeApi(opts: { settings?: KioskSettings | Error; template?: Template | Error } = {}): SyncApi {
  return {
    getSettings: async () => {
      const s = opts.settings ?? ONLINE;
      if (s instanceof Error) throw s;
      return s;
    },
    getTemplate: async (id) => {
      const t = opts.template ?? TEMPLATE;
      if (t instanceof Error) throw t;
      if (t.id !== id) throw new Error(`unknown ${id}`);
      return { template: t, overlayPng: new ArrayBuffer(8) };
    },
  };
}

describe('syncSettings', () => {
  // Cache I/O failures are logged on purpose; keep the expected stack traces out of the test output.
  let consoleError: MockInstance<typeof console.error>;
  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => consoleError.mockRestore());

  it('fetches settings and the active template, caches both and saves the overlay', async () => {
    const { bridge, overlays, config } = fakeBridge();
    const r = await syncSettings(fakeApi(), bridge);
    expect(r).toEqual({ settings: ONLINE, template: TEMPLATE, settingsFetchFailed: false });
    expect(config().cachedSettings).toEqual(ONLINE);
    expect(config().cachedTemplate).toEqual(TEMPLATE);
    expect(overlays.get('tpl-1')?.byteLength).toBe(8);
  });

  it('falls back to cached settings and template when the settings fetch fails', async () => {
    const cached = { ...ONLINE, priceCentavos: 9900 };
    const { bridge } = fakeBridge({ cachedSettings: cached, cachedTemplate: TEMPLATE });
    const r = await syncSettings(fakeApi({ settings: new Error('offline') }), bridge);
    expect(r).toEqual({ settings: cached, template: TEMPLATE, settingsFetchFailed: true });
  });

  it('uses DEFAULT_SETTINGS and no template when the fetch fails and nothing is cached', async () => {
    const { bridge } = fakeBridge();
    const r = await syncSettings(fakeApi({ settings: new Error('offline') }), bridge);
    expect(r).toEqual({ settings: DEFAULT_SETTINGS, template: null, settingsFetchFailed: true });
  });

  it('keeps the cached template when only the template fetch fails', async () => {
    const { bridge, config } = fakeBridge({ cachedTemplate: TEMPLATE });
    const r = await syncSettings(fakeApi({ template: new Error('boom') }), bridge);
    expect(r).toEqual({ settings: ONLINE, template: TEMPLATE, settingsFetchFailed: false });
    expect(config().cachedSettings).toEqual(ONLINE);
    expect(config().cachedTemplate).toEqual(TEMPLATE);
  });

  it('still returns fetched settings and template when caching them fails', async () => {
    const { bridge } = fakeBridge();
    bridge.setConfig = async () => {
      throw new Error('disk full');
    };
    const r = await syncSettings(fakeApi(), bridge);
    expect(r).toEqual({ settings: ONLINE, template: TEMPLATE, settingsFetchFailed: false });
    expect(consoleError).toHaveBeenCalledWith('Caching settings failed', expect.any(Error));
  });

  it('treats an unreadable cache as empty', async () => {
    const { bridge } = fakeBridge();
    bridge.getConfig = async () => {
      throw new Error('ipc down');
    };
    expect(await syncSettings(fakeApi(), bridge)).toEqual({ settings: ONLINE, template: TEMPLATE, settingsFetchFailed: false });
    expect(await syncSettings(fakeApi({ settings: new Error('offline') }), bridge)).toEqual({
      settings: DEFAULT_SETTINGS,
      template: null,
      settingsFetchFailed: true,
    });
    expect(consoleError).toHaveBeenCalledWith('Reading cached settings failed', expect.any(Error));
  });

  it('clears the cached template when settings have no active template', async () => {
    const { bridge, config } = fakeBridge({ cachedTemplate: TEMPLATE });
    const r = await syncSettings(fakeApi({ settings: { ...ONLINE, activeTemplateId: null } }), bridge);
    expect(r.template).toBeNull();
    expect(config().cachedTemplate).toBeNull();
  });
});

describe('attractStatus', () => {
  it('shows the price and allows start when online with a template', () => {
    expect(attractStatus({ settings: ONLINE, template: TEMPLATE, online: true })).toEqual({
      canStart: true,
      banner: null,
      priceLabel: '₱50.00',
    });
  });

  it('shows "Free today!" in free mode, even offline', () => {
    const s = attractStatus({ settings: { ...ONLINE, freeMode: true }, template: TEMPLATE, online: false });
    expect(s).toEqual({ canStart: true, banner: null, priceLabel: 'Free today!' });
  });

  it('trial: offline does not block a paid session; the real build still does', () => {
    const trial = attractStatus({ settings: ONLINE, template: TEMPLATE, online: false, trial: true });
    expect(trial).toEqual({ canStart: true, banner: null, priceLabel: '₱50.00' });
    expect(attractStatus({ settings: ONLINE, template: TEMPLATE, online: false, trial: false }).canStart).toBe(false);
  });

  it('disables start offline when not in free mode', () => {
    const s = attractStatus({ settings: ONLINE, template: TEMPLATE, online: false });
    expect(s.canStart).toBe(false);
    expect(s.banner).toBe('Offline — payments unavailable');
  });

  it('disables start with no template at all', () => {
    const s = attractStatus({ settings: { ...ONLINE, freeMode: true }, template: null, online: true });
    expect(s.canStart).toBe(false);
    expect(s.banner).toBe('Setup needed: no active template');
  });

  it('is out of service while the saved-sessions file is unreadable, free mode included', () => {
    for (const settings of [ONLINE, { ...ONLINE, freeMode: true }]) {
      const s = attractStatus({ settings, template: TEMPLATE, online: true, queueUnavailable: true });
      expect(s.canStart).toBe(false);
      expect(s.banner).toBe('Out of service. Please call staff.');
    }
    expect(attractStatus({ settings: ONLINE, template: TEMPLATE, online: true, queueUnavailable: false }).canStart).toBe(true);
  });
});
