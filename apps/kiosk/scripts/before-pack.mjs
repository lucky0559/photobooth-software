// electron-builder `beforePack` hook: refuse to package unless `out/` is the complete production bundle with no
// test-only hooks. The `package`/`build:win` scripts already run `pnpm build` (which checks the same thing); this also
// covers a bare `electron-builder` call against a stale or missing `out/`.
import { assertPackageableBundle } from './check-prod-bundle.mjs';

export default async function beforePack() {
  assertPackageableBundle();
}
