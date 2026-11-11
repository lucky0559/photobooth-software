/** Download page for a session: `<base>/d/<token>`, or null unless `base` is an absolute http(s) URL. */
export function downloadUrl(base: string | undefined, token: string): string | null {
  const trimmed = base?.trim() ?? '';
  if (!/^https?:\/\/[^/\s]+/i.test(trimmed)) return null;
  return `${trimmed.replace(/\/+$/, '')}/d/${token}`;
}
