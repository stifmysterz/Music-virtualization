const path=require('path');
const {test,expect,_electron:electron}=require('@playwright/test');
const {newUserDataDir,cleanupUserDataDir}=require('./helpers/tmp-user-data');
const {closeApp}=require('./helpers/close-app');
const APP_DIR=path.join(__dirname,'..');
async function withApp(label,fn){const dir=newUserDataDir(label);let app=null,win=null;try{
  app=await electron.launch({args:['.',`--user-data-dir=${dir}`],cwd:APP_DIR});win=await app.firstWindow();
  await expect.poll(()=>win.evaluate(()=>document.getElementById('cv').width)).toBeGreaterThan(300);await fn(win);
}finally{await closeApp(app,win);try{cleanupUserDataDir(dir);}catch(_e){}}}

test('Ultraviolet Hive Rush 已加入 VJ 菜单且是 8 秒实时场景',async()=>withApp('uv-hive-menu',async win=>{
  await win.evaluate(()=>document.getElementById('intro')?.classList.add('hidden'));
  const btn=win.locator('#bg3DVjUltravioletHiveRushBtn');await expect(btn).toContainText('Ultraviolet Hive Rush');
  const r=await win.evaluate(()=>{enableBg3D('vjUltravioletHiveRush');renderBg3D(.8,.7,.9,1);
    return {kind:bg3DKind,registered:VJ_TUNNEL_KINDS.includes('vjUltravioletHiveRush'),meta:bg3DScenes.vjUltravioletHiveRush.scene.userData.ultravioletHiveRush};});
  expect(r.kind).toBe('vjUltravioletHiveRush');expect(r.registered).toBe(true);expect(r.meta.durationSeconds).toBe(8);
  expect(r.meta.ledCount).toBeGreaterThan(500);expect(r.meta.particleCount).toBeGreaterThan(900);
}));

test('蜂巢、旋转和高速推进在首尾完全闭合',async()=>withApp('uv-hive-loop',async win=>{
  const r=await win.evaluate(()=>({a:ultravioletHiveRushSample(19,0),b:ultravioletHiveRushSample(19,1)}));
  for(const key of ['z','twist','radius','pulse'])expect(Math.abs(r.a[key]-r.b[key]),key).toBeLessThan(1e-9);
}));

test('蜂巢 VJ 有足够密度和虹彩，但没有白场',async()=>withApp('uv-hive-render',async win=>{
  const r=await win.evaluate(()=>{document.getElementById('intro')?.classList.add('hidden');enableBg3D('vjUltravioletHiveRush');
    for(let i=0;i<32;i++)renderBg3D(.8,.7,.9,1);const gl=bg3DRenderer.getContext(),w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,buf=new Uint8Array(w*h*4);
    gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,buf);let lit=0,vivid=0,white=0,dark=0;
    for(let i=0;i<w*h;i++){const a=buf[i*4],b=buf[i*4+1],c=buf[i*4+2],mx=Math.max(a,b,c),mn=Math.min(a,b,c);if(mx>=40){lit++;if((mx-mn)/mx>.5)vivid++;}if(mn>=225)white++;if(mx<24)dark++;}
    return {total:w*h,lit,vivid,white,dark,snap:bg3DPerformanceSnapshot(),budget:BG3D_PERFORMANCE_BUDGET.balanced,guarded:bg3DScenes.vjUltravioletHiveRush.composer.passes.some(p=>p.__vjHighlightGuard)};});
  expect(r.lit/r.total).toBeGreaterThan(.25);expect(r.vivid/r.lit).toBeGreaterThan(.5);expect(r.dark/r.total).toBeGreaterThan(.15);
  expect(r.white/r.total).toBeLessThan(.04);expect(r.guarded).toBe(true);expect(r.snap.calls,'draw calls').toBeLessThanOrEqual(r.budget.maxDrawCalls);
  expect(r.snap.triangles,'triangles').toBeLessThanOrEqual(r.budget.maxTriangles);
}));
