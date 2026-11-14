'use client';

import { startTransition, useActionState, useState, type FormEvent, type ReactNode } from 'react';
import type { KioskSettings, Result } from '@pb/core';
import { Spinner } from '@/components/spinner';
import { centavosToPesoInput } from '@/lib/settings-row';
import { saveSettings } from './actions';

type FormValues = {
  price: string;
  freeMode: boolean;
  shotsPerSession: string;
  countdownSeconds: string;
  copiesPerSession: string;
  linkExpiryDays: string;
};

function toValues(s: KioskSettings): FormValues {
  return {
    price: centavosToPesoInput(s.priceCentavos),
    freeMode: s.freeMode,
    shotsPerSession: String(s.shotsPerSession),
    countdownSeconds: String(s.countdownSeconds),
    copiesPerSession: String(s.copiesPerSession),
    linkExpiryDays: String(s.linkExpiryDays),
  };
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: (describedBy: string | undefined) => ReactNode;
}) {
  const ids = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(ids)}
      {hint && (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="error">
          {error}
        </p>
      )}
    </div>
  );
}

export function SettingsForm({ initial }: { initial: KioskSettings }) {
  const [values, setValues] = useState<FormValues>(() => toValues(initial));
  const [state, formAction, pending] = useActionState<Result<KioskSettings> | null, FormData>(
    async (_prev, formData) => {
      const result = await saveSettings(formData);
      if (result.ok) setValues(toValues(result.value)); // show the saved price re-formatted
      return result;
    },
    null,
  );
  const errors = state && !state.ok ? state.errors : {};
  // Submit through onSubmit, not `<form action>`: React resets a form after its action finishes, which put back the
  // old values of every field whose saved value equalled what the user had chosen (so it never re-rendered).
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => formAction(data));
  };
  const set = (key: keyof FormValues) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));
  const select = (id: keyof FormValues, label: string, options: number[], errorKey: string) => (
    <Field id={id} label={label} error={errors[errorKey]}>
      {(describedBy) => (
        <select
          id={id}
          name={id}
          value={values[id] as string}
          onChange={set(id)}
          aria-invalid={errors[errorKey] ? true : undefined}
          aria-describedby={describedBy}
        >
          {options.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      )}
    </Field>
  );

  return (
    <form onSubmit={onSubmit} className="form" noValidate>
      {errors._ && (
        <p className="alert" role="alert">
          {errors._}
        </p>
      )}

      <Field id="price" label="Price per session (₱)" hint="In pesos, e.g. 150 or 150.00" error={errors.priceCentavos}>
        {(describedBy) => (
          <input
            id="price"
            name="price"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            maxLength={20}
            value={values.price}
            onChange={set('price')}
            aria-invalid={errors.priceCentavos ? true : undefined}
            aria-describedby={describedBy}
          />
        )}
      </Field>

      <div className="field">
        <label className="check" htmlFor="freeMode">
          <input
            id="freeMode"
            name="freeMode"
            type="checkbox"
            checked={values.freeMode}
            onChange={(e) => setValues((v) => ({ ...v, freeMode: e.target.checked }))}
            aria-describedby={errors.freeMode ? 'freeMode-hint freeMode-error' : 'freeMode-hint'}
          />
          Free mode
        </label>
        <p id="freeMode-hint" className="hint">
          Guests skip payment while this is on.
        </p>
        {errors.freeMode && (
          <p id="freeMode-error" className="error">
            {errors.freeMode}
          </p>
        )}
      </div>

      <div className="row-2">
        {select('shotsPerSession', 'Shots per session', [1, 2, 3, 4], 'shotsPerSession')}
        {select('countdownSeconds', 'Countdown (seconds)', [3, 5, 10], 'countdownSeconds')}
      </div>
      <div className="row-2">
        {select('copiesPerSession', 'Printed copies', [1, 2, 3, 4], 'copiesPerSession')}
        <Field id="linkExpiryDays" label="Download link expiry (days)" hint="1 to 30 days" error={errors.linkExpiryDays}>
          {(describedBy) => (
            <input
              id="linkExpiryDays"
              name="linkExpiryDays"
              type="number"
              inputMode="numeric"
              min={1}
              max={30}
              step={1}
              value={values.linkExpiryDays}
              onChange={set('linkExpiryDays')}
              aria-invalid={errors.linkExpiryDays ? true : undefined}
              aria-describedby={describedBy}
            />
          )}
        </Field>
      </div>

      <div>
        <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>
          {pending && <Spinner />}
          {pending ? 'Saving…' : 'Save settings'}
        </button>
      </div>
      {state?.ok && !pending && (
        <p className="notice" role="status">
          Settings saved
        </p>
      )}
    </form>
  );
}
