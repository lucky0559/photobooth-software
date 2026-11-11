import { useState, type FormEvent } from 'react';

export function PinPrompt({ onUnlock, onCancel }: { onUnlock: () => void; onCancel: () => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    void window.kiosk.checkPin(pin).then((ok) => {
      if (ok) onUnlock();
      else {
        setPin('');
        setError('Wrong PIN');
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
