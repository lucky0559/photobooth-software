import { describe, it, expect } from 'vitest';
import { downloadLinkState, manilaDayKey, needsAttention, summarizeDay } from '../src/reports.ts';

describe('manilaDayKey', () => {
  it('splits days at 16:00 UTC (midnight Asia/Manila)', () => {
    expect(manilaDayKey('2026-11-11T15:59:59Z')).toBe('2026-11-11');
    expect(manilaDayKey('2026-11-11T16:00:00Z')).toBe('2026-11-12');
  });
  it('accepts offsets and handles month/year rollover', () => {
    expect(manilaDayKey('2026-12-31T16:00:00Z')).toBe('2027-01-01');
    expect(manilaDayKey('2026-11-12T00:30:00+08:00')).toBe('2026-11-12');
    expect(manilaDayKey('2026-11-11T16:00:00.123456+00:00')).toBe('2026-11-12'); // Postgres timestamptz text
  });
});

describe('summarizeDay', () => {
  it('summarizes only the given Manila day', () => {
    const p = [
      { amountCentavos: 15000, paidAt: '2026-11-11T16:30:00Z' },
      { amountCentavos: 15000, paidAt: '2026-11-11T15:00:00Z' },
    ];
    expect(summarizeDay(p, '2026-11-12')).toEqual({ count: 1, totalCentavos: 15000 });
    expect(summarizeDay(p, '2026-11-11')).toEqual({ count: 1, totalCentavos: 15000 });
  });
  it('adds amounts and counts on the same day; empty is zero', () => {
    const p = [
      { amountCentavos: 15000, paidAt: '2026-11-11T16:00:00Z' },
      { amountCentavos: 2000, paidAt: '2026-11-12T15:59:59Z' },
      { amountCentavos: 9999, paidAt: '2026-11-12T16:00:00Z' },
    ];
    expect(summarizeDay(p, '2026-11-12')).toEqual({ count: 2, totalCentavos: 17000 });
    expect(summarizeDay([], '2026-11-12')).toEqual({ count: 0, totalCentavos: 0 });
  });
});

describe('downloadLinkState', () => {
  const s = { createdAt: '2026-11-01T00:00:00Z', photoPath: 'x.jpg' };
  it('download link states', () => {
    expect(downloadLinkState(s, 7, new Date('2026-11-07T23:59:00Z'))).toBe('ready');
    expect(downloadLinkState(s, 7, new Date('2026-11-08T00:00:01Z'))).toBe('expired');
    expect(downloadLinkState({ ...s, photoPath: null }, 7, new Date('2026-11-02T00:00:00Z'))).toBe('uploading');
    expect(downloadLinkState(null, 7, new Date())).toBe('not_found');
  });
  it('expires at exactly createdAt + days, and is valid just before', () => {
    expect(downloadLinkState(s, 7, new Date('2026-11-08T00:00:00Z'))).toBe('expired');
    expect(downloadLinkState(s, 7, new Date('2026-11-07T23:59:59.999Z'))).toBe('ready');
    expect(downloadLinkState({ ...s, photoPath: null }, 7, new Date('2026-11-07T23:59:59.999Z'))).toBe('uploading');
  });
  it('checks expiry before upload state', () => {
    expect(downloadLinkState({ ...s, photoPath: null }, 7, new Date('2026-11-08T00:00:00Z'))).toBe('expired');
    expect(downloadLinkState({ ...s, photoPath: null }, 1, new Date('2026-11-03T00:00:00Z'))).toBe('expired');
  });
  it('uses the given expiry days', () => {
    expect(downloadLinkState(s, 30, new Date('2026-11-30T23:59:59Z'))).toBe('ready');
    expect(downloadLinkState(s, 30, new Date('2026-12-01T00:00:00Z'))).toBe('expired');
  });
  it('treats an unparseable createdAt as expired', () => {
    expect(downloadLinkState({ createdAt: 'nope', photoPath: 'x.jpg' }, 7, new Date('2026-11-02T00:00:00Z'))).toBe('expired');
  });
});

describe('needsAttention', () => {
  const now = new Date('2026-11-12T10:00:00Z');
  it('needs attention', () => {
    expect(needsAttention({ status: 'paid', createdAt: '2026-11-12T09:49:00Z' }, now)).toBe(true); // 11 min
    expect(needsAttention({ status: 'paid', createdAt: '2026-11-12T09:55:00Z' }, now)).toBe(false); // 5 min
    expect(needsAttention({ status: 'paid_after_cancel', createdAt: '2026-11-12T09:59:00Z' }, now)).toBe(true);
    expect(needsAttention({ status: 'completed', createdAt: '2026-11-01T00:00:00Z' }, now)).toBe(false);
  });
  it('boundary: exactly 10 minutes is not older than 10 minutes', () => {
    expect(needsAttention({ status: 'paid', createdAt: '2026-11-12T09:50:00Z' }, now)).toBe(false);
    expect(needsAttention({ status: 'paid', createdAt: '2026-11-12T09:49:59.999Z' }, now)).toBe(true);
  });
  it('other statuses never need attention', () => {
    for (const status of ['free', 'awaiting_payment', 'cancelled', 'completed']) {
      expect(needsAttention({ status, createdAt: '2026-01-01T00:00:00Z' }, now)).toBe(false);
    }
  });
});
