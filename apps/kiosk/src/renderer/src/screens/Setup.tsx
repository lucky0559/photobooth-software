import { useEffect, useState, type FormEvent } from 'react';
import { PIN_PATTERN } from '../../../shared/bridge';

/** Kiosk Supabase account sign-in. `null` (fake API) skips the step. */
export interface SetupAuth {
  isSignedIn(): Promise<boolean>;
  signIn(email: string, password: string): Promise<void>;
}

type Step = 'pin' | 'signin' | 'devices';

async function listCameras(): Promise<MediaDeviceInfo[]> {
  // Labels are only filled in after camera permission is granted.
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    for (const track of stream.getTracks()) track.stop();
  } catch {
    // No camera or permission denied: the list below will be empty or unlabeled.
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'videoinput');
}

export function Setup({
  auth,
  initialCameraId,
  onDone,
}: {
  auth: SetupAuth | null;
  initialCameraId: string | null;
  onDone: () => void;
}) {
  const [step, setStep] = useState<Step>('pin');
  const [pin, setPin] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState(initialCameraId ?? '');
  const [printers, setPrinters] = useState<string[]>([]);
  const [printerName, setPrinterName] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (step !== 'devices') return;
    let live = true;
    void Promise.all([window.kiosk.listPrinters(), window.kiosk.getConfig()]).then(([list, cfg]) => {
      if (!live) return;
      setPrinters(list);
      setPrinterName(cfg.printerName && list.includes(cfg.printerName) ? cfg.printerName : '');
    });
    void listCameras().then((list) => {
      if (!live) return;
      setCameras(list);
      setCameraId((id) => (list.some((c) => c.deviceId === id) ? id : (list[0]?.deviceId ?? '')));
    });
    return () => {
      live = false;
    };
  }, [step]);

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const submitPin = (e: FormEvent): void => {
    e.preventDefault();
    if (!PIN_PATTERN.test(pin)) {
      setError('PIN must be 4 to 8 digits');
      return;
    }
    void run(async () => {
      setStep(auth && !(await auth.isSignedIn()) ? 'signin' : 'devices');
    });
  };

  const submitSignIn = (e: FormEvent): void => {
    e.preventDefault();
    if (!auth) return;
    void run(async () => {
      await auth.signIn(email.trim(), password);
      setStep('devices');
    });
  };

  const finish = (e: FormEvent): void => {
    e.preventDefault();
    if (!cameraId) {
      setError('Pick a camera');
      return;
    }
    void run(async () => {
      await window.kiosk.setPin(pin);
      await window.kiosk.setConfig({ cameraDeviceId: cameraId, printerName: printerName || null });
      onDone();
    });
  };

  const testPrint = (): void => {
    setTestResult(null);
    void run(async () => {
      // `printTestPage` prints on the persisted printer, so save the selection first.
      await window.kiosk.setConfig({ printerName: printerName || null });
      const res = await window.kiosk.printTestPage();
      setTestResult(res.ok ? 'Test page sent' : `Test print failed: ${res.reason}`);
    });
  };

  return (
    <main className="screen setup">
      <h1>Kiosk setup</h1>

      {step === 'pin' && (
        <form onSubmit={submitPin}>
          <label>
            Admin PIN (4–8 digits)
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={8}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              autoFocus
            />
          </label>
          <button type="submit" disabled={busy}>
            Next
          </button>
        </form>
      )}

      {step === 'signin' && (
        <form onSubmit={submitSignIn}>
          <label>
            Kiosk account email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button type="submit" disabled={busy || !email || !password}>
            Sign in
          </button>
        </form>
      )}

      {step === 'devices' && (
        <form onSubmit={finish}>
          <label>
            Camera
            <select value={cameraId} onChange={(e) => setCameraId(e.target.value)}>
              {cameras.length === 0 && <option value="">No camera found</option>}
              {cameras.map((c, i) => (
                <option key={c.deviceId} value={c.deviceId}>
                  {c.label || `Camera ${i + 1}`}
                </option>
              ))}
            </select>
          </label>
          <label>
            Printer
            <select value={printerName} onChange={(e) => setPrinterName(e.target.value)}>
              <option value="">{printers.length === 0 ? 'No printers found' : 'System default'}</option>
              {printers.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={testPrint} disabled={busy}>
            Print test page
          </button>
          {testResult && <p role="status">{testResult}</p>}
          <button type="submit" disabled={busy}>
            Done
          </button>
        </form>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
