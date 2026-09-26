const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { parseConverted, newlyConverted, judge, renderReview, summarizeTests } = require('../scripts/vj-review-lib');

test('从验收测试里读出已改造清单,只取相对基线新增的', () => {
  const base = "const CONVERTED = ['vjA', 'vjB'];";
  const cur = "const CONVERTED = ['vjA', 'vjB',\n  'vjC', \"vjD\"];\nconst OTHER = ['vjX'];";
  expect(parseConverted(cur)).toEqual(['vjA', 'vjB', 'vjC', 'vjD']);
  expect(newlyConverted(base, cur)).toEqual(['vjC', 'vjD']);
  expect(() => parseConverted('const X = 1;')).toThrow(/CONVERTED/);
  // 真文件能解析出来,且包含两条示范隧道
  const real = fs.readFileSync(path.join(__dirname, 'vj-anti-plastic.spec.js'), 'utf8');
  expect(parseConverted(real)).toEqual(expect.arrayContaining(['vjChromeFlow', 'vjNeonTubeRoom']));
});

test('判据与 vj-anti-plastic 一致:lit 40%~90%(不含边界)、饱和 > 50%、色相 > 5', () => {
  expect(judge({ lit: 0.5, vivid: 0.6, hues: 6 })).toEqual({ ok: true, fails: [] });
  expect(judge({ lit: 0.4, vivid: 0.6, hues: 6 }).fails).toEqual(['lit']);
  expect(judge({ lit: 0.95, vivid: 0.5, hues: 5 }).fails).toEqual(['lit', 'vivid', 'hues']);
  // 阈值一旦在验收测试里改了,这里要跟着改,否则对比网页和测试会给出不同结论
  const src = fs.readFileSync(path.join(__dirname, 'vj-anti-plastic.spec.js'), 'utf8');
  for (const s of ['r.lit, `${r.tag}: 太暗`).toBeGreaterThan(0.4)', 'r.lit, `${r.tag}: 没有暗部纵深`).toBeLessThan(0.9)',
    'r.vivid, `${r.tag}: 发灰`).toBeGreaterThan(0.5)', 'r.hues, `${r.tag}: 单色`).toBeGreaterThan(5)']) {
    expect(src, `vj-anti-plastic 的判据变了:${s}`).toContain(s);
  }
});

test('对比网页:改前/改后图片路径、未过判据的格子、缺图和错页警告', () => {
  const m = (tier, kind, lit, page) => ({ tier, kind, lit, vivid: 0.7, hues: 8, frameMs: null, page });
  const html = renderReview({
    base: 'abc1234', date: '2026-09-26', tiers: ['low', 'ultra'], kinds: ['vjA', 'vj<B>'],
    before: [m('low', 'vjA', 0.5, '.vj-review-base.html'), m('ultra', 'vjA', 0.5, '.vj-review-base.html')],
    after: [m('low', 'vjA', 0.3, '61.html'), m('ultra', 'vjA', 0.6, '61.html'),
      m('low', 'vj<B>', 0.6, '61.html'), m('ultra', 'vj<B>', 0.6, '61.html')],
    tests: { passed: 5, failed: 1, flaky: 0, skipped: 0, failures: [{ title: 'lit 太暗', error: 'expected > 0.4' }] },
  });
  expect(html).toContain('src="after/low-vjA.png"');
  expect(html).toContain('src="before/low-vjA.png"');
  expect(html).toContain('src="after/ultra-vjA-crop.png"');
  expect(html, '翻到改前时角标也要跟着变').toContain('<span class="tag b">改前 · 松开回到改后</span>');
  expect(html).not.toContain('vj<B>');            // 名字要转义
  expect(html).toContain('vj&lt;B&gt;');
  expect((html.match(/data-verdict="fail"/g) || []).length).toBe(1);   // 只有 low/vjA 改后没过
  expect(html).toContain('改前没有这条');          // vj<B> 在基线里没有截图
  expect(html).toContain('lit 太暗');
  expect(html).not.toContain('页面文件不对');

  // 改前就没过、改后过了:总表要看得出「修好了」,改前那一格的超标数值也要标红
  const fixed = renderReview({ base: 'abc1234', date: 'd', tiers: ['low'], kinds: ['vjA'],
    before: [m('low', 'vjA', 0.934, '.vj-review-base.html')], after: [m('low', 'vjA', 0.533, '61.html')], tests: null });
  expect(fixed).toContain('改前 ✗');
  expect(fixed).toContain('<td class="bad">93.4%</td><td class="">53.3%</td>');
  expect(html).not.toContain('改前 ✗');

  const wrong = renderReview({ base: 'abc1234', date: 'd', tiers: ['low'], kinds: ['vjA'],
    before: [m('low', 'vjA', 0.5, '61.html')], after: [m('low', 'vjA', 0.5, '61.html')], tests: null });
  expect(wrong, '改前截到的是工作区版本时必须大声报出来').toContain('页面文件不对');
  expect(wrong).toContain('没有跑验收测试');
});

test('验收测试结果:从 Playwright JSON 报告里数通过/失败,列出失败项和去掉颜色码的报错', () => {
  const spec = (title, status, msgs = []) => ({ title, tests: [{ status, results: [{ status: 'failed', errors: msgs.map(message => ({ message })) }] }] });
  const report = {
    stats: { expected: 3, unexpected: 1, flaky: 1, skipped: 0 },
    suites: [{ title: 'vj-anti-plastic.spec.js', specs: [spec('三档画面', 'unexpected', ['\u001b[31mlow/vjA: 太暗\u001b[39m', 'ultra/vjA: 单色'])],
      suites: [{ title: 'inner', specs: [spec('ok one', 'expected'), spec('retry', 'flaky')] }] }],
  };
  const r = summarizeTests(report);
  expect(r).toMatchObject({ passed: 3, failed: 1, flaky: 1, skipped: 0 });
  expect(r.failures).toEqual([{ title: 'vj-anti-plastic.spec.js › 三档画面', error: 'low/vjA: 太暗\nultra/vjA: 单色' }]);
});
