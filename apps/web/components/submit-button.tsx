'use client';

import type { ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { Spinner } from './spinner';

/** Submit button for a `<form action={serverAction}>`: disables itself and shows a spinner while the action runs. */
export function SubmitButton({
  children,
  pendingText,
  className = 'btn btn-primary',
}: {
  children: ReactNode;
  pendingText: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending}>
      {pending && <Spinner />}
      {pending ? pendingText : children}
    </button>
  );
}
