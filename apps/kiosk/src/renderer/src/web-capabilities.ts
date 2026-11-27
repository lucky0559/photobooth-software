export async function checkWebCapabilities(): Promise<string[]> {
  const errors: string[] = [];
  if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    errors.push('Open this test app from an HTTPS address so Safari can use the camera and save it for offline use.');
  }
  if (!navigator.mediaDevices?.getUserMedia) errors.push('This browser does not support camera access. Update iPadOS and open the app in Safari.');
  if (typeof indexedDB === 'undefined') errors.push('Browser storage is unavailable. Enable Safari site data and reload.');
  if (!crypto?.subtle) errors.push('Secure browser storage is unavailable. Open the app from its HTTPS address.');
  if (typeof createImageBitmap !== 'function') errors.push('This iPadOS version cannot prepare print images. Update and reload.');
  try {
    const canvas = new OffscreenCanvas(2, 2);
    if (!canvas.getContext('2d') || typeof canvas.convertToBlob !== 'function') {
      errors.push('This iPadOS version cannot compose print sheets. Update to iPadOS 16.4 or newer.');
    } else {
      const jpeg = await canvas.convertToBlob({ type: 'image/jpeg' });
      if (jpeg.type !== 'image/jpeg' || jpeg.size === 0) {
        errors.push('This iPadOS version cannot create JPEG print sheets. Update and reload.');
      }
    }
  } catch {
    errors.push('This iPadOS version cannot compose print sheets. Update to iPadOS 16.4 or newer.');
  }
  return [...new Set(errors)];
}
