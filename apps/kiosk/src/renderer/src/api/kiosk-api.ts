import type { KioskSettings, SessionSync, Template } from '@pb/core';

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'cancelled';

/** Everything the kiosk needs from the cloud. `SupabaseKioskApi` is real; `FakeKioskApi` backs e2e tests. */
export interface KioskApi {
  getSettings(): Promise<KioskSettings>;
  getTemplate(id: string): Promise<{ template: Template; overlayPng: ArrayBuffer }>;
  createPayment(i: {
    sessionId: string;
    downloadToken: string;
    templateId: string;
  }): Promise<{ paymentId: string; qrImageDataUrl: string; amountCentavos: number }>;
  getPaymentStatus(paymentId: string): Promise<PaymentStatus>;
  cancelPayment(paymentId: string): Promise<'cancelled' | 'paid'>;
  upsertSession(row: SessionSync): Promise<void>;
  /** Uploads `<sessionId>.jpg` and records it on the session; resolves to the storage path. */
  uploadPhoto(sessionId: string, jpeg: ArrayBuffer): Promise<string>;
  /** Ends this device's session only (local scope), e.g. to switch the kiosk to another account from Setup. */
  signOut(): Promise<void>;
}

/** Shown in Setup when a signed-in account has no `profiles.role = 'kiosk'` row (R21). */
export const NOT_KIOSK_ACCOUNT = 'This account is not a kiosk account.';
