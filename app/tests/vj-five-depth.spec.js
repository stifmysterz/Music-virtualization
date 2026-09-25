const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

const KINDS=['vjStarLane','vjSpeedGates','vjPlasmaRings','vjNeonTubeRoom','vjKaleido'];

test('five revised VJ tunnels retain dark space, vivid colour and visible geometry', async () => {
  const dir=newUserDataDir('vj-five-depth');
  let app,win;
  try{
    app=await electron.launch({args:['.',`--user-data-dir=${dir}`],cwd:path.join(__dirname,'..')});
    win=await app.firstWindow();
    await expect.poll(()=>win.evaluate(()=>document.getElementById('cv')?.width||0)).toBeGreaterThan(300);
    // low 档退回不受光材质，受光档调好的亮度在这里会朝白收敛 —— 三档都要测
    const results=[];
    for(const quality of ['low','balanced','ultra']) results.push(...await win.evaluate(({kinds,quality})=>{
      document.getElementById('intro')?.classList.add('hidden');
      const sel=document.getElementById('vjQualitySel');
      sel.value=quality;sel.dispatchEvent(new Event('change'));
      seedBg3DBuilds(0x5EED);
      return kinds.map(kind=>{
        enableBg3D(kind);
        for(let i=0;i<42;i++) renderBg3D(0.5,0.4,0.3,1);
        const gl=bg3DRenderer.getContext(),w=gl.drawingBufferWidth,h=gl.drawingBufferHeight;
        const buf=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,buf);
        let lit=0,vivid=0;const hues=new Set();
        for(let i=0;i<w*h;i++){
          const r=buf[i*4],g=buf[i*4+1],b=buf[i*4+2];
          const mx=Math.max(r,g,b),mn=Math.min(r,g,b);
          if(mx<40)continue;
          lit++;
          if((mx-mn)/mx>0.5){vivid++;hues.add(Math.round(Math.atan2(g-b,r-g)*6));}
        }
        return {kind:`${vjQuality}/${kind}`,lit:lit/(w*h),vivid:vivid/Math.max(1,lit),hues:hues.size};
      });
    },{kinds:KINDS,quality}));
    results.forEach(r=>console.log(`${r.kind}: lit=${(r.lit*100).toFixed(1)}% vivid=${(r.vivid*100).toFixed(1)}% hues=${r.hues}`));
    for(const r of results){
      expect.soft(r.lit,`${r.kind} too dark`).toBeGreaterThan(0.4);
      expect.soft(r.lit,`${r.kind} lacks dark space`).toBeLessThan(0.9);
      expect.soft(r.vivid,`${r.kind} washed out`).toBeGreaterThan(0.5);
      expect.soft(r.hues,`${r.kind} monochrome`).toBeGreaterThan(5);
    }
  }finally{
    await closeApp(app,win);
    try{cleanupUserDataDir(dir);}catch(_e){}
  }
});
