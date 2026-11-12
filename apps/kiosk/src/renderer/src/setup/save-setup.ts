import type { KioskBridge } from '../../../shared/bridge';

export interface SetupChoices {
  pin: string;
  /** The PIN main currently holds (null on first run). */
  currentPin: string | null;
  cameraDeviceId: string;
  printerName: string | null;
}

/**
 * Saves Setup: PIN first, then devices. `onPinSaved` runs as soon as main accepted the new PIN, so the
 * caller can treat it as the current PIN: if saving the devices then fails, pressing Done again sends
 * `setPin(new, new)` instead of the stale old PIN (which would fail and burn throttle attempts).
 */
export async function saveSetup(
  bridge: Pick<KioskBridge, 'setPin' | 'setConfig'>,
  c: SetupChoices,
  onPinSaved: (pin: string) => void,
): Promise<void> {
  await bridge.setPin(c.pin, c.currentPin ?? undefined);
  onPinSaved(c.pin);
  await bridge.setConfig({ cameraDeviceId: c.cameraDeviceId, printerName: c.printerName });
}
