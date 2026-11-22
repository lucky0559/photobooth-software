import { useState, type FormEvent } from 'react';
import { pinErrorMessage } from './pin-message';

export function PinPrompt({ onUnlock, onCancel }: { onUnlock: (pin: string) => void; onCancel: () => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    void window.kiosk.checkPin(pin).then((result) => {
      const message = pinErrorMessage(result);
      if (message === null) onUnlock(pin);
      else {
        setPin('');
        setError(message);
      }
    });
  };

  return (
    <main className="screen setup">
      <h1>Enter admin PIN</h1>
      <form onSubmit={submit}>
        <label>
          PIN
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
        <button type="submit">Unlock</button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
