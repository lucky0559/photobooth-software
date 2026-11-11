import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FRAME_TIMEOUT_MS, watchFirstFrame, watchMute } from '../src/renderer/src/camera/watchdog';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('watchFirstFrame', () => {
  it('fails once when no frame arrives within the timeout', () => {
    const video = { readyState: 0, videoWidth: 0 };
    const fail = vi.fn();
    watchFirstFrame(video, fail);
    vi.advanceTimersByTime(FRAME_TIMEOUT_MS - 1);
    expect(fail).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fail).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(FRAME_TIMEOUT_MS * 3);
    expect(fail).toHaveBeenCalledTimes(1);
  });

  it('fails when readyState is ready but there is no frame size', () => {
    const fail = vi.fn();
    watchFirstFrame({ readyState: 4, videoWidth: 0 }, fail);
    vi.advanceTimersByTime(FRAME_TIMEOUT_MS);
    expect(fail).toHaveBeenCalledTimes(1);
  });

  it('does not fail when the video becomes ready in time', () => {
    const video = { readyState: 0, videoWidth: 0 };
    const fail = vi.fn();
    watchFirstFrame(video, fail);
    video.readyState = 2;
    video.videoWidth = 640;
    vi.advanceTimersByTime(FRAME_TIMEOUT_MS);
    expect(fail).not.toHaveBeenCalled();
  });

  it('stop clears the timer', () => {
    const fail = vi.fn();
    const stop = watchFirstFrame({ readyState: 0, videoWidth: 0 }, fail);
    stop();
    vi.advanceTimersByTime(FRAME_TIMEOUT_MS * 2);
    expect(fail).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

function fakeTrack(muted = false): EventTarget & { muted: boolean } {
  return Object.assign(new EventTarget(), { muted });
}

describe('watchMute', () => {
  it('fails when the track stays muted for the timeout', () => {
    const track = fakeTrack();
    const fail = vi.fn();
    watchMute(track, fail);
    track.muted = true;
    track.dispatchEvent(new Event('mute'));
    vi.advanceTimersByTime(FRAME_TIMEOUT_MS);
    expect(fail).toHaveBeenCalledTimes(1);
  });

  it('does not fail when the track unmutes in time', () => {
    const track = fakeTrack();
    const fail = vi.fn();
    watchMute(track, fail);
    track.muted = true;
    track.dispatchEvent(new Event('mute'));
    vi.advanceTimersByTime(FRAME_TIMEOUT_MS - 1);
    track.muted = false;
    track.dispatchEvent(new Event('unmute'));
    vi.advanceTimersByTime(FRAME_TIMEOUT_MS);
    expect(fail).not.toHaveBeenCalled();
  });

  it('starts timing immediately when the track is already muted', () => {
    const fail = vi.fn();
    watchMute(fakeTrack(true), fail);
    vi.advanceTimersByTime(FRAME_TIMEOUT_MS);
    expect(fail).toHaveBeenCalledTimes(1);
  });

  it('stop clears the timer and ignores later mute events', () => {
    const track = fakeTrack(true);
    const fail = vi.fn();
    const stop = watchMute(track, fail);
    stop();
    track.dispatchEvent(new Event('mute'));
    vi.advanceTimersByTime(FRAME_TIMEOUT_MS * 2);
    expect(fail).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
