const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const { test, expect } = require('@playwright/test');

const APP_DIR = path.join(__dirname, '..');
const ROOT = path.join(APP_DIR, '..');
const SOURCE = path.join(ROOT, 'src', 'three', 'scene-cache.js');
const TARGET = path.join(ROOT, '61.html');
const SYNC = path.join(APP_DIR, 'scripts', 'sync-scene-cache.js');

function verify(root = ROOT) {
  return spawnSync(process.execPath, [SYNC, '--root', root], { encoding: 'utf8' });
}

function loadFactory() {
  const sandbox = {};
  vm.runInNewContext(`${fs.readFileSync(SOURCE, 'utf8')}\nglobalThis.factory=createSceneCacheIndex;`, sandbox);
  return sandbox.factory;
}

test('共享 3D/VJ LRU 保留活跃场景并优先淘汰最旧场景', () => {
  const cache = loadFactory()(3);
  cache.touch('old'); cache.touch('active'); cache.touch('recent'); cache.touch('newest');
  expect(cache.evictionCandidates(['old', 'active', 'recent', 'newest'], 'active')).toEqual(['old']);
  cache.forget('old');
  expect(Object.prototype.hasOwnProperty.call(cache.lastUsed, 'old')).toBe(false);
});

test('场景缓存源模块与 standalone 同步，漂移时发布校验失败', () => {
  const current = verify();
  expect(current.status, current.stderr || current.stdout).toBe(0);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sub-remix-scene-cache-'));
  try {
    fs.mkdirSync(path.join(tempRoot, 'src', 'three'), { recursive: true });
    fs.copyFileSync(SOURCE, path.join(tempRoot, 'src', 'three', 'scene-cache.js'));
    fs.writeFileSync(path.join(tempRoot, '61.html'), fs.readFileSync(TARGET, 'utf8').replace('createSceneCacheIndex(8)', 'createSceneCacheIndex(99)'));
    const stale = verify(tempRoot);
    expect(stale.status).not.toBe(0);
    expect(stale.stderr + stale.stdout).toContain('61.html is stale');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
