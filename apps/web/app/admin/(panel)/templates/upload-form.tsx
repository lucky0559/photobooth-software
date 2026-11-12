'use client';

import { useActionState, useState } from 'react';
import { TEMPLATE_MAX_BYTES, type LayoutId, type Result, type Template } from '@pb/core';
import { uploadTemplate } from './actions';
import { LAYOUT_LABELS } from './layouts';

const FILE_ERROR_KEYS = ['file', 'mime', 'size', 'bytes'] as const;

export function UploadForm() {
  const [name, setName] = useState('');
  const [layout, setLayout] = useState<LayoutId>('strip_2x6');
  const [state, formAction, pending] = useActionState<Result<Template> | null, FormData>(async (_prev, formData) => {
    // Early, friendlier answer for an oversized file (the server checks again and Next caps the body).
    const file = formData.get('file');
    if (file instanceof File && file.size > TEMPLATE_MAX_BYTES) {
      return { ok: false, errors: { bytes: 'Template must be 10 MB or smaller' } };
    }
    const result = await uploadTemplate(formData);
    if (result.ok) setName('');
    return result;
  }, null);

  const errors = state && !state.ok ? state.errors : {};
  const fileErrors = FILE_ERROR_KEYS.flatMap((k) => (errors[k] ? [{ key: k, text: errors[k] }] : []));
  const fileDescribedBy = ['file-hint', ...fileErrors.map((e) => `file-error-${e.key}`)].join(' ');

  return (
    <form action={formAction} className="form" noValidate>
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
          Strip: 600 × 1800 px. 4R: 1200 × 1800 px. PNG up to 10 MB, transparent where the photos go.
        </p>
        {fileErrors.map((e) => (
          <p key={e.key} id={`file-error-${e.key}`} className="error">
            {e.text}
          </p>
        ))}
      </div>
      <div>
        <button type="submit" className="btn btn-primary" disabled={pending}>
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
