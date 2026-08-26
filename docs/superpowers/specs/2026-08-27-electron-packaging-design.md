# SUB REMIX 桌面软件化设计（Electron / Windows）

日期：2026-08-27
状态：待实现

## 1. 目标

把现有的单文件网页应用 `61.html`（SUB REMIX 音乐可视化工具）打包成一个 Windows 桌面软件：
双击图标即可打开，不需要浏览器，可以生成安装包分发给别人。

**范围内：** 打包现有功能，行为保持不变。
**范围外：** 不加时间线、多轨道、片段剪辑等 CapCut 式的非线性编辑功能。不做 macOS / Linux。

## 2. 方案选择

选定 **Electron**（打包 Chromium 内核）。

| 方案 | 安装包体积 | 录制导出可靠性 | 结论 |
|---|---|---|---|
| Electron | ~150MB | 与当前浏览器完全一致（同一个 Chromium） | **选定** |
| Tauri（系统 WebView2） | ~5-10MB | WebView2 的 MediaRecorder 编码支持与 Chrome 有差异，核心录制功能有失效风险 | 否决 |
| 浏览器"安装为应用" | 0 | 一致 | 否决：无法分发，不是真正的软件 |

**决策理由：** 本工具的核心价值是录制导出（`canvas.captureStream(60)` + `MediaRecorder`，VP9 / 30Mbps）。
Electron 是唯一能保证录制行为与已调校效果完全一致的方案。150MB 对视频类工具属正常量级。

## 3. 现状勘察结论

- **THREE.js 已内嵌**在 `61.html`（约第 1028 行起），无需联网加载。打包干净。
- **唯一外部依赖是 Google Fonts**（第 14-16 行，10 种字体）。
- **录制走两条路径**（第 19918-19979 行）：
  - 优先 `window.showSaveFilePicker` → `createWritable()` → 每秒 flush 一个 chunk 到磁盘，内存不增长。
  - 失败/取消时回退到 `recordedChunks` 数组累积 → 录完拼 Blob → `<a download>` 触发下载。
- **持久化全部走 `localStorage`**：语言、reactivity、收藏、最近模式、预设（`PRESET_PREFIX`）、自动保存（`AUTOSAVE_KEY`）。

## 4. 项目结构

```
Music virtualisation/
├── 61.html              保持为唯一的应用源文件，继续可在浏览器直接打开开发
├── app/
│   ├── main.js          Electron 主进程
│   ├── preload.js       （仅在需要补录制落盘时才引入）
│   ├── package.json     依赖与 electron-builder 配置
│   ├── icon.ico         应用图标
│   └── fonts/           离线字体文件（woff2）
└── dist/                打包产物（安装包 .exe），加入 .gitignore
```

**核心原则：`61.html` 保持单一事实来源。** 不复制、不分叉。
Electron 主进程直接加载仓库根目录的 `61.html`。对该文件的改动仅限于兼容性改动（见 5.1），
且改动后必须在浏览器中依然正常工作。

## 5. 需要解决的问题

### 5.1 字体离线化

**问题：** 第 14-16 行从 `fonts.googleapis.com` 加载 10 种字体
（Orbitron、Audiowide、Oxanium、Exo 2、Rajdhani、Michroma、Space Grotesk、Chakra Petch、Bebas Neue、Teko）。
打包为离线软件后，无网络时全部回退到默认字体，文字样式失真。

**解法：** 下载所需字重的 woff2 到 `app/fonts/`，在 `61.html` 中改为本地 `@font-face` 声明，
使用相对路径，使其在浏览器直接打开和在 Electron 中加载时都能解析。
移除对 `fonts.googleapis.com` 的 `<link>` 与 `preconnect`。

**验收：** 断网启动软件，10 种字体全部正确显示。

### 5.2 录制落盘路径验证

**问题：** `window.showSaveFilePicker` 在 Electron 渲染进程中的可用性不确定。
若不可用，代码静默回退到内存累积路径。按 30Mbps 估算，
5 分钟录制约占用 1.1GB 内存，10 分钟约 2.2GB —— 长时间录制有卡顿或崩溃风险。

**解法：** 打包跑通后第一优先级实测该 API。
- 若可用：不做任何改动。
- 若不可用：通过 preload 暴露一个最小的落盘通道（Electron 原生保存对话框 +
  Node 流式写入），在 `61.html` 中作为 `showSaveFilePicker` 不存在时的优先回退，
  保持"边录边写、内存不增长"的现有行为。浏览器环境下该通道不存在，逻辑自动落回原有分支。

**验收：** 录制 5 分钟，任务管理器中内存占用保持平稳（不随时长线性增长）。

### 5.3 数据存储位置变化

打包后 `localStorage` 落在 `C:\Users\<用户>\AppData\Roaming\SUB REMIX\`。

- 相较浏览器存储是改善：独立存储，不受清理浏览器缓存影响。
- **已确认：现有浏览器中的预设不需要迁移**，新软件从空白存储开始，不实现导出/导入功能。

## 6. 验证计划

按顺序实际执行，每步须有可观察的结果，不接受"应该没问题"：

1. Electron 开发模式启动，窗口打开，可视化正常渲染。
2. 导入音频文件，确认频谱反应、3D 效果、beat 检测行为与浏览器一致。
3. **录制 30 秒并导出，与浏览器录制的产物对比画质与文件大小。**
4. 录制 5 分钟，全程监控内存占用（对应 5.2 验收）。
5. 断网启动，检查全部字体（对应 5.1 验收）。
6. 用 electron-builder 生成 .exe 安装包，在干净路径安装并完整走一遍上述流程。

## 7. 已确认的决策

- 仅支持 Windows。
- 不需要 mp4 直出（不打包 ffmpeg），维持现有 webm 导出。
- 不需要额外的原生文件系统能力（5.2 的落盘通道是为保持现有行为，不属于新增能力）。
- 不迁移现有浏览器预设数据。
