const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { test, expect } = require('@playwright/test');

const ROOT = path.join(__dirname, '..', '..');
const attr = (name, files) => {
  const out = execFileSync('git', ['check-attr', name, '--', ...files], { cwd: ROOT, encoding: 'utf8' });
  return Object.fromEntries(out.trim().split('\n').map(l => { const [f, , v] = l.split(': '); return [f, v]; }));
};

/* 这台机器 core.autocrlf=true:没有 .gitattributes 时,切分支 / checkout 会把 61.html 检出成 CRLF,
 * 内容没变,但 SHA256 跟安装包、Replace ZIP 对不上,build-output / replace-zip-freshness 就挂了。
 * 统一按 LF 检出,跟机器上的 autocrlf 设置无关。 */
test('文本文件在任何机器上都按 LF 检出', () => {
  const files = ['61.html', 'replacement/61.html', 'HANDOFF.md', 'app/scripts/vj-shots.js', 'app/tests/line-endings.spec.js', 'scripts/verify-replacement.ps1'];
  const eol = attr('eol', files);
  for (const f of files) expect(eol[f], `${f} 的检出换行`).toBe('lf');
});

test('二进制文件不做换行转换', () => {
  const files = execFileSync('git', ['ls-files', '*.zip', '*.png', '*.ico', '*.woff2'], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n');
  expect(files.length, '仓库里应该有这几类二进制文件').toBeGreaterThan(3);
  const text = attr('text', files);
  for (const f of files) expect(text[f], `${f} 被当成了文本`).toBe('unset');
});

test('工作区的 61.html 和 replacement/61.html 是 LF(哈希才对得上安装包)', () => {
  for (const f of ['61.html', 'replacement/61.html']) {
    const buf = fs.readFileSync(path.join(ROOT, f));
    expect(buf.includes(Buffer.from('\r\n')), `${f} 里有 CRLF`).toBe(false);
  }
});
