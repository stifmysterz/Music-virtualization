const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

const APP_DIR = path.join(__dirname, '..');

async function withApp(label, fn) {
  const dir = newUserDataDir(label); let app, win;
  try {
    app=await electron.launch({args:['.', `--user-data-dir=${dir}`], cwd:APP_DIR});
    win=await app.firstWindow();
    await expect.poll(()=>win.evaluate(()=>document.getElementById('cv').width)).toBeGreaterThan(300);
    await fn(win);
  } finally { await closeApp(app,win); try { cleanupUserDataDir(dir); } catch(e) {} }
}

test('每个 2D mode 都有明确质量等级，S/A/Legacy 清单没有失效 key', async () => {
  await withApp('mode-quality-data', async win => {
    const r=await win.evaluate(()=>({
      modes:[...MODES], tiers:{...MODE_QUALITY_TIER}, s:[...MODE_S_TIER], a:[...MODE_A_TIER], legacy:[...MODE_LEGACY_TIER],
      premiumCategory:MODE_CATEGORIES.find(c=>c.name==='★ S Tier — Premium Picks')?.keys
    }));
    expect(r.s).toHaveLength(20); expect(r.a).toHaveLength(31); expect(r.legacy).toHaveLength(7);
    expect([...r.s,...r.a,...r.legacy].every(key=>r.modes.includes(key))).toBe(true);
    expect(new Set([...r.s,...r.a,...r.legacy]).size).toBe(58);
    expect(Object.keys(r.tiers).sort()).toEqual([...r.modes].sort());
    expect(r.s.every(key=>r.tiers[key]==='S')).toBe(true);
    expect(r.a.every(key=>r.tiers[key]==='A')).toBe(true);
    expect(r.legacy.every(key=>r.tiers[key]==='Legacy')).toBe(true);
    expect(r.premiumCategory).toEqual(r.s);
  });
});

test('Mode drop-up 与完整面板都会展示等级，S 级分类可正常选择', async () => {
  await withApp('mode-quality-ui', async win => {
    const r=await win.evaluate(()=>{
      document.getElementById('modeBtn').click();
      const header=[...document.querySelectorAll('#modeMenuList .mode-cat-header')].find(el=>el.dataset.modeCat==='★ S Tier — Premium Picks');
      header.click();
      const item=document.querySelector('#modeMenuList [data-mode-key="laserBeam"]');
      const badge=item.querySelector('.mode-quality-badge'); item.click();
      document.getElementById('modeMoreBtn').click();
      const panelRow=[...document.querySelectorAll('#modePanel .mode-row')].find(el=>MODES[+el.dataset.idx]==='laserBeam');
      return {badge:badge?.textContent, active:[...activeModes], idx:MODES.indexOf('laserBeam'), panelBadge:panelRow?.querySelector('.mode-quality-badge')?.textContent};
    });
    expect(r.badge).toBe('S'); expect(r.panelBadge).toBe('S');
    expect(r.active).toEqual([r.idx]);
  });
});
