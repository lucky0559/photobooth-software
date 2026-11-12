export interface NavigationPolicy {
  packaged: boolean;
  /** electron-vite dev server URL (`ELECTRON_RENDERER_URL`); only honored when not packaged. */
  devUrl: string | undefined;
  /** `file://` URL of the app's own `renderer/index.html`. */
  indexFileUrl: string;
}

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * The renderer is untrusted: it may only ever show the app's own page. Allows the app's `index.html`
 * (any hash/query) and, in development only, the dev server origin.
 */
export function isAllowedNavigation(url: string, policy: NavigationPolicy): boolean {
  const target = parse(url);
  if (!target) return false;
  if (!policy.packaged && policy.devUrl) {
    const dev = parse(policy.devUrl);
    if (dev && (dev.protocol === 'http:' || dev.protocol === 'https:') && target.origin === dev.origin) return true;
  }
  const index = parse(policy.indexFileUrl);
  return !!index && target.protocol === 'file:' && index.protocol === 'file:' && target.host === index.host && target.pathname === index.pathname;
}

/** Only the camera (`media`) is ever granted to web content. */
export function isAllowedPermission(permission: string): boolean {
  return permission === 'media';
}
