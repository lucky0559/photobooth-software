import { describe, expect, it } from 'vitest';
import { NO_TEST_SWITCHES, testSwitches } from '../src/shared/test-switches';

const ALL = {
  PB_USER_DATA: '/tmp/pb-e2e',
  PB_FAKE_CAMERA: '1',
  PB_FAKE_CONFIG: '{"settings":{}}',
  PB_FAKE_PRINT: '1',
  PB_FAKE_PRINT_FAIL: 'Out of paper',
};

describe('testSwitches', () => {
  it('parses every switch when not packaged', () => {
    expect(testSwitches(ALL, false)).toEqual({
      userData: '/tmp/pb-e2e',
      fakeCamera: true,
      fakeConfig: '{"settings":{}}',
      fakePrint: true,
      fakePrintFail: 'Out of paper',
    });
  });

  it('ignores every switch in a packaged app (a leftover PB_FAKE_PRINT=1 must not fake printing)', () => {
    expect(testSwitches(ALL, true)).toEqual(NO_TEST_SWITCHES);
    expect(testSwitches({ PB_FAKE_PRINT: '1' }, true).fakePrint).toBe(false);
  });

  it('is all off with no env vars', () => {
    expect(testSwitches({}, false)).toEqual(NO_TEST_SWITCHES);
  });

  it('only treats exactly "1" as on and empty strings as unset', () => {
    expect(testSwitches({ PB_FAKE_CAMERA: 'true', PB_FAKE_PRINT: '0', PB_USER_DATA: '', PB_FAKE_CONFIG: '' }, false)).toEqual(
      NO_TEST_SWITCHES,
    );
  });

  it('ignores PB_FAKE_PRINT_FAIL unless PB_FAKE_PRINT=1', () => {
    expect(testSwitches({ PB_FAKE_PRINT_FAIL: 'jam' }, false).fakePrintFail).toBeNull();
  });
});
