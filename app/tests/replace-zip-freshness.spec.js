const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { test, expect } = require('@playwright/test');

const ROOT = path.join(__dirname, '..', '..');
const GENERATOR = path.join(ROOT, 'scripts', 'generate-replace.ps1');
const VERIFIER = path.join(ROOT, 'scripts', 'verify-replace-zip.ps1');
const OFFICIAL_ZIP = path.join(ROOT, 'Music-Visualisation-Claude-Code-Replace.zip');

function run(script, args) {
  return spawnSync('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args
  ], { encoding: 'utf8' });
}

test('正式 Replace ZIP 包含当前根目录 61.html', () => {
  const result = run(VERIFIER, ['-PackageRoot', ROOT, '-ArchivePath', OFFICIAL_ZIP]);
  expect(result.status, result.stderr || result.stdout).toBe(0);
  expect(result.stdout).toContain('PASS: Replace ZIP contains the current root 61.html');
});

test('生成器从根目录 source of truth 构建并验证 ZIP', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sub-remix-zip-test-'));
  const output = path.join(tempRoot, 'generated.zip');
  try {
    const result = run(GENERATOR, ['-PackageRoot', ROOT, '-OutputPath', output]);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(fs.existsSync(output)).toBe(true);

    const verified = run(VERIFIER, ['-PackageRoot', ROOT, '-ArchivePath', output]);
    expect(verified.status, verified.stderr || verified.stdout).toBe(0);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('根目录源码变化后，旧 ZIP 会被判定为 stale', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sub-remix-zip-stale-'));
  const output = path.join(tempRoot, 'generated.zip');
  try {
    const generated = run(GENERATOR, ['-PackageRoot', ROOT, '-OutputPath', output]);
    expect(generated.status, generated.stderr || generated.stdout).toBe(0);

    const mockRoot = path.join(tempRoot, 'changed-source');
    fs.mkdirSync(mockRoot);
    fs.writeFileSync(path.join(mockRoot, '61.html'), 'newer root source');
    const stale = run(VERIFIER, ['-PackageRoot', mockRoot, '-ArchivePath', output]);
    expect(stale.status).not.toBe(0);
    expect(stale.stderr + stale.stdout).toContain('STALE REPLACE ZIP');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('解压后的 Replace Pack 可凭 SHA 清单通过安装前检查', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sub-remix-zip-install-'));
  const unpacked = path.join(tempRoot, 'unpacked');
  const target = path.join(tempRoot, 'target');
  try {
    fs.mkdirSync(unpacked);
    fs.mkdirSync(target);
    const quote = value => `'${value.replaceAll("'", "''")}'`;
    const extracted = spawnSync('powershell', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
      `Expand-Archive -LiteralPath ${quote(OFFICIAL_ZIP)} -DestinationPath ${quote(unpacked)}`
    ], { encoding: 'utf8' });
    expect(extracted.status, extracted.stderr || extracted.stdout).toBe(0);
    expect(fs.existsSync(path.join(unpacked, '61.html'))).toBe(false);

    const installer = path.join(unpacked, 'scripts', 'install-replace.ps1');
    const checked = run(installer, ['-Target', target, '-WhatIf']);
    expect(checked.status, checked.stderr || checked.stdout).toBe(0);
    expect(checked.stdout).toContain('PASS: replacement/61.html is fresh');
    expect(checked.stdout).toContain('What if:');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
