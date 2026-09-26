'use strict';
/* vj-review.js 的纯函数部分(不启动 Electron,单测在 tests/vj-review-tool.spec.js)。 */

function parseConverted(src) {
  const m = /const CONVERTED\s*=\s*\[([\s\S]*?)\]/.exec(src);
  if (!m) throw new Error('vj-anti-plastic.spec.js 里找不到 const CONVERTED = [...]');
  return [...m[1].matchAll(/['"](\w+)['"]/g)].map(x => x[1]);
}

// 本批 = 工作区的已改造清单里,基线版本还没有的
function newlyConverted(baseSrc, curSrc) {
  const before = new Set(parseConverted(baseSrc));
  return parseConverted(curSrc).filter(k => !before.has(k));
}

// 与 vj-anti-plastic.spec.js 的三档判据一致
function judge(m) {
  const fails = [];
  if (!(m.lit > 0.4 && m.lit < 0.9)) fails.push('lit');
  if (!(m.vivid > 0.5)) fails.push('vivid');
  if (!(m.hues > 5)) fails.push('hues');
  return { ok: !fails.length, fails };
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pct = v => (v * 100).toFixed(1) + '%';
const FAIL_TEXT = { lit: '亮度不在 40%~90%', vivid: '饱和 ≤ 50%', hues: '色相 ≤ 5' };
const BASE_PAGE = '.vj-review-base.html';

function metricCells(b, a) {
  const failsOn = (r, key) => judge(r).fails.includes(key);
  const row = (name, key, fmt) =>
    `<tr><th>${name}</th><td class="${b && failsOn(b, key) ? 'bad' : ''}">${b ? fmt(b[key]) : '—'}</td><td class="${failsOn(a, key) ? 'bad' : ''}">${fmt(a[key])}</td></tr>`;
  let t = row('lit', 'lit', pct) + row('vivid', 'vivid', pct) + row('hues', 'hues', v => v);
  if (a.frameMs != null || (b && b.frameMs != null)) {
    t += `<tr><th>帧时间</th><td>${b && b.frameMs != null ? b.frameMs + ' ms' : '—'}</td><td>${a.frameMs != null ? a.frameMs + ' ms' : '—'}</td></tr>`;
  }
  return `<table class="m"><tr><th></th><th>改前</th><th>改后</th></tr>${t}</table>`;
}

function renderReview({ base, date, tiers, kinds, before, after, tests }) {
  const find = (list, tier, kind) => list.find(r => r.tier === tier && r.kind === kind);
  const wrongPage = before.some(r => r.page && r.page !== BASE_PAGE) || after.some(r => r.page && r.page === BASE_PAGE);

  const summary = kinds.map(kind => `<tr><th><a href="#${esc(kind)}">${esc(kind)}</a></th>${tiers.map(tier => {
    const a = find(after, tier, kind);
    if (!a) return '<td class="bad">没截到</td>';
    const v = judge(a), b = find(before, tier, kind);
    const was = b && !judge(b).ok ? ` <span class="muted">(改前 ✗)</span>` : '';
    return `<td class="${v.ok ? 'ok' : 'bad'}">${v.ok ? '✓' : '✗ ' + v.fails.map(f => FAIL_TEXT[f]).join(',')}${was}</td>`;
  }).join('')}</tr>`).join('');

  const sections = kinds.map(kind => `<section id="${esc(kind)}"><h2>${esc(kind)}</h2>${tiers.map(tier => {
    const a = find(after, tier, kind), b = find(before, tier, kind);
    if (!a) return `<div class="tier"><h3>${tier}</h3><p class="bad">改后没截到</p></div>`;
    const f = `${tier}-${esc(kind)}`;
    const verdict = judge(a).ok ? 'pass' : 'fail';
    const flip = b
      ? `<div class="flip" title="按住看改前"><img class="after" src="after/${f}.png" alt=""><img class="before" src="before/${f}.png" alt=""><span class="tag a">改后 · 按住看改前</span><span class="tag b">改前 · 松开回到改后</span></div>`
      : `<div class="flip"><img class="after" src="after/${f}.png" alt=""><span class="tag">改后 · 改前没有这条</span></div>`;
    const crops = `<div class="crops">${b ? `<figure><img src="before/${f}-crop.png" alt=""><figcaption>改前 · 局部 3×</figcaption></figure>` : ''}<figure><img src="after/${f}-crop.png" alt=""><figcaption>改后 · 局部 3×</figcaption></figure></div>`;
    return `<div class="tier" data-verdict="${verdict}"><h3>${tier} <span class="${verdict === 'pass' ? 'ok' : 'bad'}">${verdict === 'pass' ? '✓' : '✗'}</span></h3>${flip}<div class="side">${metricCells(b, a)}${crops}</div></div>`;
  }).join('')}</section>`).join('');

  const testBlock = !tests
    ? '<p class="muted">没有跑验收测试(加 --tests)。</p>'
    : `<p class="${tests.failed ? 'bad' : 'ok'}">通过 ${tests.passed} · 失败 ${tests.failed} · 不稳定 ${tests.flaky} · 跳过 ${tests.skipped}</p>` +
      (tests.failures.length ? `<ul class="fails">${tests.failures.map(x => `<li><b>${esc(x.title)}</b><pre>${esc(x.error)}</pre></li>`).join('')}</ul>` : '');

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VJ 批次对比</title>
<style>
:root{--bg:#0b0c0f;--panel:#15171c;--line:#262a33;--text:#e6e8ec;--muted:#8b92a0;--ok:#4cd98a;--bad:#ff6b6b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 "Microsoft YaHei","PingFang SC",system-ui,sans-serif}
header,section,.tests{max-width:1500px;margin:0 auto;padding:16px}
h1{font-size:20px;margin:8px 0}h2{font-size:17px;margin:24px 0 8px;border-top:1px solid var(--line);padding-top:16px}h3{font-size:14px;margin:0 0 6px}
.muted{color:var(--muted)}.ok{color:var(--ok)}.bad{color:var(--bad)}
.warn{background:#3a1212;border:1px solid var(--bad);color:#ffd0d0;padding:10px 14px;border-radius:6px}
table.sum{border-collapse:collapse;margin-top:8px}table.sum th,table.sum td{border:1px solid var(--line);padding:4px 10px;text-align:left}
a{color:#8fc7ff}
.tier{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:12px;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px;margin:10px 0}
.tier h3{grid-column:1/-1}
.flip{position:relative;cursor:pointer;user-select:none;align-self:start}.flip img{display:block;width:100%;border-radius:4px}
.flip .before{position:absolute;inset:0;opacity:0}.flip:active .before,body.all-before .flip .before{opacity:1}
.flip .tag{position:absolute;left:8px;top:8px;background:#000a;padding:2px 8px;border-radius:4px;font-size:12px}
.flip .tag.b,.flip:active .tag.a,body.all-before .flip .tag.a{display:none}.flip:active .tag.b,body.all-before .flip .tag.b{display:inline;background:#5a1d1dcc}
table.m{border-collapse:collapse;margin-bottom:10px}table.m th,table.m td{padding:2px 12px 2px 0;text-align:left}table.m td.bad{font-weight:bold}
.crops{display:grid;grid-template-columns:1fr 1fr;gap:8px}.crops img{width:100%;image-rendering:pixelated;border-radius:4px}
figure{margin:0}figcaption{color:var(--muted);font-size:12px}
.fails pre{white-space:pre-wrap;color:var(--muted);margin:4px 0 10px}
@media (max-width:900px){.tier{grid-template-columns:1fr}}
</style></head><body>
<header>
<h1>VJ 批次对比</h1>
<p class="muted">改前 = <code>${esc(base)}</code> 里的 61.html · 改后 = 工作区 · ${esc(date)} · 固定种子、固定音频输入、第 42 帧。在图上按住看改前,按住 B 键所有图一起切到改前。</p>
${wrongPage ? '<p class="warn">页面文件不对:改前的截图不是从基线版本拍的(或改后拍到了基线),这份对比不能用。</p>' : ''}
<table class="sum"><tr><th>隧道</th>${tiers.map(t => `<th>${t}</th>`).join('')}</tr>${summary}</table>
</header>
<div class="tests"><h2>验收测试</h2>${testBlock}</div>
${sections}
<script>
addEventListener('keydown',e=>{if(e.key==='b'||e.key==='B')document.body.classList.add('all-before')});
addEventListener('keyup',e=>{if(e.key==='b'||e.key==='B')document.body.classList.remove('all-before')});
</script>
</body></html>
`;
}

// Playwright JSON 报告 → 对比网页上的「验收测试」一栏
function summarizeTests(report) {
  const failures = [];
  const walk = (suite, trail) => {
    const here = suite.title ? [...trail, suite.title] : trail;
    for (const spec of suite.specs || []) {
      for (const t of spec.tests || []) {
        if (t.status !== 'unexpected') continue;
        const last = (t.results || [])[t.results.length - 1] || {};
        const error = (last.errors || []).map(e => (e.message || '').replace(/\u001b\[[0-9;]*m/g, '').trim()).join('\n');
        failures.push({ title: [...here, spec.title].join(' › '), error: error.slice(0, 2000) });
      }
    }
    for (const s of suite.suites || []) walk(s, here);
  };
  for (const s of report.suites || []) walk(s, []);
  const st = report.stats || {};
  return { passed: st.expected || 0, failed: st.unexpected || 0, flaky: st.flaky || 0, skipped: st.skipped || 0, failures };
}

module.exports = { parseConverted, newlyConverted, judge, renderReview, summarizeTests, BASE_PAGE };
