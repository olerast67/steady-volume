// Builds per-browser packages from src/:
//   build/chromium, build/firefox  (unpacked)   dist/steady-volume-<version>-<target>.zip
// node scripts/build.mjs [--lint]   --lint only builds the folders and lints the Firefox one with web-ext.
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import webExt from 'web-ext';

const root = fileURLToPath(new URL('..', import.meta.url));
const lintOnly = process.argv.includes('--lint');
const base = JSON.parse(readFileSync(join(root, 'src/manifest.json'), 'utf8'));

const targets = {
  // src/manifest.json is the Chromium manifest; Chromium ignores browser_specific_settings
  chromium: (m) => m,
  // Firefox: background as an event page, no tab capture (no tabCapture/offscreen APIs there)
  firefox: (m) => {
    m.background = { scripts: ['background.js'] };
    m.permissions = m.permissions.filter((p) => p !== 'tabCapture' && p !== 'offscreen');
    delete m.commands;
    return m;
  },
};
const dropFiles = { chromium: [], firefox: ['offscreen.html', 'offscreen.js'] };

for (const [name, transform] of Object.entries(targets)) {
  const dir = join(root, 'build', name);
  rmSync(dir, { recursive: true, force: true });
  cpSync(join(root, 'src'), dir, { recursive: true });
  for (const f of dropFiles[name]) rmSync(join(dir, f));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(transform(structuredClone(base)), null, 2) + '\n');
  if (lintOnly) continue;
  await webExt.cmd.build({
    sourceDir: dir,
    artifactsDir: join(root, 'dist'),
    filename: `steady-volume-${base.version}-${name}.zip`,
    overwriteDest: true,
  }, { shouldExitProgram: false });
  console.log(`dist/steady-volume-${base.version}-${name}.zip`);
}

if (lintOnly) {
  const result = await webExt.cmd.lint({
    sourceDir: join(root, 'build', 'firefox'),
    warningsAsErrors: true,
    output: 'text',
  }, { shouldExitProgram: false });
  if (result.errors.length || result.warnings.length) process.exit(1);
}
