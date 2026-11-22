import { requireAdmin } from '@/lib/auth';
import { SETTINGS_COLUMNS, settingsFromRow, type SettingsRow } from '@/lib/settings-row';
import { SettingsForm } from './settings-form';

export default async function SettingsPage() {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase
    .from('settings')
    .select(SETTINGS_COLUMNS)
    .eq('id', 1)
    .single<SettingsRow>();

  return (
    <>
      <h1>Settings</h1>
      {error || !data ? (
        <p className="alert" role="alert">
          Could not load settings. Please reload the page.
        </p>
      ) : (
        <div className="card">
          <SettingsForm initial={settingsFromRow(data)} />
        </div>
      )}
    </>
  );
}
