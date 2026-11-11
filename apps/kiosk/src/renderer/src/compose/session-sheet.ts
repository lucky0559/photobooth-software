import type { FilterId, Template } from '@pb/core';
import type { KioskBridge } from '../../../shared/bridge';
import { shotStore, type ShotStore } from '../camera/shot-store';
import { composeSheet } from './compose';

export interface SessionImages {
  shots: ImageBitmap[];
  overlay: ImageBitmap;
}

export interface SessionSource {
  template: Template;
  /** Shot ids from `KioskState.shots`, in capture order. */
  shotIds: string[];
  bridge?: Pick<KioskBridge, 'readOverlay'>;
  store?: ShotStore;
}

/** Decodes the session's shots (from the shot store) and the cached template overlay. Caller closes the bitmaps. */
export async function loadSessionImages({
  template,
  shotIds,
  bridge = window.kiosk,
  store = shotStore,
}: SessionSource): Promise<SessionImages> {
  const blobs = shotIds.map((id) => {
    const blob = store.get(id);
    if (!blob) throw new Error(`Shot ${id} is missing`);
    return blob;
  });
  const png = await bridge.readOverlay(template.id);
  if (!png) throw new Error(`Overlay for template ${template.id} is not cached`);
  const [overlay, ...shots] = await Promise.all([
    createImageBitmap(new Blob([png], { type: 'image/png' })),
    ...blobs.map((b) => createImageBitmap(b)),
  ]);
  return { shots, overlay: overlay as ImageBitmap };
}

export function closeSessionImages({ shots, overlay }: SessionImages): void {
  for (const s of shots) s.close();
  overlay.close();
}

/** Composes the session's 1200×1800 print sheet JPEG. */
export async function buildSessionSheet(args: SessionSource & { filter: FilterId }): Promise<Blob> {
  const images = await loadSessionImages(args);
  try {
    return await composeSheet({ layout: args.template.layout, filter: args.filter, ...images });
  } finally {
    closeSessionImages(images);
  }
}
