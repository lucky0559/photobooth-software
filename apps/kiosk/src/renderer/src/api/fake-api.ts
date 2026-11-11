import { DEFAULT_SETTINGS, layoutSize, type KioskSettings, type LayoutId, type SessionSync, type Template } from '@pb/core';
import type { KioskApi, PaymentStatus } from './kiosk-api';

/** Test controls for `FakeKioskApi`. Read on every call, so e2e tests can change `window.__pbFake` at runtime. */
export interface FakeConfig {
  settings: Partial<KioskSettings>;
  /** Payment flips to `paid` this many ms after creation; `null` = never. */
  payAfterMs: number | null;
  cancelReturns: 'cancelled' | 'paid';
  /** The next N `uploadPhoto` calls reject. */
  failUploads: number;
  /** The next N print-sheet compositions on the Output screen reject (R13 error path). */
  failCompose?: number;
  /** Sync queue loop interval in ms, read once at startup (default: production 10 s). Backoff is unchanged. */
  queueIntervalMs?: number;
}

declare global {
  interface Window {
    __pbFake?: FakeConfig;
    /** JSON from the `PB_FAKE_CONFIG` launch env var, exposed by the preload script. */
    __pbFakeConfig?: string;
  }
}

export const FAKE_TEMPLATES: Record<string, Template> = {
  'fake-strip': { id: 'fake-strip', name: 'Fake strip', layout: 'strip_2x6', overlayPath: 'fake-strip.png' },
  'fake-4r': { id: 'fake-4r', name: 'Fake 4R', layout: 'print_4r', overlayPath: 'fake-4r.png' },
};

const FOOTER_PX = 220;

export function defaultFakeConfig(): FakeConfig {
  return { settings: {}, payAfterMs: null, cancelReturns: 'cancelled', failUploads: 0 };
}

export function parseFakeConfig(json: string | undefined): FakeConfig {
  const base = defaultFakeConfig();
  if (!json) return base;
  const parsed = JSON.parse(json) as Partial<FakeConfig>;
  return { ...base, ...parsed, settings: { ...parsed.settings } };
}

/** Transparent PNG of the layout canvas with a colored footer band. */
async function makeOverlay(layout: LayoutId): Promise<ArrayBuffer> {
  const { w, h } = layoutSize(layout);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.fillStyle = layout === 'strip_2x6' ? '#d6336c' : '#1c7ed6';
  ctx.fillRect(0, h - FOOTER_PX, w, FOOTER_PX);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 64px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('FAKE', w / 2, h - FOOTER_PX / 2 + 22);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return blob.arrayBuffer();
}

const FAKE_QR =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#fff"/><rect x="20" y="20" width="160" height="160" fill="#000"/><text x="100" y="110" fill="#fff" font-size="24" text-anchor="middle">FAKE QR</text></svg>',
  );

interface FakePayment {
  createdAt: number;
  status: PaymentStatus;
}

export class FakeKioskApi implements KioskApi {
  readonly sessions = new Map<string, SessionSync>();
  readonly photos = new Map<string, ArrayBuffer>();
  private readonly payments = new Map<string, FakePayment>();
  private nextPayment = 1;

  constructor(
    private readonly config: () => FakeConfig,
    private readonly now: () => number = Date.now,
  ) {}

  async getSettings(): Promise<KioskSettings> {
    return { ...DEFAULT_SETTINGS, activeTemplateId: 'fake-strip', ...this.config().settings };
  }

  async getTemplate(id: string): Promise<{ template: Template; overlayPng: ArrayBuffer }> {
    const template = FAKE_TEMPLATES[id];
    if (!template) throw new Error(`Unknown template ${id}`);
    return { template, overlayPng: await makeOverlay(template.layout) };
  }

  async createPayment(_i: {
    sessionId: string;
    downloadToken: string;
    templateId: string;
  }): Promise<{ paymentId: string; qrImageDataUrl: string; amountCentavos: number }> {
    const settings = await this.getSettings();
    if (settings.freeMode) throw new Error('free_mode');
    const paymentId = `fake-pay-${this.nextPayment++}`;
    this.payments.set(paymentId, { createdAt: this.now(), status: 'pending' });
    return { paymentId, qrImageDataUrl: FAKE_QR, amountCentavos: settings.priceCentavos };
  }

  async getPaymentStatus(paymentId: string): Promise<PaymentStatus> {
    const p = this.payment(paymentId);
    const { payAfterMs } = this.config();
    if (p.status === 'pending' && payAfterMs !== null && this.now() - p.createdAt >= payAfterMs) p.status = 'paid';
    return p.status;
  }

  async cancelPayment(paymentId: string): Promise<'cancelled' | 'paid'> {
    const p = this.payment(paymentId);
    if ((await this.getPaymentStatus(paymentId)) !== 'paid') p.status = this.config().cancelReturns;
    return p.status === 'paid' ? 'paid' : 'cancelled';
  }

  async upsertSession(row: SessionSync): Promise<void> {
    this.sessions.set(row.id, { ...row });
  }

  async uploadPhoto(sessionId: string, jpeg: ArrayBuffer): Promise<string> {
    const cfg = this.config();
    if (cfg.failUploads > 0) {
      cfg.failUploads -= 1;
      throw new Error('Fake upload failure');
    }
    this.photos.set(sessionId, jpeg);
    return `${sessionId}.jpg`;
  }

  private payment(id: string): FakePayment {
    const p = this.payments.get(id);
    if (!p) throw new Error(`Unknown payment ${id}`);
    return p;
  }
}

/** Builds the fake from `window.__pbFakeConfig` and publishes its live config as `window.__pbFake`. */
export function createFakeKioskApi(): FakeKioskApi {
  window.__pbFake = parseFakeConfig(window.__pbFakeConfig);
  return new FakeKioskApi(() => window.__pbFake ?? defaultFakeConfig());
}
