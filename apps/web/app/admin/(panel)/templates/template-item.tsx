'use client';

import { useActionState, useState } from 'react';
import type { LayoutId, Result } from '@pb/core';
import { Spinner } from '@/components/spinner';
import { archiveTemplate, setActiveTemplate } from './actions';
import { LAYOUT_LABELS } from './layouts';

export function TemplateItem({
  id,
  name,
  layout,
  thumbUrl,
  active,
}: {
  id: string;
  name: string;
  layout: LayoutId;
  thumbUrl: string | null;
  active: boolean;
}) {
  const [state, run, pending] = useActionState<Result<true> | null, 'activate' | 'archive'>(
    (_prev, op) => (op === 'activate' ? setActiveTemplate(id) : archiveTemplate(id)),
    null,
  );
  const [op, setOp] = useState<'activate' | 'archive' | null>(null); // which button was pressed, for its spinner
  const error = state && !state.ok ? Object.values(state.errors)[0] : null;
  const errorId = `template-${id}-error`;

  return (
    <li className="template">
      {thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL; next/image would proxy and cache it
        <img className="thumb" src={thumbUrl} alt={`${name} overlay preview`} width={96} height={144} />
      ) : (
        <div className="thumb thumb-missing">No preview</div>
      )}
      <div>
        <p className="template-name">
          <span>{name}</span>
          {active && <span className="badge">Active</span>}
        </p>
        <p className="template-meta">{LAYOUT_LABELS[layout]}</p>
        {active ? (
          <p className="hint">Kiosks print with this one. To archive it, set another template active first.</p>
        ) : (
          <form className="actions" aria-describedby={error ? errorId : undefined}>
            <button
              type="submit"
              className="btn"
              disabled={pending}
              aria-busy={pending && op === 'activate'}
              formAction={() => {
                setOp('activate');
                run('activate');
              }}
            >
              {pending && op === 'activate' && <Spinner />}
              {pending && op === 'activate' ? 'Setting active…' : 'Set active'}
            </button>
            {/* The server also refuses to archive the active template (a stale page may still show this button). */}
            <button
              type="submit"
              className="btn"
              disabled={pending}
              aria-busy={pending && op === 'archive'}
              formAction={() => {
                setOp('archive');
                run('archive');
              }}
            >
              {pending && op === 'archive' && <Spinner />}
              {pending && op === 'archive' ? 'Archiving…' : 'Archive'}
            </button>
          </form>
        )}
        {error && (
          <p id={errorId} className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </li>
  );
}
