const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const appRoot = path.join(__dirname, '..');
const isWindows = process.platform === 'win32';
const npm = isWindows ? 'npm.cmd' : 'npm';
const npx = isWindows ? 'npx.cmd' : 'npx';

function run(label, command, args, options = {}) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(command, args, {
    cwd: appRoot,
    stdio: 'inherit',
    // Recent Windows Node builds can return EINVAL when a .cmd shim is spawned directly.
    // The command and every argument here are fixed by this file, so using cmd.exe for only
    // the npm/npx shims is both safe and compatible; Node scripts still launch directly.
    shell: isWindows && (command === npm || command === npx),
    env: { ...process.env, ...options.env }
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status}.`);
}

try {
  const testDir = path.join(appRoot, 'tests');
  const heavySpecs = new Set(['vj-tunnels.spec.js']);
  const regularSpecs = fs.readdirSync(testDir)
    .filter(name => name.endsWith('.spec.js') && !heavySpecs.has(name))
    .sort()
    .map(name => `tests/${name}`);

  run('1/8 Package metadata', npm, ['run', 'verify:version']);
  run('2/8 Replacement freshness', npm, ['run', 'verify:replacement']);
  run('3/8 Replace ZIP', npm, ['run', 'build:replace-zip']);
  run('4/8 Windows package', npm, ['run', 'dist']);
  // The VJ suite creates every WebGL scene and is deliberately isolated in a fresh Electron/
  // Playwright process. This avoids retaining GPU state from 170+ earlier tests without skipping
  // or weakening a single assertion. All other specs are discovered dynamically above.
  run('5/8 Playwright regression and packaged-app checks', npx,
    ['playwright', 'test', ...regularSpecs, '--workers=1']);
  run('6/8 Heavy VJ regression checks', npx,
    ['playwright', 'test', 'tests/vj-tunnels.spec.js', '--workers=1']);
  run('7/8 Release integrity manifest', process.execPath, ['scripts/release-integrity.js', 'generate']);
  run('8/8 Final artifact verification', process.execPath, ['scripts/release-integrity.js', 'verify']);
  console.log('\nRELEASE READY: every integrity gate passed.');
} catch (error) {
  console.error(`\nRELEASE BLOCKED: ${error.message}`);
  process.exitCode = 1;
}
