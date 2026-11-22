// Classifies database errors from template writes so actions can show a fixed message. Raw database
// text never reaches the page. The messages below are raised by the triggers in
// supabase/migrations/20261111000004_template_integrity.sql.

export const DB_ARCHIVE_ACTIVE = 'active template cannot be archived';
export const DB_ACTIVE_ARCHIVED = 'active template must not be archived';
const FOREIGN_KEY_VIOLATION = '23503';

export type TemplateWriteFailure = 'archiveActive' | 'archivedOrMissing' | 'other';

export function classifyTemplateWriteError(error: { code?: string; message?: string } | null | undefined): TemplateWriteFailure {
  if (!error) return 'other';
  if (error.message === DB_ARCHIVE_ACTIVE) return 'archiveActive';
  if (error.message === DB_ACTIVE_ARCHIVED || error.code === FOREIGN_KEY_VIOLATION) return 'archivedOrMissing';
  return 'other';
}
