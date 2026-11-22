/** `true` only in the e2e build (`VITE_FAKE_API=1`); replaced at build time by electron.vite.config.ts. */
declare const __PB_TEST_BUILD__: boolean;
/** `true` only in the trial build (`VITE_TRIAL=1`); main process only. Compiled out of the real and e2e bundles. */
declare const __PB_TRIAL_BUILD__: boolean;
