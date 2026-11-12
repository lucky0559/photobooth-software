import { describe, expect, it } from 'vitest';
import { saveSetup, type SetupChoices } from '../src/renderer/src/setup/save-setup';

/** Mimics main: once a PIN is set, setPin needs the current one. */
function fakeMain(initialPin: string | null) {
  let pin = initialPin;
  let failNextSetConfig = true;
  const calls: string[] = [];
  return {
    calls,
    pin: () => pin,
    bridge: {
      async setPin(next: string, current?: string) {
        calls.push(`setPin(${next}, ${current ?? '-'})`);
        if (pin !== null && current !== pin) throw new Error('Current PIN is wrong');
        pin = next;
      },
      async setConfig() {
        calls.push('setConfig');
        if (failNextSetConfig) {
          failNextSetConfig = false;
          throw new Error('disk full');
        }
        return {} as never;
      },
    },
  };
}

describe('saveSetup', () => {
  it('a Done retry after setConfig failed uses the new PIN as the current one', async () => {
    const main = fakeMain('2468');
    let current: string | null = '2468';
    const choices = (): SetupChoices => ({ pin: '1357', currentPin: current, cameraDeviceId: 'cam', printerName: null });
    const onPinSaved = (p: string): void => {
      current = p;
    };

    await expect(saveSetup(main.bridge, choices(), onPinSaved)).rejects.toThrow('disk full');
    await saveSetup(main.bridge, choices(), onPinSaved);
    expect(main.calls).toEqual(['setPin(1357, 2468)', 'setConfig', 'setPin(1357, 1357)', 'setConfig']);
    expect(main.pin()).toBe('1357');
  });

  it('first run retry works the same way', async () => {
    const main = fakeMain(null);
    let current: string | null = null;
    const choices = (): SetupChoices => ({ pin: '2468', currentPin: current, cameraDeviceId: 'cam', printerName: 'P' });
    await expect(saveSetup(main.bridge, choices(), (p) => (current = p))).rejects.toThrow('disk full');
    await saveSetup(main.bridge, choices(), (p) => (current = p));
    expect(main.calls).toEqual(['setPin(2468, -)', 'setConfig', 'setPin(2468, 2468)', 'setConfig']);
  });
});
