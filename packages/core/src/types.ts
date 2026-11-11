export type LayoutId = 'strip_2x6' | 'print_4r';
export type ShotCount = 1 | 2 | 3 | 4;
export type FilterId = 'none' | 'bw' | 'warm';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface KioskSettings {
  priceCentavos: number;
  freeMode: boolean;
  shotsPerSession: ShotCount;
  countdownSeconds: 3 | 5 | 10;
  copiesPerSession: 1 | 2 | 3 | 4;
  linkExpiryDays: number;
  activeTemplateId: string | null;
}

export interface Template {
  id: string;
  name: string;
  layout: LayoutId;
  overlayPath: string;
}

export interface SessionSync {
  id: string;
  downloadToken: string;
  templateId: string;
  amountCentavos: number;
  status: 'free' | 'completed';
  printError: string | null;
  createdAt: string;
  completedAt: string | null;
}
