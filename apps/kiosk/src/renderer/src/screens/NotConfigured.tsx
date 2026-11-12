/** Staff-facing full screen shown when the build is missing required configuration. Lists names, never values. */
export function NotConfigured({ missing, warnings }: { missing: string[]; warnings: string[] }) {
  return (
    <main className="screen setup" role="alert">
      <h1>This kiosk is not configured. Please call staff.</h1>
      <p className="staff-detail">Missing or invalid: {missing.join(', ')}</p>
      {warnings.length > 0 && <p className="staff-detail">Also not set (download QR disabled): {warnings.join(', ')}</p>}
    </main>
  );
}
