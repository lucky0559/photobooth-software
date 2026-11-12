import { DEFAULT_SETTINGS } from '@pb/core';
import { describe, expect, it, vi } from 'vitest';
import { FakeKioskApi, parseFakeConfig, type FakeConfig } from '../src/renderer/src/api/fake-api';

const input = { sessionId: 's1', downloadToken: 't', templateId: 'fake-strip' };

function setup(partial: Partial<FakeConfig> = {}) {
  const cfg: FakeConfig = { ...parseFakeConfig(undefined), ...partial };
  let t = 0;
  const api = new FakeKioskApi(() => cfg, () => t);
  return { api, cfg, advance: (ms: number) => (t += ms) };
}

describe('FakeKioskApi', () => {
  it('merges settings over core defaults with fake-strip active', async () => {
    const { api } = setup({ settings: { priceCentavos: 5000 } });
    expect(await api.getSettings()).toEqual({ ...DEFAULT_SETTINGS, activeTemplateId: 'fake-strip', priceCentavos: 5000 });
  });

  it('parses PB_FAKE_CONFIG JSON over defaults', () => {
    expect(parseFakeConfig('{"payAfterMs":100,"settings":{"freeMode":true}}')).toEqual({
      settings: { freeMode: true },
      payAfterMs: 100,
      cancelReturns: 'cancelled',
      failUploads: 0,
    });
  });

  it('falls back to defaults (and logs) on bad PB_FAKE_CONFIG JSON', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(parseFakeConfig('{ not json')).toEqual(parseFakeConfig(undefined));
    expect(parseFakeConfig('"a string"')).toEqual(parseFakeConfig(undefined));
    expect(parseFakeConfig('{"settings":"oops"}')).toEqual(parseFakeConfig(undefined));
    expect(err).toHaveBeenCalledTimes(3);
    err.mockRestore();
  });

  it('pays after payAfterMs and reads config live', async () => {
    const { api, cfg, advance } = setup();
    const { paymentId, amountCentavos } = await api.createPayment(input);
    expect(amountCentavos).toBe(DEFAULT_SETTINGS.priceCentavos);
    advance(10_000);
    expect(await api.getPaymentStatus(paymentId)).toBe('pending');
    cfg.payAfterMs = 500;
    expect(await api.getPaymentStatus(paymentId)).toBe('paid');
  });

  it('cancel returns cancelReturns unless already paid', async () => {
    const { api, cfg } = setup({ cancelReturns: 'paid' });
    const a = await api.createPayment(input);
    expect(await api.cancelPayment(a.paymentId)).toBe('paid');
    expect(await api.getPaymentStatus(a.paymentId)).toBe('paid');
    cfg.cancelReturns = 'cancelled';
    const b = await api.createPayment(input);
    expect(await api.cancelPayment(b.paymentId)).toBe('cancelled');
    expect(await api.getPaymentStatus(b.paymentId)).toBe('cancelled');
  });

  it('counts createPayment calls and fails them on createPaymentFails', async () => {
    const { api, cfg } = setup();
    await api.createPayment(input);
    cfg.createPaymentFails = true;
    await expect(api.createPayment(input)).rejects.toThrow();
    expect(api.createPaymentCalls).toBe(2);
  });

  it('cancelPayment throws for the next cancelThrows calls, then answers', async () => {
    const { api, cfg } = setup({ cancelThrows: 2 });
    const { paymentId } = await api.createPayment(input);
    await expect(api.cancelPayment(paymentId)).rejects.toThrow();
    await expect(api.cancelPayment(paymentId)).rejects.toThrow();
    expect(cfg.cancelThrows).toBe(0);
    expect(await api.cancelPayment(paymentId)).toBe('cancelled');
  });

  it('refuses payments in free mode', async () => {
    const { api } = setup({ settings: { freeMode: true } });
    await expect(api.createPayment(input)).rejects.toThrow('free_mode');
  });

  it('fails the next N uploads, then succeeds', async () => {
    const { api, cfg } = setup({ failUploads: 1 });
    await expect(api.uploadPhoto('s1', new ArrayBuffer(1))).rejects.toThrow();
    expect(cfg.failUploads).toBe(0);
    expect(await api.uploadPhoto('s1', new ArrayBuffer(1))).toBe('s1.jpg');
  });
});

describe('FakeKioskApi account (R21)', () => {
  it('starts signed in; signOut and signIn switch accounts; an admin email gets the role-check error', async () => {
    const { api } = setup();
    expect(await api.isSignedIn()).toBe(true);
    await api.signOut();
    expect(await api.isSignedIn()).toBe(false);
    await expect(api.signIn('admin@local.test', 'pw')).rejects.toThrow('This account is not a kiosk account.');
    expect(await api.isSignedIn()).toBe(false);
    await api.signIn('kiosk-2@local.test', 'pw');
    expect(await api.isSignedIn()).toBe(true);
  });
});
