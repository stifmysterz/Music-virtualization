# SUB REMIX · macOS 版可行性结论

日期：2026-08-27
状态：**未开工**。结论已确认，等待决策。
前置：Windows 版（分支 `electron-packaging`）已完成，尚欠三项人工验收，见
`docs/superpowers/plans/2026-08-27-acceptance-results.md`。

---

## 一句话结论

代码改动小（4 处，1–2 小时），**但包必须在 macOS 机器上构建**，Windows 上做不出来。

---

## 1. 为什么不能在 Windows 上交叉构建

不是工具链缺功能，是三条物理性的墙：

| 障碍 | 说明 |
|---|---|
| `.app` 结构 | Electron Framework 内部大量使用**符号链接**（`Versions/A` → `Versions/Current` 等）。Windows 文件系统无法正确产出这套结构 |
| `.dmg` 生成 | 依赖 macOS 自带的 `hdiutil`，Windows 上不存在 |
| Apple Silicon 签名 | arm64 macOS **强制要求二进制至少带 ad-hoc 签名**才允许执行。签名工具 `codesign` 只存在于 macOS |

electron-builder 官方立场一致：mac target 只能在 macOS 上构建。

---

## 2. 代码需要改的地方

`61.html` **一个字都不用改**。字体、录制、VP9 编码在 mac 版 Electron 里是同一套 Chromium。
以下全部集中在 `app/main.js` 和 `app/package.json`。

### 2.1 `app/main.js:42` —— 菜单（**必改，否则坏功能**）

```js
Menu.setApplicationMenu(null);
```

Windows 上这行是为了解绑 Ctrl+R（录制中误按会静默毁掉整条录音，理由见该行上方注释）。

**macOS 上同一行会连整条系统菜单栏一起删掉**，后果是 **Cmd+C / Cmd+V / Cmd+A / Cmd+Q 全部失效** ——
mac 的编辑类快捷键是挂在菜单项上的，没有菜单就没有快捷键。61.html 的文字面板会变得无法粘贴。

**正确做法：** 平台分支。mac 上构建一个精简菜单，保留 `role: 'editMenu'`（复制/粘贴/全选）
和应用菜单（Cmd+Q），**剔掉 `reload` / `forceReload` / `toggleDevTools`** —— 保护录制的原始目的不变。
Windows 维持现状 `setApplicationMenu(null)`。

### 2.2 `app/main.js:100-102` —— 关窗行为（取舍，非必改）

```js
app.on('window-all-closed', () => { app.quit(); });
```

mac 惯例是关掉最后一个窗口后进程仍驻留 Dock，点图标用 `activate` 事件重开窗口
（`main.js:95` 已经有 `activate` 处理，逻辑是现成的）。

不改也能用，只是不像原生 mac 应用。**建议保持现状** —— 这是个长时间录制的重型应用，
关窗即退出反而更符合直觉，且能避免"以为关了其实还在跑"的困惑。

### 2.3 `app/package.json` build 块 —— 麦克风权限声明（**必加，否则坏功能**）

macOS 要求在 Info.plist 里声明用途字符串，否则 `getUserMedia` **直接被系统拒绝，且不给任何提示**。

```json
"mac": {
  "target": "dmg",
  "category": "public.app-category.music",
  "extendInfo": {
    "NSMicrophoneUsageDescription": "SUB REMIX needs microphone access to capture live audio input for visualization and recording."
  }
}
```

### 2.4 entitlements —— 签名后才需要（**签名则必加**）

启用 hardened runtime（公证的前提）后，还需要：

```xml
<key>com.apple.security.device.audio-input</key><true/>
```

不加的话：未签名版本能录音，一旦签名公证反而录不了音。这是很容易踩的坑。

### 2.5 无需改动的部分（已确认）

| 项 | 结论 |
|---|---|
| `HTML_PATH` / `process.resourcesPath` (`main.js:7-9`) | mac 上解析为 `SUB REMIX.app/Contents/Resources`，`extraResources` 映射一致，**逻辑不用动** |
| 单实例锁 (`main.js:13-23`) | 跨平台通用 |
| 关闭守卫 (`main.js:45-79`) | 跨平台通用 |
| `61.html` | 零改动 |
| `fonts/` | 零改动 |

---

## 3. 出包的三条路

### A. 有 Mac（推荐，最干净）

代码和 `dist:mac` 脚本写好后，在 mac 上执行构建。若那台机器能开 Claude Code，
可以完整走完构建 + 测试 + 验收。

### B. GitHub Actions 的 macOS runner（无需持有 Mac）

免费额度可行：mac 分钟按 **10 倍**计费，一次构建约 8 分钟 ≈ 80 分钟额度，
私有仓库每月配额 2000 分钟。**同时也是唯一能让那 13 个 Playwright 测试在真实 mac 上跑起来的办法。**

**代价：必须把仓库推到 GitHub。** `61.html:5` 写明 "Original build. Not licensed for
redistribution or resale."，因此**必须建私有仓库**。属于对外操作，需要 owner 明确同意。

### C. 租云 Mac（MacStadium 等）

按小时计费。为一次性构建不划算，不推荐。

---

## 4. 分发前必须知道的：Gatekeeper 比 SmartScreen 狠得多

| | Windows | macOS |
|---|---|---|
| 未签名下载后 | 弹 SmartScreen，「更多信息 → 仍要运行」 | **直接报「已损坏，无法打开」** |
| 措辞问题 | 说"不安全" | **说文件坏了** —— 是误导，多数人到这一步就放弃 |
| 绕过方式 | 点两下 | 右键 → 打开，或系统设置 → 隐私与安全性 → 仍要打开 |
| 正规解法 | 代码签名证书 ≈ $200–400/年 | **Apple Developer $99/年** + 公证（notarization） |

macOS 的正规解法反而更便宜。要正式分发就走这条。

---

## 5. 架构选择

Electron 44 支持 arm64 / x64 / universal。

- **universal**：一个包通吃，但体积翻倍（Windows 版已经 107 MB，universal dmg 会到 200 MB+）
- **建议**：只出 **arm64**，除非确认要覆盖 Intel Mac。2020 年后的 Mac 全是 Apple Silicon

---

## 6. 尚未验证的事项

以下在 Windows 上无法取证，**必须在真实 mac 上确认**：

- [ ] `showSaveFilePicker` 在 mac 版 Electron 中是否弹出真实的系统保存对话框
      （Windows 上已实测为真，非空壳存根 —— 这决定了录制走磁盘流式写入还是内存缓存）
- [ ] `video/webm;codecs=vp9,opus` 在 mac 上是否为首选编码而非退化到备用
- [ ] 长录制内存是否平坦（与 Windows 版同一风险点，spec 第 5.2 节）
- [ ] 13 个 Playwright 测试在 mac 上的通过情况

---

## 7. 建议的推进顺序

1. **先完成 Windows 版的三项人工验收** —— 尤其是 5 分钟内存监控。
   若落盘路径在 Windows 上就有问题，mac 版会带着同一个毛病，先修再移植
2. 确认是否有 Mac（决定走 A 还是 B）
3. 决定是否购买 Apple Developer 账号（决定要不要做签名 + 公证 + entitlements）
4. 再动代码
