const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { test, expect } = require('@playwright/test');

const ROOT = path.join(__dirname, '..', '..');
const SOURCE = path.join(ROOT, '61.html');
const REPLACEMENT = path.join(ROOT, 'replacement', '61.html');
const VERIFIER = path.join(ROOT, 'scripts', 'verify-replacement.ps1');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function verify(packageRoot) {
  return spawnSync('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', VERIFIER,
    '-PackageRoot', packageRoot
  ], { encoding: 'utf8' });
}

test('replacement/61.html 与根目录 source of truth 完全一致', () => {
  expect(fs.existsSync(REPLACEMENT)).toBe(true);
  expect(sha256(REPLACEMENT)).toBe(sha256(SOURCE));

  const result = verify(ROOT);
  expect(result.status, result.stderr || result.stdout).toBe(0);
  expect(result.stdout).toContain('PASS: replacement/61.html is fresh');
});

test('freshness verifier 会拒绝陈旧 replacement', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sub-remix-replacement-'));
  try {
    fs.mkdirSync(path.join(tempRoot, 'replacement'));
    fs.writeFileSync(path.join(tempRoot, '61.html'), 'current source');
    fs.writeFileSync(path.join(tempRoot, 'replacement', '61.html'), 'stale payload');

    const result = verify(tempRoot);
    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toContain('STALE REPLACEMENT');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('freshness verifier 接受内容相同的 replacement', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sub-remix-replacement-'));
  try {
    fs.mkdirSync(path.join(tempRoot, 'replacement'));
    fs.writeFileSync(path.join(tempRoot, '61.html'), 'same content');
    fs.copyFileSync(path.join(tempRoot, '61.html'), path.join(tempRoot, 'replacement', '61.html'));

    const result = verify(tempRoot);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain('PASS:');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
