'use client';

import { useActionState } from 'react';
import type { LayoutId, Result } from '@pb/core';
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
        <form className="actions" aria-describedby={error ? errorId : undefined}>
          {!active && (
            <button type="submit" className="btn" disabled={pending} formAction={() => run('activate')}>
              Set active
            </button>
          )}
          <button type="submit" className="btn" disabled={pending} formAction={() => run('archive')}>
            Archive
          </button>
        </form>
        {error && (
          <p id={errorId} className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </li>
  );
}
