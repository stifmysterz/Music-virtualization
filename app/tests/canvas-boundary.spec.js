const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { newUserDataDir, cleanupUserDataDir } = require('./helpers/tmp-user-data');
const { closeApp } = require('./helpers/close-app');

const APP_DIR = path.join(__dirname, '..');

async function withApp(label, fn) {
  const dir = newUserDataDir(label);
  let app = null, win = null;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], cwd: APP_DIR });
    win = await app.firstWindow();
    await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    await win.evaluate(() => document.getElementById('intro')?.classList.add('hidden'));
    await fn(win);
  } finally {
    await closeApp(app, win);
    try { cleanupUserDataDir(dir); } catch (e) {}
  }
}

test('Background、3D/VJ、2D、Logo、Text 全部属于同一个裁切舞台', async () => {
  await withApp('canvas-boundary-parents', async win => {
    const result = await win.evaluate(() => ({
      overflow:getComputedStyle(visualStage).overflow,
      children:['bgVideo','bgImage','bgThree','cvBack','cvFx','cv','titleDisplay','textADisplay','textBDisplay']
        .map(id => ({id, parent:document.getElementById(id).parentElement.id}))
    }));
    expect(result.overflow).toBe('hidden');
    expect(result.children.every(item => item.parent==='visualStage')).toBe(true);
  });
});

test('四种比例下 Outline、2D 和 3D/VJ 使用完全相同的矩形', async () => {
  test.setTimeout(120_000);
  await withApp('canvas-boundary-aspects', async win => {
    const rows = await win.evaluate(() => {
      const rect = el => {
        const r = el.getBoundingClientRect();
        return {left:r.left, top:r.top, width:r.width, height:r.height, right:r.right, bottom:r.bottom};
      };
      const result = [];
      for(const mode of ['free','portrait','square','landscape']){
        aspectMode = mode; resize();
        enableBg3D(mode==='landscape' ? 'vjLiquidGrid' : 'particles');
        result.push({ mode, stage:rect(visualStage), cv:rect(cv), fx:rect(cvFx), back:rect(cvBack), three:rect(bgThreeCanvas) });
      }
      return result;
    });
    for(const row of rows){
      for(const key of ['cv','fx','back','three']){
        expect(row[key].left).toBeCloseTo(row.stage.left, 0);
        expect(row[key].top).toBeCloseTo(row.stage.top, 0);
        expect(row[key].width).toBeCloseTo(row.stage.width, 0);
        expect(row[key].height).toBeCloseTo(row.stage.height, 0);
      }
      if(row.mode==='portrait') expect(row.stage.width/row.stage.height).toBeCloseTo(9/16, 2);
      if(row.mode==='square') expect(row.stage.width/row.stage.height).toBeCloseTo(1, 2);
      if(row.mode==='landscape') expect(row.stage.width/row.stage.height).toBeCloseTo(16/9, 2);
    }
  });
});

test('Background 和 Text 即使移动到 Outline 外也会被硬裁掉', async () => {
  await withApp('canvas-boundary-clipping', async win => {
    const result = await win.evaluate(async () => {
      aspectMode = 'square'; resize();
      const source = document.createElement('canvas'); source.width=source.height=8;
      const x = source.getContext('2d'); x.fillStyle='#f00'; x.fillRect(0,0,8,8);
      loadBgImage(source.toDataURL()); await bgImageEl.decode();
      bgImageEl.style.filter='none'; bgImageEl.style.pointerEvents='auto';
      titleDisplay.textContent='CLIPPED TEXT'; titleDisplay.classList.add('show');
      titleDisplay.style.left='-80px'; titleDisplay.style.top='30px'; titleDisplay.style.bottom='auto';
      titleDisplay.style.pointerEvents='auto'; titleDisplay.dataset.positioned='1';

      const s = visualStage.getBoundingClientRect();
      const outsideX = Math.max(1, s.left-12), y = s.top+50;
      const outsideIds = document.elementsFromPoint(outsideX,y).map(el=>el.id).filter(Boolean);
      const bgRect = bgImageEl.getBoundingClientRect(), textRect = titleDisplay.getBoundingClientRect();
      return {
        stage:{left:s.left,right:s.right,top:s.top,bottom:s.bottom},
        bgExtendsOutside:bgRect.left<s.left || bgRect.right>s.right || bgRect.top<s.top || bgRect.bottom>s.bottom,
        textExtendsOutside:textRect.left<s.left,
        outsideIds
      };
    });
    expect(result.bgExtendsOutside).toBe(true);
    expect(result.textExtendsOutside).toBe(true);
    expect(result.outsideIds).not.toContain('bgImage');
    expect(result.outsideIds).not.toContain('titleDisplay');
  });
});

test('截图/录制 composite 的像素尺寸始终等于当前 Outline', async () => {
  await withApp('canvas-boundary-capture', async win => {
    const rows = await win.evaluate(() => ['free','portrait','square','landscape'].map(mode=>{
      aspectMode=mode; resize();
      const stage=visualStage.getBoundingClientRect(), out=composeCaptureFrame();
      return {mode, cssRatio:stage.width/stage.height, canvasRatio:cv.width/cv.height,
        out:[out.width,out.height], cv:[cv.width,cv.height]};
    }));
    for(const row of rows){
      expect(row.out).toEqual(row.cv);
      expect(row.canvasRatio).toBeCloseTo(row.cssRatio, 2);
    }
  });
});
