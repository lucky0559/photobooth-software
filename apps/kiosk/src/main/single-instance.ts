/**
 * One kiosk per Windows user in a packaged app: a second launch (double-clicked shortcut, Startup folder plus a
 * manual start) must not run a second main process writing the same config.json/queue.json. Unpackaged dev and
 * e2e runs skip the lock so tests can start several instances with separate userData dirs.
 */
export function shouldTakeSingleInstanceLock(isPackaged: boolean): boolean {
  return isPackaged;
}

/** The parts of a BrowserWindow the second-instance handler uses. */
export interface FocusableWindow {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
}

/** Brings the existing kiosk window to the front when a second launch is attempted. Never throws on a missing window. */
export function focusExistingWindow(win: FocusableWindow | null): void {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
