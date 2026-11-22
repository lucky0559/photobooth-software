import { DEFAULT_SETTINGS, type LayoutId, type SessionSync } from '@pb/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { DemoKioskApi, DEMO_PAY_AFTER_MS } from '../src/renderer/src/api/demo-api';

const stubOverlay = async (layout: LayoutId): Promise<ArrayBuffer> => new TextEncoder().encode(layout).buffer as ArrayBuffer;
const pay = { sessionId: 's1', downloadToken: 't', templateId: 'demo-strip' };

describe('DemoKioskApi', () => {
  let t = 0;
  let api: DemoKioskApi;
  beforeEach(() => {
    t = 0;
    api = new DemoKioskApi(() => t, stubOverlay);
  });

  it('serves default settings with the demo template active and payments on', async () => {
    const s = await api.getSettings();
    expect(s).toEqual({ ...DEFAULT_SETTINGS, activeTemplateId: 'demo-strip' });
    expect(s.freeMode).toBe(false);
  });

  it('serves the demo templates with a generated overlay', async () => {
    const strip = await api.getTemplate('demo-strip');
    expect(strip.template.layout).toBe('strip_2x6');
    expect(new TextDecoder().decode(strip.overlayPng)).toBe('strip_2x6');
    const r4 = await api.getTemplate('demo-4r');
    expect(r4.template.layout).toBe('print_4r');
    expect(new TextDecoder().decode(r4.overlayPng)).toBe('print_4r');
    await expect(api.getTemplate('nope')).rejects.toThrow('Unknown template nope');
  });

  it('creates a demo payment with an inline SVG QR', async () => {
    const p = await api.createPayment(pay);
    expect(p.amountCentavos).toBe(DEFAULT_SETTINGS.priceCentavos);
    expect(p.qrImageDataUrl.startsWith('data:image/svg+xml')).toBe(true);
    expect(decodeURIComponent(p.qrImageDataUrl)).toContain('DEMO PAYMENT');
  });

  it('turns paid exactly after the delay', async () => {
    const { paymentId } = await api.createPayment(pay);
    t = DEMO_PAY_AFTER_MS - 1;
    expect(await api.getPaymentStatus(paymentId)).toBe('pending');
    t = DEMO_PAY_AFTER_MS;
    expect(await api.getPaymentStatus(paymentId)).toBe('paid');
  });

  it('cancel after the delay reports paid; before it cancels for good', async () => {
    const a = await api.createPayment(pay);
    t = 5000;
    expect(await api.cancelPayment(a.paymentId)).toBe('paid');

    t = 0;
    api = new DemoKioskApi(() => t, stubOverlay);
    const b = await api.createPayment(pay);
    t = 100;
    expect(await api.cancelPayment(b.paymentId)).toBe('cancelled');
    t = 10_000;
    expect(await api.getPaymentStatus(b.paymentId)).toBe('cancelled');
  });

  it('times each payment from its own creation', async () => {
    const first = await api.createPayment(pay);
    t = 5000;
    expect(await api.getPaymentStatus(first.paymentId)).toBe('paid');
    const second = await api.createPayment(pay);
    expect(await api.getPaymentStatus(second.paymentId)).toBe('pending');
    t = 10_000;
    expect(await api.getPaymentStatus(second.paymentId)).toBe('paid');
  });

  it('rejects unknown payments and accepts uploads and sessions', async () => {
    await expect(api.getPaymentStatus('unknown')).rejects.toThrow();
    expect(await api.uploadPhoto('s1', new ArrayBuffer(1))).toBe('s1.jpg');
    await expect(api.upsertSession({ id: 's1' } as SessionSync)).resolves.toBeUndefined();
  });
});
