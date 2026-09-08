const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const { test, expect } = require('@playwright/test');

const APP_DIR = path.join(__dirname, '..');
const ROOT = path.join(APP_DIR, '..');
const SOURCE = path.join(ROOT, 'src', 'vj', 'loop-contract.js');
const TARGET = path.join(ROOT, '61.html');
const SYNC = path.join(APP_DIR, 'scripts', 'sync-vj-loop-contract.js');
const verify = (root = ROOT) => spawnSync(process.execPath, [SYNC, '--root', root], { encoding: 'utf8' });

function loadFactory() {
  const source = fs.readFileSync(SOURCE, 'utf8');
  const declarations = 'const VJ_TUNNEL_KINDS=[]; const VJ_PREMIUM_META={}; const VJ_LEN=0;';
  const sandbox = {};
  vm.runInNewContext(`${declarations}\n${source}\nglobalThis.factory=createVjLoopMeta;`, sandbox);
  return sandbox.factory;
}

test('VJ 循环契约工厂区分 Premium 与普通隧道并冻结结果', () => {
  const meta = loadFactory()(['premium', 'standard'], { premium: { loopBeats: 32 } }, 120);
  expect(JSON.parse(JSON.stringify(meta))).toEqual({
    premium: { loopBeats: 32, wrapDistance: 120, seamlessStrategy: 'deterministic-depth-wrap', deterministicRecycle: true, qualityTier: 'premium' },
    standard: { loopBeats: 16, wrapDistance: 120, seamlessStrategy: 'deterministic-depth-wrap', deterministicRecycle: true, qualityTier: 'standard' }
  });
  expect(Object.isFrozen(meta)).toBe(true);
  expect(Object.isFrozen(meta.premium)).toBe(true);
});

test('VJ 循环契约源模块与 standalone 同步，漂移时校验失败', () => {
  const current = verify();
  expect(current.status, current.stderr || current.stdout).toBe(0);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sub-remix-vj-contract-'));
  try {
    fs.mkdirSync(path.join(tempRoot, 'src', 'vj'), { recursive: true });
    fs.copyFileSync(SOURCE, path.join(tempRoot, 'src', 'vj', 'loop-contract.js'));
    fs.writeFileSync(path.join(tempRoot, '61.html'), fs.readFileSync(TARGET, 'utf8').replace('deterministic-depth-wrap', 'broken-wrap'));
    const stale = verify(tempRoot);
    expect(stale.status).not.toBe(0);
    expect(stale.stderr + stale.stdout).toContain('61.html is stale');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
