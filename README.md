# Music Visualisation — Claude Code Replace Pack

这是一个安全的增量替换包,用于把修改说明交给 Claude Code,并保护已有视觉内容。

## 必须保留

- 2D Visualizer
- 61+ 3D Effects(不得减少效果数量或删除注册项)
- VJ Loops
- 现有 `source/`、`assets/`、`shaders/` 的全部内容

## ⚠️ 先读这一节:不要覆盖已有的 `61.html.bak`

项目根目录现有的 `61.html.bak` **不是一份可以随手覆盖的临时备份**。它是 vjIonTrail
泛白修复(提交 `fc5f30d`)**之前**的版本 —— 随机船位、bloom `1.9/0.34`、HSL 亮度峰值
`0.556` —— 而且它**不对应任何一次提交**,`.gitignore` 里的 `*.bak` 又让 git 完全看不见它。
一旦覆盖就没有第二份。

因此:

- **不要**执行 `Copy-Item 61.html -Destination 61.html.bak`,那会抹掉它。
- 需要新备份时一律带时间戳,见下面的「安装前备份」。
- 如果哪天要「从 .bak 恢复」,先想清楚:那会把泛白修复整个退回去。

## 使用方式

1. 将本包解压到目标项目之外。
2. 把 `CLAUDE_CODE_REPLACE.md` 交给 Claude Code,让它在目标项目中执行。
3. 修改前运行保护路径检查(下面三种调用方式都可以):

   ```powershell
   .\scripts\verify-protected-paths.ps1
   & ".\scripts\verify-protected-paths.ps1"
   powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\verify-protected-paths.ps1"
   ```

   并确认 Replace payload 与根目录事实源一致：

   ```powershell
   cd app
   npm run verify:replacement
   ```

   SHA-256 不一致时，安装和 Electron 构建都会直接失败，避免旧的
   `replacement/61.html` 覆盖最新源码。

4. 任何实际替换内容只能放在 `replacement/` 下;安装脚本会拒绝受保护路径。
5. **带时间戳备份目标项目根目录现有的 `61.html`** —— 安装会直接覆盖它,见下一节。
6. 先用 `scripts\install-replace.ps1 -Target <项目目录绝对路径> -WhatIf` 预览,再去掉
   `-WhatIf` 应用。`-WhatIf` 会先打印它解析出来的 `Target project:` 和完整的写入清单,
   **确认这两行指向你想改的项目再继续**。

## 安装前备份

```powershell
$proj = "<项目目录绝对路径>"
Copy-Item -LiteralPath "$proj\61.html" `
          -Destination "$proj\61.html.$(Get-Date -Format 'yyyyMMdd-HHmmss').bak"
```

每次生成一个新文件名,既不会碰到上面那份「泛白修复前」的 `61.html.bak`,也不会互相覆盖。

## 本包携带的替换内容

本包**不是**空的安全校验包。它携带一个替换文件:

| ZIP 内路径 | 安装后写入目标项目 | 行为 |
|---|---|---|
| `replacement/61.html` | `<项目目录>/61.html` | **直接覆盖同名文件** |

`61.html` 是可视化器的唯一事实来源 —— 2D Visualizer、全部 3D Effects 和 VJ Loops 都在
这一个文件里。安装脚本会用本包的版本覆盖目标项目根目录的同名文件;**覆盖不可撤销,
脚本也不会自动留副本**,所以上一节的时间戳备份是必须的。

## 安装脚本的作用范围

- 只写入 `replacement/` 下实际存在的文件,不新增、不修改、不删除其他任何文件。
  当前 payload 只有 `replacement/61.html` 一个文件,因此**只有 `<项目目录>\61.html`
  会被写入**;脚本结束前会把完整清单打印出来供核对。
- payload 一旦命中 `source/`、`assets/`、`shaders/` 顶层目录即拒绝执行(大小写不敏感)。
- 解析后的目标路径若逃出 `-Target` 指定的目录,同样拒绝执行。
- 若 `replacement/` 为空,则只完成安全校验,不改动任何文件。

## `-Target` 路径解析

`-Target` 通过 PowerShell provider 解析,跟随 `Set-Location`,**不再**依赖 .NET 进程的
工作目录。

之前的版本用 `[IO.Path]::GetFullPath($Target)`,而 .NET 的进程工作目录不跟随
`Set-Location`:人站在 `C:\Users\me` 传 `-Target "."`,脚本可能算到宿主进程启动时所在的
另一个目录,然后在那个**没打算改的项目**里覆盖 `61.html`,而且不留备份。

现在脚本会:

- 用 `$PSCmdlet.GetUnresolvedProviderPathFromPSPath()` 按你**当前所在位置**解析;
- 解析不出绝对路径就直接报错;
- 在动手之前打印 `Target project: <解析结果>`,`-WhatIf` 预览里也看得到。

习惯上仍然建议直接传绝对路径。
