const path=require('path');
const {test,expect,_electron:electron}=require('@playwright/test');
const {newUserDataDir,cleanupUserDataDir}=require('./helpers/tmp-user-data');
const {closeApp}=require('./helpers/close-app');
const APP_DIR=path.join(__dirname,'..');

async function withApp(label,fn){
  const dir=newUserDataDir(label); let app=null,win=null;
  try{app=await electron.launch({args:['.',`--user-data-dir=${dir}`],cwd:APP_DIR});win=await app.firstWindow();
    await expect.poll(()=>win.evaluate(()=>document.getElementById('cv').width)).toBeGreaterThan(300);await fn(win);
  }finally{await closeApp(app,win);try{cleanupUserDataDir(dir);}catch(_e){}}
}

test('两个新 VJ 已加入菜单并使用独立实时场景',async()=>withApp('new-vj-menu',async win=>{
  await win.evaluate(()=>document.getElementById('intro')?.classList.add('hidden'));
  await expect(win.locator('#bg3DVjNeonGeometryTunnelBtn')).toContainText('Neon Geometry Infinity');
  await expect(win.locator('#bg3DVjBlackGoldFluidBtn')).toContainText('Liquid Black Gold');
  const r=await win.evaluate(()=>{enableBg3D('vjNeonGeometryTunnel');renderBg3D(.8,.7,.9,1);
    const neon=bg3DScenes.vjNeonGeometryTunnel.scene.userData.neonGeometryTunnel;
    enableBg3D('vjBlackGoldFluid');renderBg3D(.8,.7,.9,1);
    return {kind:bg3DKind,neon,gold:bg3DScenes.vjBlackGoldFluid.scene.userData.blackGoldFluid,
      registered:['vjNeonGeometryTunnel','vjBlackGoldFluid'].every(k=>VJ_TUNNEL_KINDS.includes(k))};});
  expect(r.registered).toBe(true);expect(r.kind).toBe('vjBlackGoldFluid');
  expect(r.neon.beamCount).toBeGreaterThan(200);expect(r.gold.beadCount).toBeGreaterThan(500);
}));

test('两个新 VJ 的 16 拍运动首尾无缝',async()=>withApp('new-vj-loop',async win=>{
  const r=await win.evaluate(()=>({n0:neonGeometryTunnelSample(17,0),n1:neonGeometryTunnelSample(17,1),
    g0:blackGoldFluidSample(4,23,0),g1:blackGoldFluidSample(4,23,1)}));
  for(const key of ['z','radius','twist','hue']) expect(Math.abs(r.n0[key]-r.n1[key]),`neon ${key}`).toBeLessThan(1e-9);
  for(const key of ['z','x','y','scale']) expect(Math.abs(r.g0[key]-r.g1[key]),`gold ${key}`).toBeLessThan(1e-9);
}));

test('实际渲染保留颜色和暗部，不产生白场',async()=>withApp('new-vj-render',async win=>{
  const results=await win.evaluate(()=>{const out={};for(const kind of ['vjNeonGeometryTunnel','vjBlackGoldFluid']){
    enableBg3D(kind);for(let i=0;i<28;i++)renderBg3D(.75,.6,.85,1);
    const gl=bg3DRenderer.getContext(),w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,buf=new Uint8Array(w*h*4);
    gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,buf);let lit=0,vivid=0,white=0,dark=0;
    for(let i=0;i<w*h;i++){const r=buf[i*4],g=buf[i*4+1],b=buf[i*4+2],mx=Math.max(r,g,b),mn=Math.min(r,g,b);
      if(mx>=35){lit++;if(mx>0&&(mx-mn)/mx>.32)vivid++;}if(mn>=225)white++;if(mx<24)dark++;}
    out[kind]={total:w*h,lit,vivid,white,dark,snap:bg3DPerformanceSnapshot(),guarded:bg3DScenes[kind].composer.passes.some(p=>p.__vjHighlightGuard)};
  }return out;});
  for(const [kind,r] of Object.entries(results)){expect(r.lit/r.total,`${kind} 太空`).toBeGreaterThan(.25);
    expect(r.vivid/Math.max(1,r.lit),`${kind} 颜色不足`).toBeGreaterThan(.28);expect(r.dark/r.total,`${kind} 没有暗部`).toBeGreaterThan(.2);
    expect(r.white/r.total,`${kind} 白场过多`).toBeLessThan(.04);expect(r.guarded).toBe(true);
    expect(r.snap.calls).toBeLessThanOrEqual(12);expect(r.snap.triangles).toBeLessThan(100000);}
}));
