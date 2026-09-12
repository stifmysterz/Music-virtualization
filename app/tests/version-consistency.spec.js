const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { test, expect } = require('@playwright/test');

const APP_ROOT = path.join(__dirname, '..');
const VERIFIER = path.join(APP_ROOT, 'scripts', 'verify-version.js');
const PACKAGE_PATH = path.join(APP_ROOT, 'package.json');
const LOCK_PATH = path.join(APP_ROOT, 'package-lock.json');

function verify(packagePath, lockPath) {
  return spawnSync(process.execPath, [
    VERIFIER, '--package', packagePath, '--lock', lockPath
  ], { encoding: 'utf8' });
}

test('package.json 和 package-lock 根版本统一为 1.1.5', () => {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf8'));
  const lock = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));

  expect(pkg.version).toBe('1.1.5');
  expect(lock.version).toBe(pkg.version);
  expect(lock.packages[''].version).toBe(pkg.version);
  expect(lock.name).toBe(pkg.name);
  expect(lock.packages[''].name).toBe(pkg.name);

  const result = verify(PACKAGE_PATH, LOCK_PATH);
  expect(result.status, result.stderr || result.stdout).toBe(0);
  expect(result.stdout).toContain('sub-remix@1.1.5');
});

test('版本检查会拒绝 package-lock metadata drift', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sub-remix-version-'));
  try {
    const packagePath = path.join(tempRoot, 'package.json');
    const lockPath = path.join(tempRoot, 'package-lock.json');
    fs.writeFileSync(packagePath, JSON.stringify({ name: 'sub-remix', version: '1.1.4' }));
    fs.writeFileSync(lockPath, JSON.stringify({
      name: 'sub-remix', version: '1.0.0', packages: { '': { name: 'sub-remix', version: '1.0.0' } }
    }));

    const result = verify(packagePath, lockPath);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('VERSION DRIFT');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
