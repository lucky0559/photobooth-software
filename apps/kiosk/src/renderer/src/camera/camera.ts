/** Opens the configured camera (or the default one when `deviceId` is null) at up to 1920×1080. */
export function openCamera(deviceId: string | null): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    },
  });
}

export function closeCamera(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

/** Grabs the current frame at full video resolution, not mirrored, as JPEG q0.95. */
export function captureFrame(video: HTMLVideoElement): Promise<Blob> {
  const { videoWidth: w, videoHeight: h } = video;
  if (!w || !h) return Promise.reject(new Error('Video has no frame yet'));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('2D canvas unavailable'));
  ctx.drawImage(video, 0, 0, w, h);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('JPEG encode failed'))), 'image/jpeg', 0.95);
  });
}

/** e2e only: simulates unplugging the camera shown in the preview. `stop()` alone does not fire `ended`. */
export function simulateCameraLoss(): void {
  const stream = document.querySelector('video')?.srcObject;
  if (!(stream instanceof MediaStream)) return;
  for (const track of stream.getVideoTracks()) {
    track.stop();
    track.dispatchEvent(new Event('ended'));
  }
}
