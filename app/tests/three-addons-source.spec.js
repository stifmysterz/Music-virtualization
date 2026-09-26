const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

const APP_DIR = path.join(__dirname, '..');
const ROOT = path.join(APP_DIR, '..');
const SOURCE = path.join(ROOT, 'src', 'three', 'addons-r149.js');
const TARGET = path.join(ROOT, '61.html');
const SYNC = path.join(APP_DIR, 'scripts', 'sync-three-addons.js');
const VENDOR = path.join(APP_DIR, 'scripts', 'vendor-three-r149-addons.js');
const verify = (root = ROOT, ...extra) => spawnSync(process.execPath, [SYNC, '--root', root, ...extra], { encoding: 'utf8' });
const lf = s => s.replace(/\r\n/g, '\n');

test('vendored 文件能由脚本从 three@0.149.0 原样复现(不带参数)', () => {
  test.setTimeout(180_000);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sub-remix-vendor-'));
  try {
    const pack = spawnSync('npm', ['pack', 'three@0.149.0', '--prefer-offline', '--silent', '--pack-destination', `"${tmp}"`],
      { shell: true, encoding: 'utf8', timeout: 120_000 });
    test.skip(pack.status !== 0, `拿不到 three@0.149.0(离线且 npm 缓存里没有):${pack.stderr}`);
    const untar = spawnSync('tar', ['-xzf', 'three-0.149.0.tgz'], { cwd: tmp, encoding: 'utf8' });
    expect(untar.status, untar.stderr).toBe(0);
    // 脚本按自己的位置写 ../../src/three/ —— 复制到临时目录里跑,绝不覆盖仓库里的文件
    fs.mkdirSync(path.join(tmp, 'app', 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'src', 'three'), { recursive: true });
    fs.copyFileSync(VENDOR, path.join(tmp, 'app', 'scripts', 'vendor.js'));
    const r = spawnSync(process.execPath, [path.join(tmp, 'app', 'scripts', 'vendor.js'), path.join(tmp, 'package')], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(fs.readFileSync(path.join(tmp, 'src', 'three', 'addons-r149.js'), 'utf8') === lf(fs.readFileSync(SOURCE, 'utf8')),
      '仓库里的 addons-r149.js 和脚本默认输出不一致:要么被手改过,要么脚本默认参数变了').toBe(true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('r149 附加件源文件与 standalone 同步,漂移时校验失败', () => {
  const current = verify();
  expect(current.status, current.stderr || current.stdout).toBe(0);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sub-remix-three-addons-'));
  try {
    fs.mkdirSync(path.join(tempRoot, 'src', 'three'), { recursive: true });
    fs.copyFileSync(SOURCE, path.join(tempRoot, 'src', 'three', 'addons-r149.js'));
    fs.writeFileSync(path.join(tempRoot, '61.html'),
      fs.readFileSync(TARGET, 'utf8').replace('this.needsSwap = true;', 'this.needsSwap = false;'));
    const stale = verify(tempRoot);
    expect(stale.status).not.toBe(0);
    expect(stale.stderr + stale.stdout).toContain('61.html is stale');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('源文件那边改了也算漂移;--write 只重写生成块、块外一个字节不动;标记缺失时报错', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sub-remix-three-addons-'));
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(tempRoot, rel)), { recursive: true }); fs.writeFileSync(path.join(tempRoot, rel), text); };
  try {
    const src = fs.readFileSync(SOURCE, 'utf8'), html = fs.readFileSync(TARGET, 'utf8');
    // 1. 有人改了 vendored 源文件却没同步
    put('src/three/addons-r149.js', src.replace('SMAA_THRESHOLD', 'SMAA_THRESHOLD_X'));
    put('61.html', html);
    const srcDrift = verify(tempRoot);
    expect(srcDrift.status).not.toBe(0);
    expect(srcDrift.stderr + srcDrift.stdout).toContain('61.html is stale');

    // 2. 生成块被手改 → --write 修回来:块和仓库一致,块外原样
    put('src/three/addons-r149.js', src);
    const START = '/* THREE_R149_ADDONS:START */', END = '/* THREE_R149_ADDONS:END */';
    const s = html.indexOf(START), e = html.indexOf(END) + END.length;
    put('61.html', html.slice(0, s) + html.slice(s, e).replace('this.needsSwap = true;', 'this.needsSwap = false;') + html.slice(e));
    const w = verify(tempRoot, '--write');
    expect(w.status, w.stderr).toBe(0);
    const fixed = fs.readFileSync(path.join(tempRoot, '61.html'), 'utf8');
    expect(fixed.slice(0, s) === html.slice(0, s), '生成块之前的内容被改了').toBe(true);
    expect(fixed.slice(fixed.indexOf(END) + END.length) === html.slice(e), '生成块之后的内容被改了').toBe(true);
    expect(lf(fixed.slice(s, fixed.indexOf(END) + END.length)) === lf(html.slice(s, e)), '写回的生成块和仓库里的不一样').toBe(true);
    expect(verify(tempRoot).status).toBe(0);

    // 3. 标记被删 → 明确报错,不能当成「已同步」
    put('61.html', html.replace(START, '/* removed */'));
    const noMarker = verify(tempRoot);
    expect(noMarker.status).not.toBe(0);
    expect(noMarker.stderr + noMarker.stdout).toContain('markers are missing');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('移植代码在应用里可用:圆角面数正确,SMAA 接在合成链中间能出图', async () => {
  const dir = newUserDataDir('three-addons');
  let app, win;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], cwd: APP_DIR });
    win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    const r = await win.evaluate(async () => {
      document.getElementById('intro')?.classList.add('hidden');
      const A = THREE_R149_ADDONS;
      // RoundedBoxGeometry 是非索引几何(内部 toNonIndexed)
      const tris = s => { const g = new A.RoundedBoxGeometry(1.5, 1.5, 3.2, s, 0.22); return (g.index ? g.index.count : g.attributes.position.count) / 3; };
      await A.smaaReady;
      enableBg3D('vjChromeFlow');
      const s = bg3DScenes.vjChromeFlow, size = bg3DRenderer.getDrawingBufferSize(new THREE.Vector2());
      const p = new A.SMAAPass(size.x, size.y);
      s.composer.insertPass(p, s.composer.passes.findIndex(q => q.__bg3dAlpha));
      for (let i = 0; i < 3; i++) renderBg3D(0.5, 0.4, 0.3, 1);
      const gl = bg3DRenderer.getContext();
      return { keys: Object.keys(A).sort(), tris1: tris(1), tris2: tris(2), glErr: gl.getError(),
               needsSwap: p.needsSwap, imagesDecoded: A.smaaImages.area.complete && A.smaaImages.search.complete };
    });
    expect(r.keys).toEqual(['RoundedBoxGeometry', 'SMAAPass', 'smaaImages', 'smaaReady']);
    expect(r.tris1).toBe(108);
    expect(r.tris2).toBe(300);
    expect(r.glErr).toBe(0);
    expect(r.needsSwap, 'SMAA 后面还有 alpha pass,必须交换缓冲').toBe(true);
    expect(r.imagesDecoded).toBe(true);
  } finally {
    await closeApp(app, win);
    try { cleanupUserDataDir(dir); } catch (_e) {}
  }
});
