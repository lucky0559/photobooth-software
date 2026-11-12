import { TEMPLATE_MAX_BYTES } from '@pb/core';

/**
 * Largest template upload this deployment accepts, from NEXT_PUBLIC_TEMPLATE_UPLOAD_MAX_BYTES (whole bytes).
 * Defaults to, and never exceeds, the 10 MB template maximum (the server always enforces that maximum itself).
 * Hosts with a smaller request-body limit (Vercel Hobby 4.5 MB) set it lower (docs/DEPLOY.md: 4404020).
 */
export function effectiveUploadLimit(raw: string | undefined): number {
  const n = raw && /^\d{1,12}$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? Math.min(n, TEMPLATE_MAX_BYTES) : TEMPLATE_MAX_BYTES;
}

/** Bytes as MB for messages, rounded down to one decimal so the stated limit is never too high: "10 MB", "4.4 MB". */
export function formatMb(bytes: number): string {
  const mb = Math.floor((bytes / (1024 * 1024)) * 10) / 10;
  return `${mb} MB`;
}
