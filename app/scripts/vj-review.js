#!/usr/bin/env node
'use strict';
/* 每批验收一条命令:改前/改后截图 → 对比网页 → (可选)验收测试。在 app/ 下跑:
   node scripts/vj-review.js [--kinds a,b] [--base HEAD] [--name 批次名] [--tiers low,balanced,ultra]
     [--crop 0.62,0.35] [--measure] [--tests] [--open]
   - 改前 = --base 这个提交里的 61.html,改后 = 工作区的 61.html。改前的版本用 git show 取出来,
     临时放在仓库根目录(fonts/ 等相对路径才对得上),跑完即删;不碰工作区的 61.html。
   - 不给 --kinds 时,取 tests/vj-anti-plastic.spec.js 里 CONVERTED 相对 --base 新增的隧道,也就是本批。
   - --tests 跑 HANDOFF 里每批的验收测试,结果写进对比网页。
   - 输出在 vj-shots/review-<批次名>/index.html(vj-shots/ 不进 git)。 */
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync, execFileSync } = require('child_process');
const { newlyConverted, renderReview, summarizeTests, BASE_PAGE } = require('./vj-review-lib');

const APP_DIR = path.join(__dirname, '..');
const ROOT = path.join(APP_DIR, '..');
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
const flag = name => process.argv.includes(`--${name}`);
const git = (args, encoding = 'utf8') => execFileSync('git', args, { cwd: ROOT, encoding, maxBuffer: 256 << 20 });

const ACCEPTANCE = ['vj-anti-plastic', 'vj-element-continuity', 'vj-five-depth', 'vj-tunnels', 'vj-loop-integrity',
  'bg3d-performance-budget', 'vj-material-presets', 'vj-bevel-box'].map(t => `tests/${t}.spec.js`);

const base = git(['rev-parse', '--short', arg('base', 'HEAD')]).trim();
const tiers = arg('tiers', 'low,balanced,ultra');
const crop = arg('crop', '0.62,0.35');
let kinds = (arg('kinds', '') || '').split(',').filter(Boolean);
if (!kinds.length) {
  const spec = 'app/tests/vj-anti-plastic.spec.js';
  kinds = newlyConverted(git(['show', `${base}:${spec}`]), fs.readFileSync(path.join(ROOT, spec), 'utf8'));
  if (!kinds.length) { console.error(`CONVERTED 相对 ${base} 没有新增,用 --kinds 指定要对比的隧道`); process.exit(2); }
  console.log(`本批(CONVERTED 相对 ${base} 新增):${kinds.join(', ')}`);
}
const name = arg('name', `${base}-${new Date().toISOString().slice(0, 10)}`);
const out = path.join(ROOT, 'vj-shots', `review-${name}`);
const index = path.join(out, 'index.html');

function electronCount() {
  if (process.platform !== 'win32') return 0;
  const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq electron.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
  return (r.stdout || '').split('\n').filter(l => l.includes('electron.exe')).length;
}

function shoot(dir, extra) {
  fs.rmSync(dir, { recursive: true, force: true });
  const r = spawnSync(process.execPath, [path.join(__dirname, 'vj-shots.js'), '--out', dir, '--kinds', kinds.join(','),
    '--tiers', tiers, '--crop', crop, ...(flag('measure') ? ['--measure'] : []), ...extra], { cwd: APP_DIR, stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`vj-shots 失败:${dir}`);
  return JSON.parse(fs.readFileSync(path.join(dir, 'metrics.json'), 'utf8'));
}

const n = electronCount();
if (n) console.warn(`注意:已有 ${n} 个 Electron 进程在跑。截图不受影响,但 --measure 的帧时间会偏高,--tests 可能超时。`);

fs.mkdirSync(out, { recursive: true });
const basePath = path.join(ROOT, BASE_PAGE);
let before;
fs.writeFileSync(basePath, git(['show', `${base}:61.html`], 'buffer'));
try { before = shoot(path.join(out, 'before'), ['--html', basePath]); }
finally { fs.rmSync(basePath, { force: true }); }
const after = shoot(path.join(out, 'after'), []);

const page = { base, date: new Date().toLocaleString('zh-CN'), tiers: tiers.split(','), kinds, before, after, tests: null };
fs.writeFileSync(index, renderReview(page));
console.log(`对比网页:${index}`);

if (flag('tests')) {
  const json = path.join(out, 'tests.json');
  fs.rmSync(json, { force: true });
  spawnSync(process.execPath, [path.join(APP_DIR, 'node_modules', '@playwright', 'test', 'cli.js'), 'test', ...ACCEPTANCE, '--reporter=list,json'],
    { cwd: APP_DIR, stdio: 'inherit', env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: json } });
  page.tests = fs.existsSync(json)
    ? summarizeTests(JSON.parse(fs.readFileSync(json, 'utf8')))
    : { passed: 0, failed: 1, flaky: 0, skipped: 0, failures: [{ title: 'Playwright 没有写出报告', error: '看终端输出' }] };
  fs.writeFileSync(index, renderReview(page));
  console.log(`验收测试:通过 ${page.tests.passed},失败 ${page.tests.failed}`);
}

if (flag('open') && process.platform === 'win32') spawn('cmd', ['/c', 'start', '', index], { detached: true, stdio: 'ignore' }).unref();
