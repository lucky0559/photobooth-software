import { describe, it, expect } from 'vitest';
import { TEMPLATE_MAX_BYTES } from '@pb/core';
import { effectiveUploadLimit, formatMb } from './upload-limit';

describe('effectiveUploadLimit', () => {
  it('defaults to the 10 MB template maximum', () => {
    for (const raw of [undefined, '', 'abc', '0', '-5', '4.5', '1e6']) expect(effectiveUploadLimit(raw)).toBe(TEMPLATE_MAX_BYTES);
  });
  it('uses a smaller configured limit', () => {
    expect(effectiveUploadLimit('4404020')).toBe(4_404_020);
    expect(effectiveUploadLimit(' 4404020 ')).toBe(4_404_020);
  });
  it('never exceeds the template maximum', () => {
    expect(effectiveUploadLimit('99999999')).toBe(TEMPLATE_MAX_BYTES);
  });
});

describe('formatMb', () => {
  it('rounds down to one decimal', () => {
    expect(formatMb(TEMPLATE_MAX_BYTES)).toBe('10 MB');
    expect(formatMb(4_404_020)).toBe('4.2 MB'); // the Vercel Hobby setting in docs/DEPLOY.md
    expect(formatMb(4_613_734)).toBe('4.3 MB'); // 4.39999… MiB is not shown as 4.4
    expect(formatMb(4_718_591)).toBe('4.4 MB');
  });
});
