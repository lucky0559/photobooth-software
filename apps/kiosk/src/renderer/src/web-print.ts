import type { PrintResult } from '../../shared/bridge';

export type WebPrintStatus = 'idle' | 'preparing' | 'ready' | 'printing';

export interface WebPrintSnapshot {
  status: WebPrintStatus;
  message: string | null;
}

export interface WebPrintUi {
  print(jpeg: ArrayBuffer): Promise<PrintResult>;
  snapshot(): WebPrintSnapshot;
  subscribe(listener: (snapshot: WebPrintSnapshot) => void): () => void;
  printNow(): void;
  cancel(): void;
}

interface PendingPrint {
  resolve(result: PrintResult): void;
  timeout: number | null;
  afterPrint(): void;
}

const PRINT_TIMEOUT_MS = 90_000;

export class WebPrintController implements WebPrintUi {
  private current: WebPrintSnapshot = { status: 'idle', message: null };
  private readonly listeners = new Set<(snapshot: WebPrintSnapshot) => void>();
  private pending: PendingPrint | null = null;
  private generation = 0;

  constructor(private readonly layer: HTMLElement, private readonly target: Window = window) {}

  snapshot(): WebPrintSnapshot {
    return this.current;
  }

  subscribe(listener: (snapshot: WebPrintSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }

  private set(next: WebPrintSnapshot): void {
    this.current = next;
    for (const listener of this.listeners) listener(next);
  }

  async print(jpeg: ArrayBuffer): Promise<PrintResult> {
    if (this.current.status !== 'idle') return { ok: false, reason: 'A print is already in progress' };
    const generation = ++this.generation;
    this.set({ status: 'preparing', message: 'Preparing the 4×6 print sheet…' });

    let url: string | null = null;
    try {
      url = URL.createObjectURL(new Blob([jpeg], { type: 'image/jpeg' }));
      const image = new Image();
      image.alt = '';
      image.src = url;
      await image.decode();
      if (generation !== this.generation) {
        URL.revokeObjectURL(url);
        return { ok: false, reason: 'Print preparation was cancelled' };
      }
      if (image.naturalWidth !== 1200 || image.naturalHeight !== 1800) {
        throw new Error('Print sheet must be 1200×1800 pixels');
      }
      this.layer.replaceChildren(image);
    } catch (error) {
      if (url) URL.revokeObjectURL(url);
      const reason = error instanceof Error ? error.message : String(error);
      if (generation === this.generation) this.set({ status: 'idle', message: reason });
      return { ok: false, reason };
    }

    return new Promise<PrintResult>((resolve) => {
      const finish = (result: PrintResult): void => {
        const pending = this.pending;
        if (!pending) return;
        this.pending = null;
        if (pending.timeout !== null) this.target.clearTimeout(pending.timeout);
        this.target.removeEventListener('afterprint', pending.afterPrint);
        this.layer.replaceChildren();
        if (url) URL.revokeObjectURL(url);
        this.set({ status: 'idle', message: result.ok ? null : result.reason });
        resolve(result);
      };
      const pending: PendingPrint = {
        resolve: finish,
        timeout: null,
        afterPrint: () => {
          if (this.current.status === 'printing') finish({ ok: true });
        },
      };
      this.pending = pending;
      this.target.addEventListener('afterprint', pending.afterPrint);
      this.set({ status: 'ready', message: 'Your print sheet is ready. Choose AirPrint and 4×6 paper.' });
    });
  }

  printNow(): void {
    const pending = this.pending;
    if (!pending || this.current.status !== 'ready') return;
    this.set({ status: 'printing', message: 'Choose the Canon SELPHY and 4×6 paper in the print sheet.' });
    pending.timeout = this.target.setTimeout(() => pending.resolve({ ok: true }), PRINT_TIMEOUT_MS);
    try {
      // This must stay synchronous in the user's tap handler for Safari to open AirPrint.
      this.target.print();
    } catch (error) {
      pending.resolve({
        ok: false,
        reason: error instanceof Error ? error.message : 'Safari could not open the print sheet',
      });
    }
  }

  cancel(): void {
    this.generation += 1;
    if (this.pending) {
      this.pending.resolve({ ok: false, reason: 'Print cancelled because the trial ended' });
      return;
    }
    this.layer.replaceChildren();
    if (this.current.status !== 'idle') this.set({ status: 'idle', message: null });
  }
}
