const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { test, expect } = require('@playwright/test');

const APP_DIR = path.join(__dirname, '..');
const ROOT = path.join(APP_DIR, '..');
const SOURCE = path.join(ROOT, 'src', 'audio', 'music-state.js');
const TARGET = path.join(ROOT, '61.html');
const SYNC = path.join(APP_DIR, 'scripts', 'sync-music-state.js');

function verify(root = ROOT) {
  return spawnSync(process.execPath, [SYNC, '--root', root], { encoding: 'utf8' });
}

test('Music State Bus 源模块与 standalone 61.html 保持同步', () => {
  expect(fs.existsSync(SOURCE)).toBe(true);
  const result = verify();
  expect(result.status, result.stderr || result.stdout).toBe(0);
  expect(result.stdout).toContain('synchronized');
});

test('同步校验会拒绝被手动改坏的 Music State 区块', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sub-remix-music-state-'));
  try {
    fs.mkdirSync(path.join(tempRoot, 'src', 'audio'), { recursive: true });
    fs.copyFileSync(SOURCE, path.join(tempRoot, 'src', 'audio', 'music-state.js'));
    fs.writeFileSync(path.join(tempRoot, '61.html'), fs.readFileSync(TARGET, 'utf8').replace('phrasePhase', 'brokenPhase'));
    const result = verify(tempRoot);
    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toContain('61.html is stale');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
