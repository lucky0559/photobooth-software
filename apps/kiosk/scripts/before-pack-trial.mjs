// electron-builder beforePack hook for the trial installer: refuses a missing/incomplete `out-trial/` or one
// containing test-only hooks, source maps or baked-in Supabase env values.
import { fileURLToPath } from 'node:url';
import { assertPackageableBundle } from './check-prod-bundle.mjs';

export default function beforePack() {
  assertPackageableBundle(fileURLToPath(new URL('../out-trial', import.meta.url)), { trial: true });
}
