import {
  DEFAULT_SETTINGS,
  newDownloadToken,
  transition,
  type KioskEvent,
  type KioskSettings,
  type KioskState,
  type Template,
} from '@pb/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { shotStore } from '../camera/shot-store';
import { syncSettings, type SyncApi, type SyncBridge, type SyncResult } from './settings-sync';

const TICK_MS = 500;
const SYNC_MS = 60_000;

/** Any `KioskEvent`; for `START` the hook fills in `sessionId` and `now` itself. */
export type KioskInput = Exclude<KioskEvent, { type: 'START' }> | { type: 'START' };

export interface Kiosk {
  state: KioskState;
  settings: KioskSettings;
  dispatch(e: KioskInput): void;
  downloadToken: string | null;
  template: Template | null;
  /** `navigator.onLine` and the last settings fetch succeeded. */
  online: boolean;
  /** The first settings sync has finished. */
  ready: boolean;
}

export function useKiosk(api: SyncApi, bridge: SyncBridge = window.kiosk): Kiosk {
  const [state, setState] = useState<KioskState>({ name: 'attract' });
  const [sync, setSync] = useState<SyncResult | null>(null);
  const [downloadToken, setDownloadToken] = useState<string | null>(null);
  const [navOnline, setNavOnline] = useState(navigator.onLine);

  const settings = sync?.settings ?? DEFAULT_SETTINGS;
  const stateRef = useRef(state);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const dispatch = useCallback((input: KioskInput): void => {
    const prev = stateRef.current;
    const event: KioskEvent =
      input.type === 'START' ? { type: 'START', sessionId: crypto.randomUUID(), now: Date.now() } : input;
    const next = transition(prev, event, settingsRef.current);
    if (next === prev) return;
    stateRef.current = next;
    setState(next);
    if (event.type === 'START') {
      shotStore.clear();
      setDownloadToken(newDownloadToken());
    } else if (next.name === 'attract') {
      setDownloadToken(null);
    }
  }, []);

  useEffect(() => {
    const id = setInterval(() => dispatch({ type: 'TICK', now: Date.now() }), TICK_MS);
    return () => clearInterval(id);
  }, [dispatch]);

  useEffect(() => {
    const update = (): void => setNavOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  // Settings and template only refresh between sessions, so they never change mid-session.
  const isAttract = state.name === 'attract';
  useEffect(() => {
    if (!isAttract) return;
    let live = true;
    const run = (): void => {
      syncSettings(api, bridge).then(
        (r) => live && setSync(r),
        (err: unknown) => console.error('Settings sync failed', err),
      );
    };
    run();
    const id = setInterval(run, SYNC_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [isAttract, api, bridge]);

  return {
    state,
    settings,
    dispatch,
    downloadToken,
    template: sync?.template ?? null,
    online: navOnline && !(sync?.settingsFetchFailed ?? false),
    ready: sync !== null,
  };
}
