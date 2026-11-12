/** Test-only launch switches (e2e). In a packaged app every one of them is ignored. */
export interface TestSwitches {
  /** `PB_USER_DATA`: userData directory override. */
  userData: string | null;
  /** `PB_FAKE_CAMERA=1`: Chromium fake camera + auto-granted media prompt. */
  fakeCamera: boolean;
  /** `PB_FAKE_CONFIG`: initial FakeKioskApi config JSON, exposed by the preload. */
  fakeConfig: string | null;
  /** `PB_FAKE_PRINT=1`: never touch a real printer; count calls instead. */
  fakePrint: boolean;
  /** `PB_FAKE_PRINT_FAIL=<reason>`: fake prints fail with this reason (needs `fakePrint`). */
  fakePrintFail: string | null;
}

export const NO_TEST_SWITCHES: TestSwitches = Object.freeze({
  userData: null,
  fakeCamera: false,
  fakeConfig: null,
  fakePrint: false,
  fakePrintFail: null,
});

/** Command-line flag the main process passes to the preload only when the app is NOT packaged. */
export const UNPACKAGED_ARG = '--pb-unpackaged';

/** Parses the test switches from `env`; returns all-off when `isPackaged`. */
export function testSwitches(env: Record<string, string | undefined>, isPackaged: boolean): TestSwitches {
  if (isPackaged) return NO_TEST_SWITCHES;
  const str = (v: string | undefined): string | null => (v ? v : null);
  const fakePrint = env.PB_FAKE_PRINT === '1';
  return {
    userData: str(env.PB_USER_DATA),
    fakeCamera: env.PB_FAKE_CAMERA === '1',
    fakeConfig: str(env.PB_FAKE_CONFIG),
    fakePrint,
    fakePrintFail: fakePrint ? str(env.PB_FAKE_PRINT_FAIL) : null,
  };
}
