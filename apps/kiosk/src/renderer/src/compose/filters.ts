import type { FilterId } from '@pb/core';

/** Guest-selectable looks. `css` is a canvas `ctx.filter` string applied to the photos only. */
export const FILTERS: Record<FilterId, { label: string; css: string }> = {
  none: { label: 'Original', css: 'none' },
  bw: { label: 'Black & White', css: 'grayscale(1) contrast(1.1)' },
  warm: { label: 'Warm', css: 'sepia(0.25) saturate(1.2) brightness(1.03)' },
};

/** The canvas filter for `id`; an unknown id (e.g. from stale state) falls back to no filter. */
export function filterCss(id: FilterId): string {
  return Object.hasOwn(FILTERS, id) ? FILTERS[id].css : FILTERS.none.css;
}
