import type { KioskSettings, KioskState } from '@pb/core';
import { useEffect, useRef, useState } from 'react';
import { captureFrame, closeCamera, openCamera } from '../camera/camera';
import { shotStore } from '../camera/shot-store';
import { watchFirstFrame, watchMute } from '../camera/watchdog';
import type { KioskInput } from '../state/useKiosk';

const FLASH_MS = 150;
const PAUSE_MS = 1500;

type CaptureState = Extract<KioskState, { name: 'capture' }>;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function Capture({
  state,
  settings,
  cameraId,
  dispatch,
}: {
  state: CaptureState;
  settings: KioskSettings;
  cameraId: string | null;
  dispatch: (e: KioskInput) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [live, setLive] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [flash, setFlash] = useState(false);
  const takenRef = useRef(state.shots.length);
  takenRef.current = state.shots.length;
  const failed = state.error !== undefined;
  const total = settings.shotsPerSession;

  // Camera: open on mount and after Try again; getUserMedia rejecting or the track ending -> CAMERA_ERROR.
  useEffect(() => {
    if (failed) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let stopFrameWatch: (() => void) | undefined;
    let stopMuteWatch: (() => void) | undefined;
    const fail = (): void => {
      if (!cancelled) dispatch({ type: 'CAMERA_ERROR' });
    };
    openCamera(cameraId)
      .then(async (s) => {
        if (cancelled) return closeCamera(s);
        stream = s;
        const track = s.getVideoTracks()[0];
        const video = videoRef.current;
        if (!track || track.readyState === 'ended' || !video) return fail();
        // A camera that opens but never delivers frames (no-signal capture card, busy webcam) must not
        // trap the guest: the frame watchdog covers a play() that never resolves, the mute watch covers later stalls.
        stopFrameWatch = watchFirstFrame(video, fail);
        stopMuteWatch = watchMute(track, fail);
        track.addEventListener('ended', fail);
        video.srcObject = s;
        await video.play();
        if (cancelled) return;
        stopFrameWatch();
        setLive(true);
      })
      .catch(fail);
    return () => {
      cancelled = true;
      stopFrameWatch?.();
      stopMuteWatch?.();
      setLive(false);
      if (stream) closeCamera(stream);
    };
  }, [failed, cameraId, dispatch]);

  // Shot loop: countdown, capture, flash, SHOT_TAKEN, pause. Resumes from the current count after a retry.
  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    void (async () => {
      let taken = takenRef.current;
      while (taken < total) {
        for (let n = settings.countdownSeconds; n > 0; n--) {
          setCount(n);
          await wait(1000);
          if (cancelled) return;
        }
        setCount(null);
        const video = videoRef.current;
        const track = (video?.srcObject as MediaStream | null)?.getVideoTracks()[0];
        if (!video || track?.readyState !== 'live') {
          if (!cancelled) dispatch({ type: 'CAMERA_ERROR' });
          return;
        }
        let blob: Blob;
        try {
          blob = await captureFrame(video);
        } catch {
          if (!cancelled) dispatch({ type: 'CAMERA_ERROR' });
          return;
        }
        // Camera failed or the screen unmounted during encode: drop the frame.
        if (cancelled) return;
        const shotId = shotStore.put(blob);
        setFlash(true);
        await wait(FLASH_MS);
        setFlash(false);
        dispatch({ type: 'SHOT_TAKEN', shotId, now: Date.now() });
        taken += 1;
        if (cancelled) return;
        if (taken < total) {
          await wait(PAUSE_MS);
          if (cancelled) return;
        }
      }
    })();
    return () => {
      cancelled = true;
      setCount(null);
      setFlash(false);
    };
  }, [live, total, settings.countdownSeconds, dispatch]);

  if (failed) {
    return (
      <main className="screen capture-error">
        <h1>Camera not available. Please call staff.</h1>
        <button type="button" className="primary" onClick={() => dispatch({ type: 'CAMERA_RETRY' })}>
          Try again
        </button>
      </main>
    );
  }

  return (
    <main className="capture">
      <video ref={videoRef} className="preview" autoPlay muted playsInline />
      <p className="shot-label">
        Shot {Math.min(state.shots.length + 1, total)} of {total}
      </p>
      {count !== null && <div className="countdown">{count}</div>}
      {flash && <div className="flash" />}
    </main>
  );
}
