'use client';

import { startTransition, useActionState, useRef, useState, type FormEvent } from 'react';
import type { LayoutId, Result, Template } from '@pb/core';
import { Spinner } from '@/components/spinner';
import { effectiveUploadLimit, formatMb } from '@/lib/upload-limit';
import { uploadTemplate } from './actions';
import { LAYOUT_LABELS } from './layouts';

const FILE_ERROR_KEYS = ['file', 'mime', 'size', 'bytes'] as const;
// What this deployment's host accepts (inlined at build time); the server still enforces the 10 MB maximum.
const UPLOAD_LIMIT = effectiveUploadLimit(process.env.NEXT_PUBLIC_TEMPLATE_UPLOAD_MAX_BYTES);
const LIMIT_TEXT = formatMb(UPLOAD_LIMIT);

export function UploadForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [name, setName] = useState('');
  const [layout, setLayout] = useState<LayoutId>('strip_2x6');
  const [state, formAction, pending] = useActionState<Result<Template> | null, FormData>(async (_prev, formData) => {
    // Answer before sending: a body over the host's limit never reaches the action (e.g. a platform 413).
    const file = formData.get('file');
    if (file instanceof File && file.size > UPLOAD_LIMIT) {
      return { ok: false, errors: { bytes: `Template must be ${LIMIT_TEXT} or smaller` } };
    }
    try {
      const result = await uploadTemplate(formData);
      if (result.ok) {
        // Clear the file picker and name only after a success; an error keeps what the user entered.
        formRef.current?.reset();
        setName('');
        setLayout('strip_2x6');
      }
      return result;
    } catch {
      // Rejected request (413 from the host, network drop, …): a fixed message instead of an error page.
      return {
        ok: false,
        errors: { _: `Upload failed. The file may be larger than this server accepts (limit ${LIMIT_TEXT}).` },
      };
    }
  }, null);

  // onSubmit instead of `<form action>`: React would reset the whole form (file, layout) after every attempt.
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => formAction(data));
  };

  const errors = state && !state.ok ? state.errors : {};
  const fileErrors = FILE_ERROR_KEYS.flatMap((k) => (errors[k] ? [{ key: k, text: errors[k] }] : []));
  const fileDescribedBy = ['file-hint', ...fileErrors.map((e) => `file-error-${e.key}`)].join(' ');

  return (
    <form ref={formRef} onSubmit={onSubmit} className="form" noValidate>
      {errors._ && (
        <p className="alert" role="alert">
          {errors._}
        </p>
      )}
      <div className="field">
        <label htmlFor="name">Name</label>
        <input
          id="name"
          name="name"
          type="text"
          maxLength={60}
          autoComplete="off"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? 'name-error' : undefined}
        />
        {errors.name && (
          <p id="name-error" className="error">
            {errors.name}
          </p>
        )}
      </div>
      <div className="field">
        <label htmlFor="layout">Layout</label>
        <select
          id="layout"
          name="layout"
          value={layout}
          onChange={(e) => setLayout(e.target.value as LayoutId)}
          aria-invalid={errors.layout ? true : undefined}
          aria-describedby={errors.layout ? 'layout-error' : undefined}
        >
          {(Object.keys(LAYOUT_LABELS) as LayoutId[]).map((id) => (
            <option key={id} value={id}>
              {LAYOUT_LABELS[id]}
            </option>
          ))}
        </select>
        {errors.layout && (
          <p id="layout-error" className="error">
            {errors.layout}
          </p>
        )}
      </div>
      <div className="field">
        <label htmlFor="file">PNG file</label>
        <input
          id="file"
          name="file"
          type="file"
          accept="image/png"
          aria-invalid={fileErrors.length > 0 ? true : undefined}
          aria-describedby={fileDescribedBy}
        />
        <p id="file-hint" className="hint">
          Strip: 600 × 1800 px. 4R: 1200 × 1800 px. PNG up to {LIMIT_TEXT}, transparent where the photos go.
        </p>
        {fileErrors.map((e) => (
          <p key={e.key} id={`file-error-${e.key}`} className="error">
            {e.text}
          </p>
        ))}
      </div>
      <div>
        <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>
          {pending && <Spinner />}
          {pending ? 'Uploading…' : 'Upload template'}
        </button>
      </div>
      {state?.ok && !pending && (
        <p className="notice" role="status">
          Uploaded {state.value.name}
        </p>
      )}
    </form>
  );
}
