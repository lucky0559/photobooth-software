import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV !== 'production';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabaseOrigin = supabaseUrl ? new URL(supabaseUrl).origin : '';

// Next injects inline bootstrap scripts, so script-src needs 'unsafe-inline' without a nonce setup;
// dev mode (React refresh) also needs 'unsafe-eval' and the HMR websocket.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${supabaseOrigin}`.trim(),
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseOrigin}${isDev ? ' ws:' : ''}`.trim(),
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const nextConfig: NextConfig = {
  // The e2e suite builds into its own folder so it never overwrites a running `pnpm dev` (both used `.next`).
  distDir: process.env.NEXT_DIST_DIR || '.next',
  poweredByHeader: false,
  // @pb/core ships raw TypeScript with explicit `.ts` relative imports.
  transpilePackages: ['@pb/core'],
  experimental: {
    // Template PNGs may be up to 10 MB; Next's defaults are 1 MB (actions) and 10 MB (middleware).
    serverActions: { bodySizeLimit: '11mb' },
    middlewareClientMaxBodySize: '11mb',
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          // HTTPS only on the deployed host (browsers ignore it over plain-http localhost).
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          // Neither the admin nor the download page needs any of these browser features.
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
          { key: 'Content-Security-Policy', value: csp },
        ],
      },
      {
        // Public download page: the token is in the URL and the page holds signed photo URLs, so never
        // send a Referer, never cache, never index. Listed after the global entry so it overrides it.
        source: '/d/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'no-store' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
    ];
  },
};

export default nextConfig;
