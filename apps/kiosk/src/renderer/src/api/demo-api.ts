import { DEFAULT_SETTINGS, type KioskSettings, type LayoutId, type SessionSync, type Template } from '@pb/core';
import { renderDemoOverlay } from './demo-overlay';
import type { KioskApi, PaymentStatus } from './kiosk-api';

export const DEMO_PAY_AFTER_MS = 5000;
export const DEMO_ACTIVE_TEMPLATE_ID = 'demo-strip';

export const DEMO_TEMPLATES: Record<string, Template> = {
  'demo-strip': { id: 'demo-strip', name: 'Demo strip', layout: 'strip_2x6', overlayPath: 'demo-strip.png' },
  'demo-4r': { id: 'demo-4r', name: 'Demo 4R', layout: 'print_4r', overlayPath: 'demo-4r.png' },
};

// Built per call, not at module level, so the bundler can drop the whole demo backend from the real build.
const demoQr = (): string =>
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#fff"/><rect x="20" y="20" width="160" height="160" fill="#000"/><text x="100" y="110" fill="#fff" font-size="20" text-anchor="middle">DEMO PAYMENT</text></svg>',
  );

/** In-memory backend for the trial build: no network, payments "succeed" a fixed time after creation. */
export class DemoKioskApi implements KioskApi {
  private readonly created = new Map<string, number>();
  private readonly cancelled = new Set<string>();
  private nextPayment = 1;
  private readonly overlays = new Map<LayoutId, Promise<ArrayBuffer>>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly overlay: (layout: LayoutId) => Promise<ArrayBuffer> = renderDemoOverlay,
  ) {}

  async getSettings(): Promise<KioskSettings> {
    return { ...DEFAULT_SETTINGS, activeTemplateId: DEMO_ACTIVE_TEMPLATE_ID };
  }

  async getTemplate(id: string): Promise<{ template: Template; overlayPng: ArrayBuffer }> {
    const template = DEMO_TEMPLATES[id];
    if (!template) throw new Error(`Unknown template ${id}`);
    return { template, overlayPng: await this.overlayFor(template.layout) };
  }

  /** Render each layout's overlay once (syncSettings asks every ~5 s); a failed render is not cached. */
  private overlayFor(layout: LayoutId): Promise<ArrayBuffer> {
    let p = this.overlays.get(layout);
    if (!p) {
      p = this.overlay(layout);
      this.overlays.set(layout, p);
      p.catch(() => this.overlays.delete(layout));
    }
    return p;
  }

  async createPayment(_i: {
    sessionId: string;
    downloadToken: string;
    templateId: string;
  }): Promise<{ paymentId: string; qrImageDataUrl: string; amountCentavos: number }> {
    const paymentId = `demo-pay-${this.nextPayment++}`;
    this.created.set(paymentId, this.now());
    return { paymentId, qrImageDataUrl: demoQr(), amountCentavos: DEFAULT_SETTINGS.priceCentavos };
  }

  async getPaymentStatus(paymentId: string): Promise<PaymentStatus> {
    const createdAt = this.created.get(paymentId);
    if (createdAt === undefined) throw new Error(`Unknown payment ${paymentId}`);
    if (this.cancelled.has(paymentId)) return 'cancelled';
    return this.now() - createdAt >= DEMO_PAY_AFTER_MS ? 'paid' : 'pending';
  }

  async cancelPayment(paymentId: string): Promise<'cancelled' | 'paid'> {
    if ((await this.getPaymentStatus(paymentId)) === 'paid') return 'paid';
    this.cancelled.add(paymentId);
    return 'cancelled';
  }

  async upsertSession(_row: SessionSync): Promise<void> {}

  async uploadPhoto(sessionId: string, _jpeg: ArrayBuffer): Promise<string> {
    return `${sessionId}.jpg`;
  }

  async signOut(): Promise<void> {}
}

export function createDemoKioskApi(): DemoKioskApi {
  return new DemoKioskApi();
}
