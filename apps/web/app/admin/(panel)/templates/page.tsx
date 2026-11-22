import type { LayoutId } from '@pb/core';
import { requireAdmin } from '@/lib/auth';
import { TemplateItem } from './template-item';
import { UploadForm } from './upload-form';

const SIGNED_URL_SECONDS = 60 * 60;

type Row = { id: string; name: string; layout: LayoutId; overlay_path: string };

export default async function TemplatesPage() {
  const { supabase } = await requireAdmin();

  const [{ data: rows, error }, { data: settings }] = await Promise.all([
    supabase
      .from('templates')
      .select('id, name, layout, overlay_path')
      .eq('archived', false)
      .order('created_at', { ascending: false })
      .returns<Row[]>(),
    supabase.from('settings').select('active_template_id').eq('id', 1).single<{ active_template_id: string | null }>(),
  ]);

  // Private bucket: short-lived signed URLs, created with the admin's own session.
  const urls = new Map<string, string>();
  if (rows && rows.length > 0) {
    const { data: signed } = await supabase.storage
      .from('templates')
      .createSignedUrls(
        rows.map((r) => r.overlay_path),
        SIGNED_URL_SECONDS,
      );
    for (const s of signed ?? []) if (s.path && s.signedUrl && !s.error) urls.set(s.path, s.signedUrl);
  }
  const activeId = settings?.active_template_id ?? null;

  return (
    <>
      <h1>Templates</h1>

      <section className="card" aria-labelledby="upload-heading">
        <h2 id="upload-heading">Upload a template</h2>
        <UploadForm />
      </section>

      <section aria-labelledby="list-heading">
        <h2 id="list-heading">Your templates</h2>
        {error ? (
          <p className="alert" role="alert">
            Could not load templates. Please reload the page.
          </p>
        ) : !rows || rows.length === 0 ? (
          <p>No templates yet. Upload one above.</p>
        ) : (
          <ul className="template-list">
            {rows.map((r) => (
              <TemplateItem
                key={r.id}
                id={r.id}
                name={r.name}
                layout={r.layout}
                thumbUrl={urls.get(r.overlay_path) ?? null}
                active={r.id === activeId}
              />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
