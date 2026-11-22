/** "Pop Film Lab" palette from docs/DESIGN.md. Must mirror `tokens.css` (the contrast test checks this). */
export const TOKENS = {
  ink: '#0F1B3D',
  'ink-2': '#1F2E5C',
  paper: '#FAF7F0',
  lime: '#C6F432',
  tangerine: '#FF6B2C',
  aqua: '#2EE6D6',
} as const;

export type TokenName = keyof typeof TOKENS;

const pair = (fg: TokenName, bg: TokenName, use: string) => ({
  fg: TOKENS[fg],
  bg: TOKENS[bg],
  name: `${fg} on ${bg} (${use})`,
});

/** Every text-on-fill combination the kiosk theme renders. `ink-2` only fills backdrop shapes, never text. */
export const TOKEN_PAIRS: { fg: string; bg: string; name: string }[] = [
  pair('ink', 'paper', 'cards, price ticket, shot label, review backdrop'),
  pair('ink', 'lime', 'primary button, lime banner'),
  pair('ink', 'aqua', 'secondary button, aqua banner'),
  pair('ink', 'tangerine', 'banners, danger button, status banner; paper fails at 2.66:1'),
  pair('paper', 'ink', 'ink banner, film-frame tile labels, captions on dark screens'),
  pair('lime', 'ink', 'timer digits, countdown numeral'),
];

function channel(hex: string, at: number): number {
  const c = parseInt(hex.slice(at, at + 2), 16) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x relative luminance of a `#rrggbb` color. */
function luminance(hex: string): number {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`Expected #rrggbb, got ${hex}`);
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

/** WCAG contrast ratio (1–21) between two `#rrggbb` colors; order does not matter. */
export function contrastRatio(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
