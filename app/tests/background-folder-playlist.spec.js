const fs=require('fs');
const os=require('os');
const path=require('path');
const {test,expect,_electron:electron}=require('@playwright/test');
const {newUserDataDir,cleanupUserDataDir}=require('./helpers/tmp-user-data');
const {closeApp}=require('./helpers/close-app');
const APP_DIR=path.join(__dirname,'..');
const VALID_PNG=path.join(APP_DIR,'build','icon.png');
function makeFolder(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sub-remix-bg-folder-'));fs.copyFileSync(VALID_PNG,path.join(dir,'01.png'));fs.copyFileSync(VALID_PNG,path.join(dir,'02.png'));return dir;}
async function launch(dir){const app=await electron.launch({args:['.',`--user-data-dir=${dir}`],cwd:APP_DIR});const win=await app.firstWindow();await expect.poll(()=>win.evaluate(()=>document.getElementById('cv').width)).toBeGreaterThan(300);return {app,win};}

test('Select Folder 扫描支持格式、过滤其它文件并自动刷新',async()=>{
  const user=newUserDataDir('bg-folder-scan'),folder=makeFolder();let app,win;
  try{({app,win}=await launch(user));fs.writeFileSync(path.join(folder,'ignore.txt'),'x');
    const first=await win.evaluate(folder=>loadBackgroundFolder(folder,false).then(()=>bgFolderFiles.map(f=>f.name)),folder);
    expect(first).toEqual(['01.png','02.png']);
    fs.copyFileSync(VALID_PNG,path.join(folder,'03.jpg'));
    await expect.poll(()=>win.evaluate(()=>bgFolderFiles.map(f=>f.name)),{timeout:5000}).toEqual(['01.png','02.png','03.jpg']);
  }finally{await closeApp(app,win);cleanupUserDataDir(user);fs.rmSync(folder,{recursive:true,force:true});}
});

test('Shuffle 一轮不重复，并避开最近项目',async()=>{
  const user=newUserDataDir('bg-folder-shuffle');let app,win;
  try{({app,win}=await launch(user));const r=await win.evaluate(()=>{
      bgFolderFiles=Array.from({length:7},(_,i)=>({path:'p'+i,name:'p'+i,type:'image'}));bgFolderOrder='shuffle';bgFolderAvoidRepeat=true;bgFolderRecent=['p0','p1'];resetBgFolderBag();
      const picked=[];for(let i=0;i<7;i++)picked.push(nextBgFolderFile().path);return {picked,firstTwo:picked.slice(0,2)};
    });
    expect(new Set(r.picked).size).toBe(7);expect(r.firstTwo).not.toContain('p0');expect(r.firstTwo).not.toContain('p1');
  }finally{await closeApp(app,win);cleanupUserDataDir(user);}
});

test('Cover、Contain、Stretch 在录制 composite 使用正确几何',async()=>{
  const user=newUserDataDir('bg-folder-fit');let app,win;
  try{({app,win}=await launch(user));const r=await win.evaluate(()=>{const el=document.createElement('canvas');el.width=400;el.height=200;document.body.appendChild(el);
    const sample=fit=>{el.style.objectFit=fit;return captureObjectFitSource(el,300,300);};const out={cover:sample('cover'),contain:sample('contain'),fill:sample('fill')};el.remove();return out;});
    expect(r.cover).toMatchObject({sx:100,sy:0,sw:200,sh:200,dx:0,dy:0,dw:300,dh:300});
    expect(r.contain).toMatchObject({sx:0,sy:0,sw:400,sh:200,dx:0,dy:75,dw:300,dh:150});
    expect(r.fill).toMatchObject({sx:0,sy:0,sw:400,sh:200,dx:0,dy:0,dw:300,dh:300});
  }finally{await closeApp(app,win);cleanupUserDataDir(user);}
});

test('Crossfade 两层都进入录制 composite，视频层始终静音',async()=>{
  const user=newUserDataDir('bg-folder-record-lock'),folder=makeFolder();let app,win;
  try{({app,win}=await launch(user));const r=await win.evaluate(async folder=>{
      await loadBackgroundFolder(folder,false);bgFolderCrossfade=2;applyBgFolderFit();
      await showBgFolderFile(bgFolderFiles[0]);await showBgFolderFile(bgFolderFiles[1]);
      const drawn=[],styled=[],original=drawCaptureElement;
      drawCaptureElement=(el,...args)=>{if(el&&el.parentElement?.classList.contains('bg-playlist-slot')){drawn.push(el.parentElement.id);styled.push(!!args[2]);}return original(el,...args);};
      composeCaptureFrame();drawCaptureElement=original;
      return {drawn,styled,active:bgFolderSlots.filter(s=>s.el.classList.contains('active')).length,muted:bgFolderSlots.every(s=>s.video.muted),ready:await ensureBackgroundReadyForRecording()};
    },folder);
    expect(r.drawn).toEqual(expect.arrayContaining(['bgPlaylistSlotA','bgPlaylistSlotB']));expect(r.styled.every(Boolean)).toBe(true);expect(r.active).toBe(1);expect(r.muted).toBe(true);expect(r.ready).toBe(true);
  }finally{await closeApp(app,win);cleanupUserDataDir(user);fs.rmSync(folder,{recursive:true,force:true});}
});

test('Position BG 同时控制两个 Crossfade 槽，切换后保留且录制使用同一变换',async()=>{
  const user=newUserDataDir('bg-folder-position'),folder=makeFolder();let app,win;
  try{({app,win}=await launch(user));const r=await win.evaluate(async folder=>{
      await loadBackgroundFolder(folder,false);bgFolderCrossfade=2;applyBgFolderFit();
      await showBgFolderFile(bgFolderFiles[0]);
      const first=activeBgTransform();first.set({x:120,y:-45,scale:1.6,rotation:0.3});
      const before=bgPlaylistTransforms.map(t=>t.state());
      await showBgFolderFile(bgFolderFiles[1]);
      const after=bgPlaylistTransforms.map(t=>t.state());
      const activeIsNew=activeBgTransform()===bgPlaylistTransforms[bgFolderActiveSlot];

      // 真实拖动当前槽；mirror 必须让另一槽跟着走，面板数值也要同步。
      setBgAdjust(true);const el=bgFolderSlots[bgFolderActiveSlot].el;
      // Synthetic PointerEvent 没有浏览器分配的 active pointer，测试里把 capture 变成 no-op；
      // 生产中的真实鼠标/触控仍使用原生 setPointerCapture。
      el.setPointerCapture=()=>{};
      const p={bubbles:true,pointerId:7,clientX:400,clientY:300,isPrimary:true};
      el.dispatchEvent(new PointerEvent('pointerdown',p));
      el.dispatchEvent(new PointerEvent('pointermove',p));
      el.dispatchEvent(new PointerEvent('pointermove',{...p,clientX:460,clientY:325}));
      el.dispatchEvent(new PointerEvent('pointerup',p));
      const dragged=bgPlaylistTransforms.map(t=>t.state());
      const pointerEvents=bgFolderSlots.map(s=>getComputedStyle(s.el).pointerEvents);

      // recorder 必须采用槽的 transform，而不是只画未变换的 img/video。
      composeCaptureFrame();const matrices=[],original=captureCtx.transform;
      captureCtx.transform=function(...m){matrices.push(m);return original.apply(this,m);};
      composeCaptureFrame();captureCtx.transform=original;setBgAdjust(false);
      // 拖动手感是屏幕像素 1:1 跟手；换算成舞台本地(逻辑)像素时要除以当前编辑预览缩放——
      // 普通窗口里 Dock 会占掉一点高度，previewScale() 天然小于 1，不是 bug。
      return {before,after,dragged,activeIsNew,pointerEvents,previewScale:previewScale(),
        sliderX:parseFloat(document.getElementById('bgPosXSel').value),matrices};
    },folder);
    for(const st of [...r.before,...r.after])expect(st).toMatchObject({x:120,y:-45,scale:1.6,rotation:0.3});
    expect(r.activeIsNew).toBe(true);
    const expectedX=120+60/r.previewScale, expectedY=-45+25/r.previewScale;
    for(const st of r.dragged){expect(st.x).toBeCloseTo(expectedX,0);expect(st.y).toBeCloseTo(expectedY,0);expect(st.scale).toBeCloseTo(1.6,3);expect(st.rotation).toBeCloseTo(.3,3);}
    expect(r.sliderX).toBeCloseTo(expectedX,0);
    expect(r.pointerEvents.filter(v=>v==='auto')).toHaveLength(1);
    const expectedA=1.6*Math.cos(.3),expectedB=1.6*Math.sin(.3);
    expect(r.matrices.some(m=>Math.abs(m[0]-expectedA)<.01&&Math.abs(m[1]-expectedB)<.01)).toBe(true);
  }finally{await closeApp(app,win);cleanupUserDataDir(user);fs.rmSync(folder,{recursive:true,force:true});}
});

test('损坏媒体自动跳过，视频可选择播完或按时间切换',async()=>{
  const user=newUserDataDir('bg-folder-skip'),folder=makeFolder();let app,win;
  try{fs.writeFileSync(path.join(folder,'00-broken.png'),'not an image');({app,win}=await launch(user));
    const r=await win.evaluate(async folder=>{await loadBackgroundFolder(folder,false);bgFolderOrder='sequential';bgFolderCurrentPath=bgFolderFiles[bgFolderFiles.length-1].path;
      const ok=await showBgFolderFile(bgFolderFiles[0]);const slot=bgFolderSlots[bgFolderActiveSlot];bgFolderAuto=true;
      const fake={type:'video'};bgFolderVideoPolicy='ended';scheduleBgFolderAdvance(fake,slot);const ended=typeof slot.video.onended==='function';
      bgFolderVideoPolicy='timed';scheduleBgFolderAdvance(fake,slot);const timed=bgFolderTimer!==null;clearTimeout(bgFolderTimer);
      return {ok,current:bgFolderCurrentPath,ended,timed};},folder);
    expect(r.ok).toBe(true);expect(r.current).toMatch(/01\.png$/);expect(r.ended).toBe(true);expect(r.timed).toBe(true);
  }finally{await closeApp(app,win);cleanupUserDataDir(user);fs.rmSync(folder,{recursive:true,force:true});}
});

test('文件夹与播放设置写入 localStorage',async()=>{
  const user=newUserDataDir('bg-folder-persist'),folder=makeFolder();let app,win;
  try{({app,win}=await launch(user));const saved=await win.evaluate(async folder=>{await loadBackgroundFolder(folder,false);bgFolderAuto=true;bgFolderOrder='sequential';bgFolderInterval=37;bgFolderVideoPolicy='timed';bgFolderFit='contain';bgFolderCrossfade=.5;bgFolderAvoidRepeat=false;saveBgFolderSettings();return JSON.parse(localStorage.getItem(BG_FOLDER_KEY));},folder);
    expect(saved).toMatchObject({folder,auto:true,order:'sequential',interval:37,videoPolicy:'timed',fit:'contain',crossfade:.5,avoidRepeat:false});
    await closeApp(app,win);app=null;win=null;({app,win}=await launch(user));
    await expect.poll(()=>win.evaluate(()=>bgFolderFiles.length),{timeout:5000}).toBe(2);
    const restored=await win.evaluate(()=>({folder:bgFolderPath,auto:bgFolderAuto,order:bgFolderOrder,interval:bgFolderInterval,
      videoPolicy:bgFolderVideoPolicy,fit:bgFolderFit,crossfade:bgFolderCrossfade,avoidRepeat:bgFolderAvoidRepeat,objectFit:bgFolderSlots[0].image.style.objectFit}));
    expect(restored).toMatchObject({folder,auto:true,order:'sequential',interval:37,videoPolicy:'timed',fit:'contain',crossfade:.5,avoidRepeat:false,objectFit:'contain'});
  }finally{await closeApp(app,win);cleanupUserDataDir(user);fs.rmSync(folder,{recursive:true,force:true});}
});
