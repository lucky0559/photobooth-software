import { describe, expect, it } from 'vitest';
import { MAX_PRINT_ERROR_CHARS, truncatePrintError } from '../src/shared/queue';

describe('truncatePrintError', () => {
  it('keeps short errors as they are', () => {
    expect(truncatePrintError('Out of paper')).toBe('Out of paper');
    expect(truncatePrintError('x'.repeat(MAX_PRINT_ERROR_CHARS))).toHaveLength(MAX_PRINT_ERROR_CHARS);
  });

  it('cuts long errors to the limit, ending in an ellipsis', () => {
    const cut = truncatePrintError('x'.repeat(600));
    expect(cut).toHaveLength(MAX_PRINT_ERROR_CHARS);
    expect(cut.endsWith('…')).toBe(true);
  });

  it('never leaves a lone high surrogate when the cut lands inside an emoji', () => {
    // The emoji occupies code units 498 and 499; the cut keeps 499 units, i.e. only its high surrogate.
    const e = `${'a'.repeat(MAX_PRINT_ERROR_CHARS - 2)}📷${'b'.repeat(20)}`;
    const cut = truncatePrintError(e);
    expect(cut).toBe(`${'a'.repeat(MAX_PRINT_ERROR_CHARS - 2)}…`);
    expect(cut.length).toBeLessThanOrEqual(MAX_PRINT_ERROR_CHARS);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(cut)).toBe(false);
  });

  it('keeps a whole emoji that ends right before the cut', () => {
    const e = `${'a'.repeat(MAX_PRINT_ERROR_CHARS - 3)}📷${'b'.repeat(20)}`;
    expect(truncatePrintError(e)).toBe(`${'a'.repeat(MAX_PRINT_ERROR_CHARS - 3)}📷…`);
  });
});
