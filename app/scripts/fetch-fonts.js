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
