# SUB REMIX Electron 打包实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把单文件网页应用 `61.html` 打包成一个可双击运行、可生成安装包分发的 Windows 桌面软件，功能与浏览器版完全一致。

**Architecture:** Electron 主进程加载仓库根目录的 `61.html`（不复制、不分叉）。所有新增代码集中在 `app/` 目录。对 `61.html` 本身只做两处兼容性改动：字体离线化，以及录制落盘的桌面端回退分支——两处都必须保证浏览器直接打开时行为不变。自动化验证使用 Playwright 的 Electron 驱动，跑真实的 Electron 进程。

**Tech Stack:** Electron、electron-builder、@playwright/test（Electron 模式）、Node.js 24

**Spec:** `docs/superpowers/specs/2026-08-27-electron-packaging-design.md`

## Global Constraints

以下约束适用于每一个任务，不再逐条重复：

- **仅支持 Windows。** 不做 macOS / Linux 的构建目标。
- **`61.html` 是唯一事实来源。** 禁止复制该文件到 `app/` 或任何其他位置，禁止创建第二份副本。Electron 加载仓库根目录的原文件。
- **对 `61.html` 的任何改动，必须在用浏览器直接打开该文件时依然正常工作。** 桌面端专属能力一律用特性检测（`if(window.xxx)`）包裹，不得让浏览器路径报错或改变行为。
- **不打包 ffmpeg，不做 mp4 直出。** 维持现有的 `video/webm;codecs=vp9,opus` 导出。
- **不实现预设数据迁移。** 新软件从空白 `localStorage` 开始。
- **依赖版本不写死猜测值。** 安装时一律用 `@latest`，安装后把 npm 实际解析出的版本记录进 `app/package.json`（`npm install` 会自动写入）。
- **构建产物 `dist/` 不进版本库。**
- 应用窗口标题必须是 `SUB REMIX — Music Visualizer`（来自 `61.html:13` 的 `<title>`，注意是长破折号 `—`）。

---

### Task 1: Electron 骨架与窗口启动

建立 `app/` 目录、Electron 主进程、Playwright 冒烟测试。这是后续所有任务的地基，因此把依赖安装、gitignore、测试配置全部折叠进本任务。

**Files:**
- Create: `app/package.json`（由 `npm init` 生成后编辑）
- Create: `app/main.js`
- Create: `app/tests/smoke.spec.js`
- Create: `app/playwright.config.js`
- Modify: `.gitignore`（追加 `node_modules/` 和 `dist/`）

**Interfaces:**
- Consumes: 无（首个任务）
- Produces:
  - `app/main.js` 导出的行为：启动后创建唯一一个 `BrowserWindow`，加载 `<repo>/61.html`
  - 测试辅助约定：后续任务的测试统一用 `electron.launch({ args: ['.'], cwd: <app 目录> })` 启动被测应用

- [ ] **Step 1: 初始化 app 目录与依赖**

在仓库根目录执行：

```bash
mkdir -p app/tests
cd app
npm init -y
npm install --save-dev electron@latest @playwright/test@latest
```

安装完成后编辑 `app/package.json`，把 `main`、`name`、`scripts` 改成下面这样（`devDependencies` 里 npm 已经写好的版本号原样保留，不要手改）：

```json
{
  "name": "sub-remix",
  "version": "1.0.0",
  "description": "SUB REMIX — Music Visualizer",
  "main": "main.js",
  "scripts": {
    "start": "electron .",
    "test": "playwright test"
  }
}
```

- [ ] **Step 2: 把构建产物加入 .gitignore**

在 `.gitignore` 末尾追加：

```
# Node / Electron
node_modules/
dist/
```

- [ ] **Step 3: 写 Playwright 配置**

创建 `app/playwright.config.js`：

```js
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  // Electron 应用启动 + WebGL 初始化比普通网页慢，给足超时
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // Electron 测试共用同一个用户数据目录，并行会互相打架
  workers: 1,
  reporter: 'list',
});
```

- [ ] **Step 4: 写失败的冒烟测试**

创建 `app/tests/smoke.spec.js`：

```js
const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');

const APP_DIR = path.join(__dirname, '..');

test('应用启动后打开窗口，标题正确，画布存在', async () => {
  const app = await electron.launch({ args: ['.'], cwd: APP_DIR });
  const win = await app.firstWindow();

  await expect.poll(() => win.title()).toBe('SUB REMIX — Music Visualizer');

  // cv 是主可视化画布，bgThree 是 3D 背景画布（61.html 中的两个 canvas）
  await expect(win.locator('#cv')).toHaveCount(1);
  await expect(win.locator('#bgThree')).toHaveCount(1);

  await app.close();
});

test('渲染循环真的在跑（画布尺寸被 resize() 设置过）', async () => {
  const app = await electron.launch({ args: ['.'], cwd: APP_DIR });
  const win = await app.firstWindow();

  // resize() 会把 canvas 的 width/height 设成实际像素尺寸；
  // 若脚本崩在前面，canvas 会停留在默认的 300x150
  //
  // firstWindow() 在 61.html 的内联脚本（2MB，含内联 THREE.js）执行完之前就 resolve，
  // 所以必须像上一条用例对 title 那样先 poll 等 resize() 跑完，否则会稳定读到默认值 300。
  // 这不是放宽断言——下面的阈值和原来一样，resize() 真没跑时 poll 会超时失败。
  await expect.poll(() => win.evaluate(() => document.getElementById('cv').width)).toBeGreaterThan(300);

  const size = await win.evaluate(() => {
    const c = document.getElementById('cv');
    return { w: c.width, h: c.height };
  });
  expect(size.w).toBeGreaterThan(300);
  expect(size.h).toBeGreaterThan(150);

  await app.close();
});

test('页面加载过程中没有 JS 异常', async () => {
  const app = await electron.launch({ args: ['.'], cwd: APP_DIR });
  const win = await app.firstWindow();

  const errors = [];
  win.on('pageerror', e => errors.push(e.message));
  // 给渲染循环跑几帧的时间，捕捉初始化之后才抛出的错误
  await win.waitForTimeout(3000);

  expect(errors).toEqual([]);
  await app.close();
});
```

- [ ] **Step 5: 跑测试确认失败**

```bash
cd app && npx playwright test
```

预期：全部失败，因为 `main.js` 还不存在，Electron 无法启动。

- [ ] **Step 6: 写 main.js**

创建 `app/main.js`：

```js
const { app, BrowserWindow } = require('electron');
const path = require('path');

// 61.html 位于仓库根目录，即 app/ 的上一级。
// 这里刻意不复制该文件——它是唯一事实来源。
const HTML_PATH = path.join(__dirname, '..', '61.html');

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    backgroundColor: '#000000',   // 避免启动瞬间的白屏闪烁
    autoHideMenuBar: true,        // 隐藏 Electron 默认菜单栏，应用自带控制条
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  win.loadFile(HTML_PATH);
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
```

- [ ] **Step 7: 跑测试确认通过**

```bash
cd app && npx playwright test
```

预期：3 个测试全部 PASS。

若「没有 JS 异常」这条失败，把实际的报错信息读出来再定位——这通常意味着 `61.html` 里有代码依赖了 `file://` 下不可用的东西，属于真实发现，需要如实记录后再修，不要靠放宽断言让它变绿。

- [ ] **Step 8: 手工看一眼**

```bash
cd app && npm start
```

确认窗口打开、可视化在动、底部控制条可以点开。看完关掉。

- [ ] **Step 9: 提交**

```bash
git add .gitignore app/package.json app/package-lock.json app/main.js app/playwright.config.js app/tests/smoke.spec.js
git commit -m "Add Electron shell that loads 61.html, with Playwright smoke tests"
```

---

### Task 2: localStorage 跨重启持久化

`61.html` 的语言、reactivity、收藏、最近模式、预设（`PRESET_PREFIX`）、自动保存（`AUTOSAVE_KEY`）全部依赖 `localStorage`。Chromium 对 `file://` 源的存储有历史包袱，必须实测确认数据能跨进程重启存活，并留下回归测试守住它。

**Files:**
- Create: `app/tests/persistence.spec.js`
- Modify: `app/main.js`（仅当 Step 3 判定持久化失败时）

**Interfaces:**
- Consumes: Task 1 的 `app/main.js`、Playwright 启动约定
- Produces: 确认后续任务可以安全依赖 `localStorage`（预设/设置功能可用）

- [ ] **Step 1: 写失败的持久化测试**

创建 `app/tests/persistence.spec.js`：

```js
const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');

const APP_DIR = path.join(__dirname, '..');

test('localStorage 写入的值能跨应用重启存活', async () => {
  const KEY = 'subremix_e2e_probe';
  const VALUE = 'persisted-' + Date.now();

  // 第一次启动：写入
  const app1 = await electron.launch({ args: ['.'], cwd: APP_DIR });
  const win1 = await app1.firstWindow();
  await win1.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, VALUE]);
  // 确认当前会话内确实写进去了（file:// 下 localStorage 可能整个不可用）
  const immediate = await win1.evaluate(k => localStorage.getItem(k), KEY);
  expect(immediate).toBe(VALUE);
  await app1.close();

  // 第二次启动：读回
  const app2 = await electron.launch({ args: ['.'], cwd: APP_DIR });
  const win2 = await app2.firstWindow();
  const readBack = await win2.evaluate(k => localStorage.getItem(k), KEY);
  await win2.evaluate(k => localStorage.removeItem(k), KEY);   // 清理探针
  await app2.close();

  expect(readBack).toBe(VALUE);
});

test('应用自身的语言设置能跨重启存活', async () => {
  // 走真实代码路径：applyLanguage() 会写 subremix_lang（61.html:5674）
  const app1 = await electron.launch({ args: ['.'], cwd: APP_DIR });
  const win1 = await app1.firstWindow();
  await win1.evaluate(() => applyLanguage('zh'));
  await app1.close();

  const app2 = await electron.launch({ args: ['.'], cwd: APP_DIR });
  const win2 = await app2.firstWindow();
  const lang = await win2.evaluate(() => localStorage.getItem('subremix_lang'));
  await win2.evaluate(() => applyLanguage('en'));   // 还原，避免影响后续测试
  await app2.close();

  expect(lang).toBe('zh');
});
```

注意：第二个测试假设 `61.html` 里 `applyLanguage` 是全局函数且支持 `'zh'`。跑之前先确认——若语言代码不是 `'zh'`，去 `61.html` 的 `UI_STRINGS` 定义处查实际使用的键名，用真实值替换，不要改成断言别的东西。

- [ ] **Step 2: 跑测试**

```bash
cd app && npx playwright test tests/persistence.spec.js
```

- [ ] **Step 3: 判定结果并处理**

**情况 A —— 测试通过：** `file://` 下持久化正常，`main.js` 不需要任何改动。测试本身作为回归守卫保留。直接跳到 Step 4。

**情况 B —— 测试失败：** 说明 `file://` 源的存储不可靠。改用自定义协议给页面一个稳定的源。修改 `app/main.js`：

把顶部的 require 改成：

```js
const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('path');
const url = require('url');

const ROOT_DIR = path.join(__dirname, '..');
```

在 `createWindow` 之前加入协议注册（`app.whenReady()` 之前必须先声明特权）：

```js
// 给页面一个稳定的、非 file:// 的源，让 localStorage 等存储 API 行为与普通网页一致
protocol.registerSchemesAsPrivileged([{
  scheme: 'subremix',
  privileges: { standard: true, secure: true, supportFetchAPI: true },
}]);

function registerProtocol() {
  protocol.handle('subremix', (request) => {
    const { pathname } = new URL(request.url);
    const decoded = decodeURIComponent(pathname);
    const filePath = path.join(ROOT_DIR, decoded === '/' ? '61.html' : decoded);
    return net.fetch(url.pathToFileURL(filePath).toString());
  });
}
```

把 `win.loadFile(HTML_PATH)` 换成：

```js
  win.loadURL('subremix://app/61.html');
```

并在 `app.whenReady().then(...)` 里，`createWindow()` 之前调用 `registerProtocol()`。

改完重跑 Step 2 的命令，确认两个测试都变绿。

- [ ] **Step 4: 确认没有破坏 Task 1 的测试**

```bash
cd app && npx playwright test
```

预期：全部 5 个测试 PASS。

- [ ] **Step 5: 提交**

```bash
git add app/tests/persistence.spec.js app/main.js
git commit -m "Verify localStorage survives app restart, with regression tests"
```

---

### Task 3: 字体离线化

`61.html:14-16` 从 `fonts.googleapis.com` 加载 10 种字体。打包成离线软件后无网络即全部回退默认字体。把字体文件下载到本地并改为 `@font-face` 引用。

需要的字体与字重（直接来自 `61.html:16` 的 URL）：

| 字体 | 字重 |
|---|---|
| Orbitron | 500, 800 |
| Audiowide | 400 |
| Oxanium | 500, 800 |
| Exo 2 | 500, 800 |
| Rajdhani | 500, 700 |
| Michroma | 400 |
| Space Grotesk | 500, 700 |
| Chakra Petch | 500, 700 |
| Bebas Neue | 400 |
| Teko | 500, 700 |

共 17 个「字体 + 字重」组合。实际下载的 `.woff2` 文件数会多于 17，因为 `latin` 与 `latin-ext` 是分开的子集文件。

**Files:**
- Create: `app/scripts/fetch-fonts.js`（一次性下载脚本，产物提交进库）
- Create: `fonts/`（仓库根目录，若干 `.woff2` + 生成的 `fonts.css`）
- Modify: `61.html:14-16`
- Create: `app/tests/fonts.spec.js`

**Interfaces:**
- Consumes: Task 1 的 Electron 启动约定
- Produces: 根目录 `fonts/fonts.css`，被 `61.html` 以相对路径 `fonts/fonts.css` 引用

- [ ] **Step 1: 写失败的字体测试**

创建 `app/tests/fonts.spec.js`：

```js
const fs = require('fs');
const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');

const APP_DIR = path.join(__dirname, '..');
const ROOT_DIR = path.join(APP_DIR, '..');

// 字重必须与 61.html:16 原本请求的完全一致——
// 用一个该字体并不存在的字重去 check()，会得到假阴性。
const FAMILIES = [
  { name: 'Orbitron',      weights: [500, 800] },
  { name: 'Audiowide',     weights: [400] },
  { name: 'Oxanium',       weights: [500, 800] },
  { name: 'Exo 2',         weights: [500, 800] },
  { name: 'Rajdhani',      weights: [500, 700] },
  { name: 'Michroma',      weights: [400] },
  { name: 'Space Grotesk', weights: [500, 700] },
  { name: 'Chakra Petch',  weights: [500, 700] },
  { name: 'Bebas Neue',    weights: [400] },
  { name: 'Teko',          weights: [500, 700] },
];

test('61.html 不再引用任何在线字体服务', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, '61.html'), 'utf8');
  expect(html).not.toContain('fonts.googleapis.com');
  expect(html).not.toContain('fonts.gstatic.com');
});

test('每种字体的每个字重都有对应的本地文件', () => {
  const css = fs.readFileSync(path.join(ROOT_DIR, 'fonts', 'fonts.css'), 'utf8');

  // 逐个 @font-face 块解析出 (family, 字重范围, 文件名)。
  // Google 对可变字体可能输出 `font-weight: 500 800;` 这样的区间，
  // 对静态字体输出单个数值——两种都要能解析。
  const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(m => {
    const body = m[1];
    const family = (body.match(/font-family:\s*['"]([^'"]+)['"]/) || [])[1];
    const wRaw = (body.match(/font-weight:\s*([\d\s]+);/) || [])[1] || '400';
    const nums = wRaw.trim().split(/\s+/).map(Number);
    const file = (body.match(/url\(([^)]+)\)/) || [])[1];
    return {
      family,
      min: nums[0],
      max: nums.length > 1 ? nums[1] : nums[0],
      file: (file || '').replace(/['"]/g, ''),
    };
  });

  for (const { name, weights } of FAMILIES) {
    for (const w of weights) {
      const match = faces.find(f => f.family === name && w >= f.min && w <= f.max);
      expect(match, `缺少字体 ${name} ${w}`).toBeTruthy();

      const size = fs.statSync(path.join(ROOT_DIR, 'fonts', match.file)).size;
      // 真实的 woff2 子集至少几 KB；几百字节说明下到的是错误页
      expect(size, `${match.file} 太小，可能不是有效字体`).toBeGreaterThan(2000);
    }
  }
});

test('10 种字体在应用中全部实际加载成功', async () => {
  const app = await electron.launch({ args: ['.'], cwd: APP_DIR });
  const win = await app.firstWindow();

  const missing = await win.evaluate(async (families) => {
    await document.fonts.ready;
    const bad = [];
    for (const { name, weights } of families) {
      for (const w of weights) {
        if (!document.fonts.check(`${w} 16px "${name}"`)) bad.push(`${name} ${w}`);
      }
    }
    return bad;
  }, FAMILIES);

  await app.close();
  expect(missing).toEqual([]);
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd app && npx playwright test tests/fonts.spec.js
```

预期：三个测试全部 FAIL（`61.html` 仍含 googleapis、`fonts/` 目录不存在、字体未本地加载）。

- [ ] **Step 3: 写下载脚本**

创建 `app/scripts/fetch-fonts.js`：

```js
// 一次性脚本：从 Google Fonts 拉取所需字重的 woff2 到 <repo>/fonts/，
// 并生成一份把远程 URL 改写为本地相对路径的 fonts.css。
// 产物提交进版本库，因此正常开发流程不需要重复运行本脚本。
const fs = require('fs');
const path = require('path');

const CSS_URL = 'https://fonts.googleapis.com/css2?family=Orbitron:wght@500;800&family=Audiowide&family=Oxanium:wght@500;800&family=Exo+2:wght@500;800&family=Rajdhani:wght@500;700&family=Michroma&family=Space+Grotesk:wght@500;700&family=Chakra+Petch:wght@500;700&family=Bebas+Neue&family=Teko:wght@500;700&display=swap';

// Google Fonts 会按 User-Agent 返回不同格式；这个 UA 能拿到 woff2
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const OUT_DIR = path.join(__dirname, '..', '..', 'fonts');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const res = await fetch(CSS_URL, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`拉取字体 CSS 失败: ${res.status}`);
  let css = await res.text();

  // 只保留 latin 子集，避免下载几十个语种分片
  const blocks = css.split('/*').filter(b => b.startsWith(' latin ') || b.startsWith(' latin-ext '));
  if (blocks.length === 0) throw new Error('CSS 里没找到 latin 子集，Google 可能改了输出格式');
  css = blocks.map(b => '/*' + b).join('');

  const urls = [...css.matchAll(/url\((https:\/\/[^)]+\.woff2)\)/g)].map(m => m[1]);
  const unique = [...new Set(urls)];
  console.log(`发现 ${unique.length} 个字体文件`);

  for (const u of unique) {
    // 用 family + weight 命名，而不是 Google 的哈希文件名，方便人眼核对
    const name = path.basename(new URL(u).pathname);
    const dest = path.join(OUT_DIR, name);
    const r = await fetch(u, { headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error(`下载 ${u} 失败: ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 2000) throw new Error(`${name} 只有 ${buf.length} 字节，不像有效字体`);
    fs.writeFileSync(dest, buf);
    css = css.split(u).join(name);   // 远程 URL 改写为同目录下的相对文件名
    console.log(`  ${name}  ${(buf.length / 1024).toFixed(1)} KB`);
  }

  fs.writeFileSync(path.join(OUT_DIR, 'fonts.css'), css, 'utf8');
  console.log(`\n已写出 ${path.join(OUT_DIR, 'fonts.css')}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
```

- [ ] **Step 4: 运行下载脚本**

```bash
cd app && node scripts/fetch-fonts.js
```

预期：打印出下载的文件清单，最后写出 `fonts/fonts.css`。

文件总数不固定（`latin` 与 `latin-ext` 两个子集会让部分字体产生多个文件），所以测试断言的是「每种字体的每个字重都有对应文件」而不是总数——不需要根据下载结果去调整测试。

若脚本报错「CSS 里没找到 latin 子集」，说明 Google 改了输出格式，打开 `CSS_URL` 看一眼实际返回的 CSS 再调整过滤条件。

- [ ] **Step 5: 修改 61.html**

把 `61.html` 第 14-16 行这三行：

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@500;800&family=Audiowide&family=Oxanium:wght@500;800&family=Exo+2:wght@500;800&family=Rajdhani:wght@500;700&family=Michroma&family=Space+Grotesk:wght@500;700&family=Chakra+Petch:wght@500;700&family=Bebas+Neue&family=Teko:wght@500;700&display=swap" rel="stylesheet">
```

整体替换为一行：

```html
<link href="fonts/fonts.css" rel="stylesheet">
```

相对路径在浏览器直接打开和 Electron 中都能正确解析到仓库根目录下的 `fonts/`。

- [ ] **Step 6: 跑测试确认通过**

```bash
cd app && npx playwright test tests/fonts.spec.js
```

预期：3 个测试 PASS。

- [ ] **Step 7: 确认浏览器路径没被破坏**

在浏览器中直接打开 `61.html`，打开文字面板，把字体切到 Orbitron、Bebas Neue、Michroma 各看一次，确认样式正确、不是回退字体。这一步验证 Global Constraints 里「浏览器路径必须不变」这条。

- [ ] **Step 8: 跑全部测试**

```bash
cd app && npx playwright test
```

预期：全部 8 个测试 PASS。

- [ ] **Step 9: 提交**

```bash
git add 61.html fonts/ app/scripts/fetch-fonts.js app/tests/fonts.spec.js
git commit -m "Bundle fonts locally so the packaged app renders correctly offline"
```

---

### Task 4: 判定 showSaveFilePicker 在 Electron 中是否可用

这是 spec 第 5.2 节标记的最大风险点。`61.html:19939` 优先走 `window.showSaveFilePicker` 边录边写磁盘；不可用时静默回退到内存累积，按 30Mbps 计 5 分钟约吃 1.1GB 内存。本任务的产出是一个**明确的事实判定**，决定 Task 5 是否需要执行。

**Files:**
- Create: `app/tests/recording-api.spec.js`
- Modify: `docs/superpowers/plans/2026-08-27-electron-packaging.md`（把判定结果写进 Task 5 开头）

**Interfaces:**
- Consumes: Task 1 的 Electron 启动约定
- Produces: 判定结论 —— Task 5 执行或跳过的依据

- [ ] **Step 1: 写探测测试**

创建 `app/tests/recording-api.spec.js`：

```js
const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');

const APP_DIR = path.join(__dirname, '..');

// showSaveFilePicker 的有无是本任务要查明的事实，因此不对它断言，只打印。
// 但 captureStream 和 WebM 编码是录制功能的硬前提——它们必须成立，所以断言。
test('探测录制相关 API 在 Electron 渲染进程中的可用性', async () => {
  const app = await electron.launch({ args: ['.'], cwd: APP_DIR });
  const win = await app.firstWindow();

  const caps = await win.evaluate(() => ({
    showSaveFilePicker: typeof window.showSaveFilePicker,
    MediaRecorder: typeof window.MediaRecorder,
    captureStream: typeof document.createElement('canvas').captureStream,
    vp9Opus: window.MediaRecorder
      ? MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      : null,
    webm: window.MediaRecorder
      ? MediaRecorder.isTypeSupported('video/webm')
      : null,
  }));

  console.log('\n===== 录制能力探测结果 =====');
  console.log(JSON.stringify(caps, null, 2));
  console.log('============================\n');

  await app.close();

  // 录制功能的硬前提：这两条不成立的话，问题比 spec 5.2 严重得多
  expect(caps.captureStream, 'canvas.captureStream 不可用，录制无法工作').toBe('function');
  expect(caps.MediaRecorder, 'MediaRecorder 不可用，录制无法工作').toBe('function');
  expect(
    caps.vp9Opus || caps.webm,
    'Electron 不支持任何 WebM 编码，录制无法出片'
  ).toBe(true);

  // showSaveFilePicker 刻意不断言——它的取值就是本任务要查明的事实
});
```

- [ ] **Step 2: 运行探测**

```bash
cd app && npx playwright test tests/recording-api.spec.js
```

- [ ] **Step 3: 记录判定结果**

把上一步打印出的 JSON 原样贴进本计划文件 Task 5 开头的「判定结果」处，并按下面的规则得出结论：

- `showSaveFilePicker` 为 `"function"` → **Task 5 跳过**。现有代码在 Electron 中会走磁盘流式写入，内存平坦，无需改动。
- `showSaveFilePicker` 为 `"undefined"` → **Task 5 必须执行**。

`captureStream` 与 WebM 编码的硬前提已由测试断言守住——若测试直接失败，说明录制在 Electron 中根本不能工作，这是比 spec 5.2 更严重的问题，停下来如实报告，不要继续往下做。

- [ ] **Step 4: 提交**

```bash
git add app/tests/recording-api.spec.js docs/superpowers/plans/2026-08-27-electron-packaging.md
git commit -m "Probe recording API availability in the Electron renderer"
```

---

### Task 5: 录制落盘回退通道 —— 已跳过（不执行）

> **本任务仅当 Task 4 判定 `showSaveFilePicker` 不可用时才需要执行。Task 4 的实测判定为「可用」，因此本任务整体跳过，不产生任何代码改动，直接进入 Task 6。** 下方 Steps 1-9 是跳过前保留下来的原始设计记录，不是待办事项——见 Steps 前后的分隔提示。

**判定结果：** `showSaveFilePicker` 为 `"function"` —— typeof 检测确认该函数在 Electron 44.0.0 渲染进程中存在（重复运行两次，结果一致）。**Task 5 跳过**，直接进入 Task 6。现有代码在 Electron 中预期会走 `window.showSaveFilePicker` 磁盘流式写入分支，内存预期平坦，无需改动。

补充确认（会话外，不属于本任务提交的自动化测试产物）：coordinator 在独立会话中直接调用了 `window.showSaveFilePicker()`（无用户手势触发），观察到弹出了真实的原生保存对话框并阻塞等待，而不是抛错或空操作返回——这证实该函数不是一个仅在 `typeof` 上报 `"function"` 的桩实现，是可调用的真实实现。

`app/tests/recording-api.spec.js` 打印的原始 JSON：

```json
{
  "showSaveFilePicker": "function",
  "MediaRecorder": "function",
  "captureStream": "function",
  "vp9Opus": true,
  "webm": true
}
```

原始任务描述（历史记录，跳过后未执行）：通过 preload 暴露一个最小的落盘通道，用 Electron 原生保存对话框 + Node 流式写入，恢复「边录边写、内存不增长」的现有行为。

**Files:**
- Create: `app/preload.js`
- Modify: `app/main.js`（注册 preload、增加三个 IPC handler）
- Modify: `61.html:19937-19978`（增加桌面端分支）
- Create: `app/tests/recording-write.spec.js`

**Interfaces:**
- Consumes: Task 1 的 `app/main.js`、Task 4 的判定结果
- Produces: 渲染进程全局对象 `window.desktopRecorder`，三个方法：
  - `begin(suggestedName: string) => Promise<{ok: boolean, path?: string}>` —— 弹原生保存对话框；用户取消返回 `{ok:false}`
  - `write(bytes: Uint8Array) => Promise<void>` —— 追加写入
  - `end() => Promise<void>` —— 关闭写入流

---
> ⚠️ **以下 Step 1-9 未执行，仅作记录保留（Task 4 判定 `showSaveFilePicker` 可用，本任务被跳过）。**
> 所有复选框已标记为 `[x]` 并附「已跳过」标注，防止被按复选框驱动的执行流程误认成待办项。
---

- [x] **Step 1: 写失败的落盘测试**（已跳过，未执行——仅作记录保留）

创建 `app/tests/recording-write.spec.js`：

```js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');

const APP_DIR = path.join(__dirname, '..');

test('desktopRecorder 能把分块数据流式写入磁盘', async () => {
  const app = await electron.launch({ args: ['.'], cwd: APP_DIR });
  const win = await app.firstWindow();

  const target = path.join(os.tmpdir(), `subremix-test-${Date.now()}.webm`);

  // 绕过原生对话框：测试时直接指定目标路径。
  // main.js 里 begin() 的第二个参数仅供测试使用，正常运行时不传。
  const started = await win.evaluate(
    p => window.desktopRecorder.begin('ignored.webm', p),
    target
  );
  expect(started.ok).toBe(true);

  await win.evaluate(async () => {
    await window.desktopRecorder.write(new Uint8Array([1, 2, 3]));
    await window.desktopRecorder.write(new Uint8Array([4, 5]));
    await window.desktopRecorder.end();
  });

  await app.close();

  const written = fs.readFileSync(target);
  expect([...written]).toEqual([1, 2, 3, 4, 5]);
  fs.unlinkSync(target);
});

test('用户取消保存对话框时 begin 返回 ok:false', async () => {
  const app = await electron.launch({ args: ['.'], cwd: APP_DIR });
  const win = await app.firstWindow();

  // 传空字符串作为测试路径，约定为「模拟用户取消」
  const started = await win.evaluate(() => window.desktopRecorder.begin('x.webm', ''));
  expect(started.ok).toBe(false);

  await app.close();
});
```

- [x] **Step 2: 跑测试确认失败**（已跳过，未执行——仅作记录保留）
```bash
cd app && npx playwright test tests/recording-write.spec.js
```

预期：FAIL，`window.desktopRecorder` 未定义。

- [x] **Step 3: 写 preload.js**（已跳过，未执行——仅作记录保留）
创建 `app/preload.js`：

```js
const { contextBridge, ipcRenderer } = require('electron');

// 桌面端专属的录制落盘通道。浏览器中不存在这个对象，
// 61.html 用特性检测决定是否使用它。
contextBridge.exposeInMainWorld('desktopRecorder', {
  // testPath 仅供自动化测试传入以绕过原生对话框；正常运行时省略
  begin: (suggestedName, testPath) => ipcRenderer.invoke('rec:begin', suggestedName, testPath),
  write: (bytes) => ipcRenderer.invoke('rec:write', bytes),
  end: () => ipcRenderer.invoke('rec:end'),
});
```

- [x] **Step 4: 在 main.js 中接上 IPC**（已跳过，未执行——仅作记录保留）
在 `app/main.js` 顶部的 require 中**追加** `dialog`、`ipcMain`，并新增 `fs`。

注意：这里是**往现有解构里加名字，不是整行替换**。Task 2 若走了情况 B，该行已经含有 `protocol, net`，整行替换会把它们丢掉，导致启动即报 `protocol is not defined`。

- 若 Task 2 走了情况 A（未改 main.js），改成：

```js
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
```

- 若 Task 2 走了情况 B（自定义协议），改成：

```js
const { app, BrowserWindow, protocol, net, dialog, ipcMain } = require('electron');
```

两种情况都在文件顶部新增一行：

```js
const fs = require('fs');
```

在 `createWindow` 的 `webPreferences` 中加入 preload：

```js
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
```

在文件末尾加入 IPC handler：

```js
// 录制落盘：主进程持有写入流，渲染进程按块投递数据。
// 这样内存不会随录制时长增长——与浏览器里 showSaveFilePicker 的行为一致。
let recStream = null;

ipcMain.handle('rec:begin', async (event, suggestedName, testPath) => {
  let target;
  if (testPath !== undefined) {
    // 自动化测试路径：空字符串表示模拟用户取消
    if (testPath === '') return { ok: false };
    target = testPath;
  } else {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showSaveDialog(win, {
      defaultPath: suggestedName,
      filters: [{ name: 'WebM video', extensions: ['webm'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false };
    target = result.filePath;
  }

  recStream = fs.createWriteStream(target);
  return { ok: true, path: target };
});

ipcMain.handle('rec:write', async (_event, bytes) => {
  if (!recStream) return;
  await new Promise((resolve, reject) => {
    recStream.write(Buffer.from(bytes), err => (err ? reject(err) : resolve()));
  });
});

ipcMain.handle('rec:end', async () => {
  if (!recStream) return;
  await new Promise(resolve => recStream.end(resolve));
  recStream = null;
});
```

- [x] **Step 5: 跑测试确认通过**（已跳过，未执行——仅作记录保留）
```bash
cd app && npx playwright test tests/recording-write.spec.js
```

预期：2 个测试 PASS。

- [x] **Step 6: 在 61.html 中接入桌面通道**（已跳过，未执行——仅作记录保留）
**关于行号：** Task 3 把 `61.html` 第 14-16 行换成了 1 行，因此下面提到的所有行号都会**向前偏移 2 行**。行号仅供大致定位，**以引用的代码原文作为唯一锚点**——按原文精确匹配，不要按行号盲改。

修改 `61.html`。把第 19918 行（实际约 19916 行）：

```js
let fileWritable = null, usingFileSystemWrite = false;
```

改为：

```js
let fileWritable = null, usingFileSystemWrite = false, usingDesktopWrite = false;
```

把第 19937-19948 行这一段：

```js
  usingFileSystemWrite = false;
  fileWritable = null;
  if(window.showSaveFilePicker){
    try{
      const handle = await window.showSaveFilePicker({
        suggestedName: `sub-remix-${Date.now()}.webm`,
        types: [{ description:'WebM video', accept:{'video/webm':['.webm']} }]
      });
      fileWritable = await handle.createWritable();
      usingFileSystemWrite = true;
    }catch(e){ usingFileSystemWrite = false; }   // user cancelled the picker — fall back
  }
```

改为：

```js
  usingFileSystemWrite = false;
  usingDesktopWrite = false;
  fileWritable = null;
  if(window.showSaveFilePicker){
    try{
      const handle = await window.showSaveFilePicker({
        suggestedName: `sub-remix-${Date.now()}.webm`,
        types: [{ description:'WebM video', accept:{'video/webm':['.webm']} }]
      });
      fileWritable = await handle.createWritable();
      usingFileSystemWrite = true;
    }catch(e){ usingFileSystemWrite = false; }   // user cancelled the picker — fall back
  }else if(window.desktopRecorder){
    // desktop build: Electron has no showSaveFilePicker, so stream to disk
    // through the main process instead — keeps memory flat exactly like the browser path
    try{
      const r = await window.desktopRecorder.begin(`sub-remix-${Date.now()}.webm`);
      usingDesktopWrite = !!(r && r.ok);
    }catch(e){ usingDesktopWrite = false; }
  }
```

把第 19956-19964 行的 `ondataavailable`：

```js
  mediaRecorder.ondataavailable = async e=>{
    if(!e.data || e.data.size===0) return;
    if(usingFileSystemWrite && fileWritable){
      try{ await fileWritable.write(e.data); }
      catch(err){ console.error('disk write failed:', err); }
    }else{
      recordedChunks.push(e.data);
    }
  };
```

改为：

```js
  mediaRecorder.ondataavailable = async e=>{
    if(!e.data || e.data.size===0) return;
    if(usingFileSystemWrite && fileWritable){
      try{ await fileWritable.write(e.data); }
      catch(err){ console.error('disk write failed:', err); }
    }else if(usingDesktopWrite){
      try{ await window.desktopRecorder.write(new Uint8Array(await e.data.arrayBuffer())); }
      catch(err){ console.error('desktop disk write failed:', err); }
    }else{
      recordedChunks.push(e.data);
    }
  };
```

把第 19965-19977 行的 `onstop` 中的分支：

```js
    if(usingFileSystemWrite && fileWritable){
      try{ await fileWritable.close(); } catch(e){ console.error('file close failed:', e); }
      fileWritable = null;
    }else{
```

改为：

```js
    if(usingFileSystemWrite && fileWritable){
      try{ await fileWritable.close(); } catch(e){ console.error('file close failed:', e); }
      fileWritable = null;
    }else if(usingDesktopWrite){
      try{ await window.desktopRecorder.end(); } catch(e){ console.error('desktop file close failed:', e); }
      usingDesktopWrite = false;
    }else{
```

- [x] **Step 7: 跑全部测试**（已跳过，未执行——仅作记录保留）
```bash
cd app && npx playwright test
```

预期：全部测试 PASS。

- [x] **Step 8: 确认浏览器路径没被破坏**（已跳过，未执行——仅作记录保留）
在浏览器中直接打开 `61.html`，录一段 10 秒的视频。浏览器有 `showSaveFilePicker`，应当照常弹出保存对话框并正常出片——`window.desktopRecorder` 在浏览器中不存在，新分支不会被走到。

- [x] **Step 9: 提交**（已跳过，未执行——仅作记录保留）
```bash
git add app/preload.js app/main.js app/tests/recording-write.spec.js 61.html
git commit -m "Stream recordings to disk in the desktop build to keep memory flat"
```

---
> ⚠️ **以上 Task 5 的 Step 1-9 到此结束，均未执行——仅作跳过前的记录保留。Task 4 的实测判定 `showSaveFilePicker` 可用，因此本任务全程跳过。**
---

### Task 6: 应用图标与 Windows 安装包

用 electron-builder 生成 NSIS 安装包。图标、构建配置、产物校验折叠进本任务。

**Files:**
- Create: `app/build/icon.ico`
- Modify: `app/package.json`（加入 `build` 配置与 `dist` 脚本）
- Create: `app/tests/build-output.spec.js`

**Interfaces:**
- Consumes: 前序任务产出的完整可运行应用
- Produces: `dist/` 下的 Windows 安装包

- [ ] **Step 1: 准备图标**

需要一个 256×256 的 `.ico` 文件放在 `app/build/icon.ico`。

electron-builder 要求 `.ico` 至少 256×256，否则构建报错。若手头没有现成图标，先向用户索取一张 512×512 的 PNG，再转换；**不要**自己生成一个占位图标就往下走——图标是用户可见的产品面孔，应当由用户决定。

拿到 PNG 后转换（`png-to-ico` 会自动生成多尺寸）：

```bash
cd app && npx png-to-ico <用户提供的图片路径> > build/icon.ico
```

确认产物大于 10KB：

```bash
ls -la app/build/icon.ico
```

- [ ] **Step 2: 安装 electron-builder**

```bash
cd app && npm install --save-dev electron-builder@latest
```

- [ ] **Step 3: 配置构建**

编辑 `app/package.json`，在 `scripts` 中加入 `dist`：

```json
  "scripts": {
    "start": "electron .",
    "test": "playwright test",
    "dist": "electron-builder --win"
  },
```

并在顶层加入 `build` 配置块：

```json
  "build": {
    "appId": "com.subremix.visualizer",
    "productName": "SUB REMIX",
    "directories": {
      "output": "../dist",
      "buildResources": "build"
    },
    "files": [
      "main.js",
      "preload.js",
      "package.json"
    ],
    "extraResources": [
      { "from": "../61.html", "to": "app/61.html" },
      { "from": "../fonts", "to": "app/fonts" }
    ],
    "win": {
      "target": "nsis",
      "icon": "build/icon.ico"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true
    }
  }
```

两点说明：

- `files` 只包含 `app/` 内的文件；`61.html` 和 `fonts/` 在仓库中位于 `app/` 之外，所以通过 `extraResources` 打进去。若 Task 5 被跳过导致 `preload.js` 不存在，electron-builder 会忽略该条目，`files` 无需改动。
- `extraResources` 把 `61.html` 复制进**安装包**，这不违反全局约束「61.html 是唯一事实来源」——该约束禁止的是版本库中出现第二份源文件，而 `dist/` 是构建产物且已被 gitignore。

- [ ] **Step 4: 让 main.js 同时适配开发与打包两种路径**

打包后 `61.html` 位于 `process.resourcesPath/app/61.html`，开发时位于 `__dirname/../61.html`。修改 `app/main.js` 中 `HTML_PATH` 的定义：

```js
// 开发时 61.html 在仓库根目录；打包后由 extraResources 放进 resources/app/
const HTML_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'app', '61.html')
  : path.join(__dirname, '..', '61.html');
```

若 Task 2 走了情况 B（自定义协议），则同样修改 `ROOT_DIR`：

```js
const ROOT_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'app')
  : path.join(__dirname, '..');
```

两个常量都**留在模块顶层**，不要移进函数——`app.isPackaged` 在主进程模块加载时即可读取，而情况 B 的 `registerProtocol()` 在模块层就需要用到 `ROOT_DIR`。

- [ ] **Step 5: 确认开发模式仍然正常**

```bash
cd app && npx playwright test
```

预期：全部测试 PASS（这一步验证 Step 4 的路径改动没有破坏开发模式）。

- [ ] **Step 6: 写构建产物校验测试**

创建 `app/tests/build-output.spec.js`：

```js
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const DIST = path.join(__dirname, '..', '..', 'dist');

// 这两个测试是构建后校验，只在跑过 `npm run dist` 之后才有意义。
// 未构建时条件跳过——被明确报告为「跳过」，不会让全量测试误红，
// 也不会伪装成通过。
test.skip(() => !fs.existsSync(DIST), '尚未构建，先跑 npm run dist');

test('Windows 安装包已生成且体积合理', () => {
  const installers = fs.readdirSync(DIST).filter(f => f.endsWith('.exe'));
  expect(installers.length).toBeGreaterThan(0);

  const size = fs.statSync(path.join(DIST, installers[0])).size;
  // Electron 应用装完带 Chromium，安装包通常 60MB 以上；
  // 明显偏小说明 61.html 或 fonts 没被打进去
  expect(size).toBeGreaterThan(50 * 1024 * 1024);
});

test('打包资源中包含 61.html 与字体', () => {
  const unpacked = path.join(DIST, 'win-unpacked', 'resources', 'app');
  expect(fs.existsSync(path.join(unpacked, '61.html'))).toBe(true);
  expect(fs.existsSync(path.join(unpacked, 'fonts'))).toBe(true);
});
```

- [ ] **Step 7: 构建**

```bash
cd app && npm run dist
```

首次运行会下载 Electron 的 Windows 二进制与 NSIS 工具，需要一些时间。

- [ ] **Step 8: 校验产物**

```bash
cd app && npx playwright test tests/build-output.spec.js
```

预期：2 个测试 PASS。

- [ ] **Step 9: 实际安装并启动一次**

运行 `dist/` 下生成的 `.exe` 安装程序，装到默认路径，从桌面快捷方式启动。确认：窗口打开、图标正确、可视化在动。

- [ ] **Step 10: 提交**

```bash
git add app/package.json app/package-lock.json app/main.js app/build/icon.ico app/tests/build-output.spec.js
git commit -m "Produce a Windows NSIS installer with icon and bundled assets"
```

---

### Task 7: 人工验收

自动化测试覆盖不到的三项——录制画质、长录制内存、离线字体——必须人工实测。这三项正是 spec 第 6 节里标记为「须有可观察结果」的部分。

**Files:**
- Create: `docs/superpowers/plans/2026-08-27-acceptance-results.md`

**Interfaces:**
- Consumes: Task 6 安装好的软件
- Produces: 验收记录文档

- [ ] **Step 1: 录制画质对比**

用**浏览器**打开 `61.html`，导入一首歌，录 30 秒，导出。
用**安装好的软件**打开，导入同一首歌，同样的效果设置，录 30 秒，导出。

记录两个文件的：体积（MB）、分辨率、时长。用播放器各看一遍，对比画质。

**通过标准：** 体积在同一量级（相差不超过 20%），分辨率一致，肉眼看不出画质差异。

- [ ] **Step 2: 长录制内存监控**

在软件中录制 5 分钟。全程打开任务管理器，盯住 SUB REMIX 进程的内存占用。

每分钟记一次数值，填进下表：

| 时间 | 内存占用 |
|---|---|
| 0 分钟 | |
| 1 分钟 | |
| 2 分钟 | |
| 3 分钟 | |
| 4 分钟 | |
| 5 分钟 | |

**通过标准：** 内存基本平稳，不随录制时长线性增长。若 5 分钟时比 1 分钟时增长超过 500MB，说明落盘路径没生效，回到 Task 5 排查。

- [ ] **Step 3: 离线字体验证**

断开网络连接（拔网线或关 Wi-Fi），启动软件。打开文字面板，逐个切换这 10 种字体：Orbitron、Audiowide、Oxanium、Exo 2、Rajdhani、Michroma、Space Grotesk、Chakra Petch、Bebas Neue、Teko。

**通过标准：** 10 种字体全部正确显示各自的字形，没有任何一种回退成系统默认字体。

- [ ] **Step 4: 写验收记录**

创建 `docs/superpowers/plans/2026-08-27-acceptance-results.md`，写入三项的实测数据与结论。如实记录——有不通过的项就写不通过，附上观察到的现象。

- [ ] **Step 5: 提交**

```bash
git add docs/superpowers/plans/2026-08-27-acceptance-results.md
git commit -m "Record manual acceptance results for the desktop build"
```

---

## 附：spec 覆盖对照

| spec 章节 | 对应任务 |
|---|---|
| 2. 方案选择（Electron） | Task 1 |
| 4. 项目结构 | Task 1 |
| 5.1 字体离线化 | Task 3、Task 7 Step 3 |
| 5.2 录制落盘路径验证 | Task 4、Task 5、Task 7 Step 2 |
| 5.3 数据存储位置变化 | Task 2 |
| 6. 验证计划 第 1-2 项 | Task 1 |
| 6. 验证计划 第 3 项 | Task 7 Step 1 |
| 6. 验证计划 第 4 项 | Task 7 Step 2 |
| 6. 验证计划 第 5 项 | Task 7 Step 3 |
| 6. 验证计划 第 6 项 | Task 6 |
