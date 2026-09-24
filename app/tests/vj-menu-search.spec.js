const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

test('VJ groups, search, favourites and translation keep every tunnel reachable', async () => {
  const dir=newUserDataDir('vj-menu-search');
  let app, win;
  try{
    app=await electron.launch({args:['.',`--user-data-dir=${dir}`],cwd:path.join(__dirname,'..')});
    win=await app.firstWindow();
    await expect.poll(()=>win.evaluate(()=>document.getElementById('cv').width)).toBeGreaterThan(300);
    const result=await win.evaluate(()=>{
      document.getElementById('intro')?.classList.add('hidden');
      const list=document.getElementById('vjMenuList');
      const search=document.getElementById('vjSearchIn');
      const rows=()=>[...list.querySelectorAll('.dock-dd-item')].map(x=>x.dataset.kind);
      const initial=rows().join('|')===VJ_TUNNEL_KINDS.join('|');
      const groups=list.querySelectorAll('[aria-expanded]').length;
      list.querySelector('[aria-expanded]').click();
      const collapsed=rows().length===VJ_TUNNEL_KINDS.length-10;
      search.value='liquid chrome'; search.dispatchEvent(new Event('input'));
      const found=rows().length===1&&rows()[0]==='vjChromeTube';
      const fav=list.querySelector('.mode-fav-btn'); fav.click();
      const pinned=rows().filter(k=>k==='vjChromeTube').length===2;
      applyLanguage('zh');
      const translated=search.placeholder.includes('搜索')&&rows().includes('vjChromeTube');
      search.value='nothing-will-match'; search.dispatchEvent(new Event('input'));
      const empty=!!list.querySelector('.np-empty');
      search.value=''; search.dispatchEvent(new Event('input'));
      return {initial,groups,collapsed,found,pinned,translated,empty};
    });
    expect(result).toEqual({initial:true,groups:5,collapsed:true,found:true,pinned:true,translated:true,empty:true});
  }finally{
    await closeApp(app,win);
    try{cleanupUserDataDir(dir);}catch(_e){}
  }
});
