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

/**
 * Handler for `will-navigate`, `will-frame-navigate` and `will-redirect` on every webContents. Newer
 * Electron puts the URL on the event (`will-frame-navigate` only has it there); older events pass it as
 * the second argument. A navigation whose URL cannot be determined is blocked.
 */
export function createNavigationGuard(policy: NavigationPolicy): (event: { preventDefault(): void; url?: unknown }, url?: unknown) => void {
  return (event, url) => {
    const target = typeof event.url === 'string' ? event.url : url;
    if (typeof target !== 'string' || !isAllowedNavigation(target, policy)) event.preventDefault();
  };
}

/** Permission requests: only camera capture (`media` with only `video`). The microphone is never granted. */
export function isAllowedPermissionRequest(permission: string, mediaTypes: readonly string[] | undefined): boolean {
  return permission === 'media' && !!mediaTypes && mediaTypes.length > 0 && mediaTypes.every((t) => t === 'video');
}

/** Permission checks: only `media` for `video`. */
export function isAllowedPermissionCheck(permission: string, mediaType: string | undefined): boolean {
  return permission === 'media' && mediaType === 'video';
}
