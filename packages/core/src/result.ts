export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; errors: Record<string, string> };
