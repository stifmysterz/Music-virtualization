#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const START = '/* MODE_QUALITY_DATA:START */';
const END = '/* MODE_QUALITY_DATA:END */';
const args = process.argv.slice(2);
const write = args.includes('--write');
const rootArgument = args.indexOf('--root');
const root = rootArgument >= 0 ? path.resolve(args[rootArgument + 1]) : path.resolve(__dirname, '..', '..');
const sourcePath = path.join(root, 'src', 'config', 'mode-quality.json');
const targetPath = path.join(root, '61.html');

function fail(message) {
  console.error(`mode-quality: ${message}`);
  process.exitCode = 1;
}

function validate(config) {
  if (config?.schemaVersion !== 1 || !config.tiers) throw new Error('expected schemaVersion 1 and tiers');
  const values = Object.entries(config.tiers);
  if (values.map(([tier]) => tier).join(',') !== 'S,A,Legacy') throw new Error('tiers must be S, A, Legacy in order');
  const seen = new Set();
  for (const [tier, modes] of values) {
    if (!Array.isArray(modes) || !modes.length) throw new Error(`${tier} must be a non-empty array`);
    for (const mode of modes) {
      if (typeof mode !== 'string' || !mode) throw new Error(`${tier} includes an invalid mode`);
      if (seen.has(mode)) throw new Error(`${mode} appears in more than one tier`);
      seen.add(mode);
    }
  }
}

function renderList(values) {
  return `[\n  ${values.map(value => `'${value}'`).join(',')}\n]`;
}

function render(config) {
  const { S, A, Legacy } = config.tiers;
  return `${START}
/* Generated from src/config/mode-quality.json. Do not edit this block by hand. */
/* Quality ranking is curation, not a feature gate: every mode remains available in its original
   family and random/favourites. These badges only surface the strongest layered compositions. */
const MODE_S_TIER = Object.freeze(${renderList(S)});
const MODE_A_TIER = Object.freeze(${renderList(A)});
const MODE_LEGACY_TIER = Object.freeze(${renderList(Legacy)});
const MODE_QUALITY_TIER = Object.freeze(Object.fromEntries(MODES.map(key => [key,
  MODE_S_TIER.includes(key) ? 'S' : MODE_A_TIER.includes(key) ? 'A' : MODE_LEGACY_TIER.includes(key) ? 'Legacy' : 'B'
])));
function getModeQualityTier(key){ return MODE_QUALITY_TIER[key] || 'B'; }
function makeModeQualityBadge(key){
  const tier=getModeQualityTier(key), badge=document.createElement('span');
  badge.className='mode-quality-badge mode-quality-'+tier.toLowerCase();
  badge.textContent=tier;
  badge.title=tier==='S' ? 'S Tier — Premium pick' : tier==='A' ? 'A Tier — Polished pick' : tier==='Legacy' ? 'Classic / legacy style' : 'B Tier — standard library';
  return badge;
}
${END}`;
}

try {
  const config = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  validate(config);
  const target = fs.readFileSync(targetPath, 'utf8');
  const start = target.indexOf(START);
  const end = target.indexOf(END);
  if (start < 0 || end < start) throw new Error('generated block markers are missing or malformed');
  const expected = render(config);
  /* 生成块一律以 \n 写入，而 61.html 在 Windows 检出后整体是 CRLF。任何会统一
     换行符的编辑器保存一次，就会把这些块翻成 CRLF，逐字节比较随即误报 stale。
     比较前先归一化——其余 7 个 sync 脚本都是这么做的，这里之前漏了。          */
  const actual = target.slice(start, end + END.length).replace(/\r\n/g, '\n');
  if (write) {
    fs.writeFileSync(targetPath, target.slice(0, start) + expected + target.slice(end + END.length));
    console.log('mode-quality: synchronized 61.html from src/config/mode-quality.json');
  } else if (actual !== expected) {
    throw new Error('61.html is stale; run npm run sync:mode-quality');
  } else {
    console.log('mode-quality: source and standalone 61.html are synchronized');
  }
} catch (error) {
  fail(error.message);
}
