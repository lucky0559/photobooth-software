import { describe, expect, it } from 'vitest';
import { deliveryQrPayload, downloadUrl, TRIAL_QR_TEXT } from '../src/renderer/src/screens/download-url';

describe('downloadUrl', () => {
  it('joins an absolute http(s) base and the token', () => {
    expect(downloadUrl('https://photos.example.com', 'tok')).toBe('https://photos.example.com/d/tok');
    expect(downloadUrl('https://photos.example.com/', 'tok')).toBe('https://photos.example.com/d/tok');
    expect(downloadUrl('http://localhost:3000', 'tok')).toBe('http://localhost:3000/d/tok');
  });
  it.each([undefined, '', '   ', '/app', 'photos.example.com', 'ftp://x.com', 'javascript:alert(1)'])(
    'returns null for a missing or relative base %j',
    (base) => {
      expect(downloadUrl(base, 'tok')).toBeNull();
    },
  );
});

describe('deliveryQrPayload', () => {
  it('uses the trial text in a trial build, with or without a base URL', () => {
    expect(TRIAL_QR_TEXT).toBe('Trial build: the real kiosk shows your photo download link here.');
    expect(deliveryQrPayload(true, undefined, 'tok')).toBe(TRIAL_QR_TEXT);
    expect(deliveryQrPayload(true, 'https://booth.example.com', 'tok')).toBe(TRIAL_QR_TEXT);
  });
  it('uses the download URL otherwise, or null without a base', () => {
    expect(deliveryQrPayload(false, 'https://booth.example.com', 'tok')).toBe(downloadUrl('https://booth.example.com', 'tok'));
    expect(deliveryQrPayload(false, undefined, 'tok')).toBeNull();
  });
});
