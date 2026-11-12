import { randomBytes } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const ADMIN = { email: 'admin@local.test', password: 'localpass123' };
export const KIOSK = { email: 'kiosk@local.test', password: 'localpass123' };
export const SEED_TEMPLATE_ID = '00000000-0000-0000-0000-0000000057a1';

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * Minimal RGBA PNG encoder. The first `noiseRows` rows are random pixels (incompressible, to make
 * a large file); the rest are fully transparent.
 */
export function makePng(width: number, height: number, noiseRows = 0): Buffer {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height); // filter byte 0 + transparent pixels
  for (let y = 0; y < Math.min(noiseRows, height); y++) randomBytes(width * 4).copy(raw, y * stride + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Bytes that start like a JPEG (SOI + APP0 JFIF header); enough to fail a PNG magic-number check. */
export function makeFakeJpeg(): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]),
    randomBytes(4096),
    Buffer.from([0xff, 0xd9]),
  ]);
}

/** Writes fixtures to a fresh temp dir (no binaries in git). */
export function writeFixtures() {
  const dir = mkdtempSync(join(tmpdir(), 'pb-web-e2e-'));
  const files = {
    // ~2 MB: also proves the server action body limit is above Next's 1 MB default.
    strip: join(dir, 'strip-600x1800.png'),
    wide: join(dir, 'wide-1200x1800.png'),
    fakeJpeg: join(dir, 'photo.png'),
  };
  writeFileSync(files.strip, makePng(600, 1800, 900));
  writeFileSync(files.wide, makePng(1200, 1800));
  writeFileSync(files.fakeJpeg, makeFakeJpeg());
  return files;
}

/** Service-role client for the LOCAL stack, used only to snapshot and restore seeded data. */
export function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (apps/web/.env.local)');
  const host = new URL(url).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') throw new Error('e2e cleanup refuses to run against a non-local Supabase');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

export async function signInAsAdmin(page: Page) {
  await signIn(page, ADMIN);
  await expect(page).toHaveURL(/\/admin$/);
}
