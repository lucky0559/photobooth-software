import type { LayoutId } from './types.ts';
import type { Result } from './result.ts';
import { layoutSize } from './layouts.ts';

/** Template overlays are at most 10 MB (matches the `templates` bucket limit). */
export const TEMPLATE_MAX_BYTES = 10 * 1024 * 1024;

const SIZE_MESSAGES: Record<LayoutId, string> = {
  strip_2x6: 'Strip templates must be exactly 600 × 1800 px (2×6 in at 300 DPI)',
  print_4r: '4R templates must be exactly 1200 × 1800 px (4×6 in at 300 DPI)',
};

/** Check an uploaded overlay's metadata: PNG, exact layout canvas size, ≤ 10 MB. Reports every problem. */
export function validateTemplateImage(
  meta: { width: number; height: number; mime: string; bytes: number },
  layout: LayoutId,
): Result<true> {
  const errors: Record<string, string> = {};
  const size = layoutSize(layout);

  if (meta.mime !== 'image/png') errors.mime = 'Template must be a PNG with transparent photo areas';
  if (meta.width !== size.w || meta.height !== size.h) errors.size = SIZE_MESSAGES[layout];
  if (!(meta.bytes <= TEMPLATE_MAX_BYTES)) errors.bytes = 'Template must be 10 MB or smaller';

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: true };
}
