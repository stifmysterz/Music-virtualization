const path=require('path');
const {test,expect,_electron:electron}=require('@playwright/test');
const {newUserDataDir,cleanupUserDataDir}=require('./helpers/tmp-user-data');
const {closeApp}=require('./helpers/close-app');
const APP_DIR=path.join(__dirname,'..');

async function withApp(label,fn){
  const dir=newUserDataDir(label);let app=null,win=null;
  try{
    app=await electron.launch({args:['.',`--user-data-dir=${dir}`],cwd:APP_DIR});
    win=await app.firstWindow();
    await expect.poll(()=>win.evaluate(()=>document.getElementById('cv').width)).toBeGreaterThan(300);
    await fn(win);
  }finally{await closeApp(app,win);try{cleanupUserDataDir(dir);}catch(_e){}}
}

test('Neon Reactor Descent appears in the VJ menu and keeps its mechanical density',async()=>withApp('reactor-menu',async win=>{
  const btn=win.locator('#bg3DVjNeonReactorDescentBtn');
  await expect(btn).toContainText('Neon Reactor Descent');
  const r=await win.evaluate(()=>{
    document.getElementById('intro')?.classList.add('hidden');
    enableBg3D('vjNeonReactorDescent');renderBg3D(.8,.7,.9,1);
    return {kind:bg3DKind,registered:VJ_TUNNEL_KINDS.includes('vjNeonReactorDescent'),
      meta:bg3DScenes.vjNeonReactorDescent.scene.userData.neonReactorDescent,
      loop:VJ_LOOP_META.vjNeonReactorDescent};
  });
  expect(r.kind).toBe('vjNeonReactorDescent');expect(r.registered).toBe(true);
  expect(r.meta).toMatchObject({ringCount:40,wallPanels:720,lightSegments:1440,particleCount:420,loopBeats:16});
  expect(r.loop).toMatchObject({loopBeats:16,seamlessStrategy:'deterministic-depth-wrap'});
}));

test('reactor ring depth, twist and pulse close exactly at the loop boundary',async()=>withApp('reactor-loop',async win=>{
  const r=await win.evaluate(()=>({a:neonReactorDescentSample(19,0),b:neonReactorDescentSample(19,1)}));
  for(const key of ['z','twist','pulse'])expect(Math.abs(r.a[key]-r.b[key]),key).toBeLessThan(1e-9);
}));

test('reactor tunnel is colorful and dense without a white bloom field',async()=>withApp('reactor-render',async win=>{
  const r=await win.evaluate(()=>{
    document.getElementById('intro')?.classList.add('hidden');enableBg3D('vjNeonReactorDescent');
    for(let i=0;i<32;i++)renderBg3D(.8,.7,.9,1);
    const gl=bg3DRenderer.getContext(),w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,buf=new Uint8Array(w*h*4);
    gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,buf);
    let lit=0,vivid=0,white=0,dark=0;
    for(let i=0;i<w*h;i++){
      const a=buf[i*4],b=buf[i*4+1],c=buf[i*4+2],mx=Math.max(a,b,c),mn=Math.min(a,b,c);
      if(mx>=40){lit++;if((mx-mn)/mx>.5)vivid++;}
      if(mn>=225)white++;if(mx<24)dark++;
    }
    return {total:w*h,lit,vivid,white,dark,snap:bg3DPerformanceSnapshot(),
      budget:BG3D_PERFORMANCE_BUDGET.balanced,
      guarded:bg3DScenes.vjNeonReactorDescent.composer.passes.some(p=>p.__vjHighlightGuard)};
  });
  expect(r.lit/r.total).toBeGreaterThan(.25);
  expect(r.vivid/r.lit).toBeGreaterThan(.5);
  expect(r.dark/r.total).toBeGreaterThan(.15);
  expect(r.white/r.total).toBeLessThan(.04);
  expect(r.guarded).toBe(true);
  expect(r.snap.calls,'draw calls').toBeLessThanOrEqual(r.budget.maxDrawCalls);
  expect(r.snap.triangles,'triangles').toBeLessThanOrEqual(r.budget.maxTriangles);
}));
