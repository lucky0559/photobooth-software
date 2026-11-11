import type { FilterId, KioskSettings } from './types.ts';
import { sessionAmountCentavos } from './pricing.ts';

export { DEFAULT_SETTINGS } from './settings.ts';

export const PAYMENT_TIMEOUT_MS = 180_000;
export const REVIEW_TIMEOUT_MS = 60_000;
export const DELIVERY_TIMEOUT_MS = 45_000;

export type KioskState =
  | { name: 'attract' }
  | { name: 'payment'; sessionId: string; amountCentavos: number; startedAt: number }
  | { name: 'capture'; sessionId: string; amountCentavos: number; shots: string[]; error?: 'camera_unavailable' }
  | { name: 'review'; sessionId: string; amountCentavos: number; shots: string[]; filter: FilterId; enteredAt: number }
  | { name: 'output'; sessionId: string; amountCentavos: number; shots: string[]; filter: FilterId }
  | { name: 'delivery'; sessionId: string; printError: string | null; enteredAt: number };

export type KioskEvent =
  | { type: 'START'; sessionId: string; now: number }
  | { type: 'PAYMENT_PAID' }
  | { type: 'PAYMENT_CANCELLED' }
  | { type: 'SHOT_TAKEN'; shotId: string; now: number }
  | { type: 'CAMERA_ERROR' }
  | { type: 'CAMERA_RETRY' }
  | { type: 'FILTER_SELECTED'; filter: FilterId }
  | { type: 'CONFIRM'; now: number }
  | { type: 'OUTPUT_DONE'; printError: string | null; now: number }
  | { type: 'TICK'; now: number };

export function transition(state: KioskState, event: KioskEvent, settings: KioskSettings): KioskState {
  switch (state.name) {
    case 'attract':
      if (event.type === 'START') {
        const amountCentavos = sessionAmountCentavos(settings);
        return amountCentavos === 0
          ? { name: 'capture', sessionId: event.sessionId, amountCentavos, shots: [] }
          : { name: 'payment', sessionId: event.sessionId, amountCentavos, startedAt: event.now };
      }
      return state;
    case 'payment':
      if (event.type === 'PAYMENT_PAID') {
        return { name: 'capture', sessionId: state.sessionId, amountCentavos: state.amountCentavos, shots: [] };
      }
      if (event.type === 'PAYMENT_CANCELLED') return { name: 'attract' };
      if (event.type === 'TICK' && event.now - state.startedAt >= PAYMENT_TIMEOUT_MS) return { name: 'attract' };
      return state;
    case 'capture':
      if (event.type === 'SHOT_TAKEN') {
        const shots = [...state.shots, event.shotId];
        if (shots.length >= settings.shotsPerSession) {
          return {
            name: 'review',
            sessionId: state.sessionId,
            amountCentavos: state.amountCentavos,
            shots,
            filter: 'none',
            enteredAt: event.now,
          };
        }
        return { ...state, shots };
      }
      if (event.type === 'CAMERA_ERROR') return { ...state, error: 'camera_unavailable' };
      if (event.type === 'CAMERA_RETRY' && state.error) {
        const { error: _error, ...rest } = state;
        return rest;
      }
      return state;
    case 'review': {
      const toOutput = (): KioskState => ({
        name: 'output',
        sessionId: state.sessionId,
        amountCentavos: state.amountCentavos,
        shots: state.shots,
        filter: state.filter,
      });
      if (event.type === 'FILTER_SELECTED') return { ...state, filter: event.filter };
      if (event.type === 'CONFIRM') return toOutput();
      if (event.type === 'TICK' && event.now - state.enteredAt >= REVIEW_TIMEOUT_MS) return toOutput();
      return state;
    }
    case 'output':
      if (event.type === 'OUTPUT_DONE') {
        return { name: 'delivery', sessionId: state.sessionId, printError: event.printError, enteredAt: event.now };
      }
      return state;
    case 'delivery':
      if (event.type === 'TICK' && event.now - state.enteredAt >= DELIVERY_TIMEOUT_MS) return { name: 'attract' };
      return state;
  }
}
