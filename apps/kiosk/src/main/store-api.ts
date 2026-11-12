import { toConfigView, type ConfigView, type LocalConfig } from '../shared/bridge';
import type { QueueJob } from '../shared/queue';
import { validateConfigPatch } from './config-validation';
import type { JsonStore } from './json-store';
import { addJobs, applyResult, validateQueueJobs, validateQueueResult, type QueueFile } from './queue-store';

/**
 * The config and queue IPC handlers, minus Electron. While `queue.json` is unreadable the queue store is
 * write-blocked; `getConfig` and `queueList` (polled by the renderer every 10 s) retry it, so the kiosk
 * returns to service on its own once the file is readable again.
 */
export function createStoreApi(config: JsonStore<LocalConfig>, queue: JsonStore<QueueFile>, photosDir: string) {
  // The renderer never receives the PIN hash; it only learns whether a PIN is set, plus live store health.
  const view = (c: LocalConfig): ConfigView =>
    toConfigView(c, { settingsUnreadable: config.writeBlocked, queueUnavailable: queue.writeBlocked });
  return {
    getConfig(): ConfigView {
      queue.recheck();
      return view(config.get());
    },
    setConfig(patch: unknown): ConfigView {
      const valid = validateConfigPatch(patch);
      return view(config.update((c) => ({ ...c, ...valid })));
    },
    queueAdd(jobs: unknown): void {
      const valid = validateQueueJobs(jobs, photosDir);
      queue.update((q) => addJobs(q, valid));
    },
    queueList(): QueueJob[] {
      queue.recheck();
      return queue.get().jobs;
    },
    queueApply(result: unknown): void {
      const valid = validateQueueResult(result);
      queue.update((q) => applyResult(q, valid, Date.now()));
    },
  };
}
