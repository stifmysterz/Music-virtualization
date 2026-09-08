const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { test, expect } = require('@playwright/test');

const APP_ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(APP_ROOT, 'scripts', 'release-integrity.js');
const pkg = require('../package.json');

function run(mode, root) {
  return spawnSync(process.execPath, [SCRIPT, mode, '--root', root], { encoding: 'utf8' });
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sub-remix-release-'));
  const write = (relative, content) => {
    const file = path.join(root, ...relative.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  const fixturePackage = {
    name: 'sub-remix', version: '1.1.4', build: { productName: 'SUB REMIX' }
  };
  write('app/package.json', JSON.stringify(fixturePackage));
  write('app/package-lock.json', JSON.stringify({
    name: 'sub-remix', version: '1.1.4', packages: { '': { name: 'sub-remix', version: '1.1.4' } }
  }));
  write('61.html', 'current visualizer');
  write('replacement/61.html', 'current visualizer');
  write('Music-Visualisation-Claude-Code-Replace.zip', 'zip artifact');
  write('dist/win-unpacked/resources/app/61.html', 'current visualizer');
  write('dist/win-unpacked/SUB REMIX.exe', 'unpacked executable');
  write('dist/SUB REMIX Setup 1.1.4.exe', 'installer artifact');
  return root;
}

test('package.json 暴露一键 release 与独立 verify:release 命令', () => {
  expect(pkg.scripts.release).toBe('node scripts/release.js');
  expect(pkg.scripts['release:manifest']).toBe('node scripts/release-integrity.js generate');
  expect(pkg.scripts['verify:release']).toBe('node scripts/release-integrity.js verify');
});

test('release manifest 记录并验证全部发布产物', () => {
  const root = fixture();
  try {
    const generated = run('generate', root);
    expect(generated.status, generated.stderr || generated.stdout).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'dist', 'release-integrity.json')));
    expect(manifest.app.version).toBe('1.1.4');
    expect(manifest.artifacts).toHaveLength(6);
    expect(manifest.artifacts.every(item => item.bytes > 0 && /^[a-f0-9]{64}$/.test(item.sha256))).toBe(true);

    const verified = run('verify', root);
    expect(verified.status, verified.stderr || verified.stdout).toBe(0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('发布产物在生成 manifest 后被改动会阻止发布', () => {
  const root = fixture();
  try {
    expect(run('generate', root).status).toBe(0);
    fs.appendFileSync(path.join(root, 'dist', 'SUB REMIX Setup 1.1.4.exe'), 'tampered');
    const verified = run('verify', root);
    expect(verified.status).not.toBe(0);
    expect(verified.stderr).toContain('RELEASE INTEGRITY FAILURE');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('打包资源中的 61.html 过期会阻止生成 release manifest', () => {
  const root = fixture();
  try {
    fs.writeFileSync(path.join(root, 'dist', 'win-unpacked', 'resources', 'app', '61.html'), 'stale build');
    const generated = run('generate', root);
    expect(generated.status).not.toBe(0);
    expect(generated.stderr).toContain('STALE BUILD');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

