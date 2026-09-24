const path = require('path');
const { pathToFileURL } = require('url');
const { test, expect, chromium } = require('@playwright/test');

const HTML_URL = pathToFileURL(path.join(__dirname, '..', '..', '61.html')).href;

async function withPage(fn){
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const page=await browser.newPage();
    await page.goto(HTML_URL);
    await expect.poll(()=>page.evaluate(()=>document.getElementById('cv').width)).toBeGreaterThan(300);
    await fn(page);
  }finally{await browser.close();}
}

test('图片在视频后方，透明度与录制图层顺序一致',async()=>{
  await withPage(async page=>{
    const result=await page.evaluate(()=>{
      const image=document.createElement('canvas');image.width=image.height=4;
      image.getContext('2d').fillStyle='#ff0000';image.getContext('2d').fillRect(0,0,4,4);
      loadBgVideo('data:video/mp4;base64,AAAA');
      loadBgUnderlay(image.toDataURL());
      const calls=[],original=drawCaptureElement;
      drawCaptureElement=(el,...args)=>{if(el===bgImageEl||el===bgVideoEl)calls.push(el.id);return original(el,...args);};
      try{composeCaptureFrame();}finally{drawCaptureElement=original;}
      return {imageDisplay:bgImageEl.style.display,videoDisplay:bgVideoEl.style.display,
        videoOpacity:bgVideoEl.style.opacity,slider:document.getElementById('bgVideoOpacitySel').value,
        calls,order:[...document.getElementById('visualStage').children].map(el=>el.id)};
    });
    expect(result.imageDisplay).toBe('block');
    expect(result.videoDisplay).toBe('block');
    expect(result.videoOpacity).toBe('0.7');
    expect(result.slider).toBe('70');
    expect(result.calls).toEqual(['bgImage','bgVideo']);
    expect(result.order.indexOf('bgImage')).toBeLessThan(result.order.indexOf('bgVideo'));
  });
});

test('文件夹轮播视频也能显示后方图片',async()=>{
  await withPage(async page=>{
    const result=await page.evaluate(()=>{
      const slot=bgFolderSlots[0];
      slot.type='video';slot.path='test.mp4';slot.el.classList.add('active');slot.el.style.display='block';
      bgFolderActive=true;hasBgMedia=true;hasBgVideo=true;
      const image=document.createElement('canvas');image.width=image.height=4;
      image.getContext('2d').fillRect(0,0,4,4);
      loadBgUnderlay(image.toDataURL());
      const calls=[],original=drawCaptureElement;
      drawCaptureElement=(el,...args)=>{if(el===bgImageEl||el===slot.video)calls.push(el.id||'playlist-video');return original(el,...args);};
      try{composeCaptureFrame();}finally{drawCaptureElement=original;}
      return {active:bgFolderActive,imageDisplay:bgImageEl.style.display,opacity:slot.video.style.opacity,calls};
    });
    expect(result).toEqual({active:true,imageDisplay:'block',opacity:'0.7',calls:['bgImage','playlist-video']});
  });
});

test('Text A/B/C 描边可调、写入预设，并进入录制帧',async()=>{
  await withPage(async page=>{
    const result=await page.evaluate(()=>{
      const styles=[];
      for(const [prefix,display] of [['title','titleDisplay'],['textA','textADisplay'],['textB','textBDisplay']]){
        const color=document.getElementById(prefix+'OutlineColor');
        const width=document.getElementById(prefix+'OutlineWidth');
        color.value='#123456';color.dispatchEvent(new Event('input'));
        width.value='4';width.dispatchEvent(new Event('input'));
        styles.push(document.getElementById(display).style.webkitTextStroke);
      }
      document.getElementById('titleIn').value='OUTLINE';
      titleDisplay.textContent='OUTLINE';titleDisplay.classList.add('show');
      const preset=getPresetState();
      document.getElementById('titleOutlineWidth').value='0';
      document.getElementById('titleOutlineWidth').dispatchEvent(new Event('input'));
      applyPresetState(preset);
      composeCaptureFrame();
      const strokes=[],original=captureCtx.strokeText;
      captureCtx.strokeText=function(...args){strokes.push({text:args[0],color:this.strokeStyle,width:this.lineWidth});return original.apply(this,args);};
      try{composeCaptureFrame();}finally{captureCtx.strokeText=original;}
      return {styles,stored:preset.textStyle.title,restored:titleDisplay.style.webkitTextStroke,strokes};
    });
    expect(result.styles).toEqual(['4px rgb(18, 52, 86)','4px rgb(18, 52, 86)','4px rgb(18, 52, 86)']);
    expect(result.stored).toMatchObject({outlineColor:'#123456',outlineWidth:'4'});
    expect(result.restored).toBe('4px rgb(18, 52, 86)');
    expect(result.strokes).toEqual(expect.arrayContaining([expect.objectContaining({text:'OUTLINE',color:'#123456',width:4})]));
  });
});
