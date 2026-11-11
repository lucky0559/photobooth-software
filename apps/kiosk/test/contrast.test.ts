import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrastRatio, TOKEN_PAIRS, TOKENS } from '../src/renderer/src/theme/contrast';

const tokensCss = readFileSync(join(__dirname, '../src/renderer/src/theme/tokens.css'), 'utf8');

describe('contrastRatio', () => {
  it('is 21 for black on white and symmetric', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
  });

  it('is 1 for identical colors', () => {
    expect(contrastRatio('#6A3FD0', '#6a3fd0')).toBeCloseTo(1, 5);
  });

  it('matches the WCAG reference value for #777777 on white (4.48)', () => {
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });

  it('rejects malformed colors', () => {
    expect(() => contrastRatio('red', '#ffffff')).toThrow();
    expect(() => contrastRatio('#fff', '#ffffff')).toThrow();
  });
});

describe('theme tokens', () => {
  it('TOKENS mirror the custom properties in tokens.css', () => {
    for (const [name, value] of Object.entries(TOKENS)) {
      const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(tokensCss);
      expect(m?.[1]?.toLowerCase(), `--${name}`).toBe(value.toLowerCase());
    }
  });

  it('lists the pairs the theme uses', () => {
    expect(TOKEN_PAIRS.length).toBeGreaterThanOrEqual(6);
  });

  it.each(TOKEN_PAIRS)('$name is at least 4.5:1', ({ fg, bg }) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});
