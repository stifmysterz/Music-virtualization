const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { test, expect, chromium } = require('@playwright/test');

const HTML_URL = pathToFileURL(path.join(__dirname, '..', '..', '61.html')).href;
const IMAGE = path.join(__dirname, '..', 'build', 'icon.png');

test('浏览器版 Select Folder 打开文件夹选择并开始轮播', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sub-remix-browser-folder-'));
  fs.copyFileSync(IMAGE, path.join(folder, '01.png'));
  fs.copyFileSync(IMAGE, path.join(folder, '02.png'));
  fs.writeFileSync(path.join(folder, 'ignore.txt'), 'not media');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(HTML_URL);
    await expect.poll(() => page.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);
    await page.evaluate(() => document.getElementById('intro').classList.add('hidden'));
    expect(await page.evaluate(() => !!window.subRemixDesktop)).toBe(false);

    await page.locator('#bgMenuBtn').click();
    const chooserPromise = page.waitForEvent('filechooser');
    await page.locator('#bgFolderSelectBtn').click();
    const chooser = await chooserPromise;
    await chooser.setFiles(folder);

    await expect.poll(() => page.evaluate(() => bgFolderFiles.map(file => file.name)))
      .toEqual(['01.png', '02.png']);
    await expect.poll(() => page.evaluate(() => bgFolderActive)).toBe(true);
    const result = await page.evaluate(() => ({
      folder:bgFolderPath, auto:bgFolderAuto,
      urls:bgFolderFiles.map(file => file.url.startsWith('blob:')),
      persisted:JSON.parse(localStorage.getItem(BG_FOLDER_KEY)).folder
    }));
    expect(result.folder).toBe(path.basename(folder));
    expect(result.auto).toBe(true);
    expect(result.urls).toEqual([true, true]);
    expect(result.persisted).toBe('');
  } finally {
    await browser.close();
    fs.rmSync(folder, { recursive:true, force:true });
  }
});
