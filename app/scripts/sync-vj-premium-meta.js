#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const START = '/* VJ_PREMIUM_META_DATA:START */';
const END = '/* VJ_PREMIUM_META_DATA:END */';
const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const root = rootIndex >= 0 ? path.resolve(args[rootIndex + 1]) : path.resolve(__dirname, '..', '..');
const sourcePath = path.join(root, 'src', 'vj', 'premium-meta.json');
const targetPath = path.join(root, '61.html');

function render(config) {
  if (config?.schemaVersion !== 1 || !config.effects || Object.keys(config.effects).length !== 20) throw new Error('expected exactly 20 premium effects');
  for (const [kind, meta] of Object.entries(config.effects)) {
    if (!/^vj[A-Z]/.test(kind) || ![16, 32].includes(meta.loopBeats) || !meta.family || !meta.cameraStyle || !meta.bass || !meta.mid || !meta.high || typeof meta.hue !== 'number') throw new Error(`invalid premium metadata for ${kind}`);
  }
  return `${START}\n/* Generated from src/vj/premium-meta.json. Do not edit this block by hand. */\nconst VJ_PREMIUM_META = Object.freeze(${JSON.stringify(config.effects)});\n${END}`;
}

try {
  const expected = render(JSON.parse(fs.readFileSync(sourcePath, 'utf8')));
  const target = fs.readFileSync(targetPath, 'utf8');
  const start = target.indexOf(START), end = target.indexOf(END);
  if (start < 0 || end < start) throw new Error('generated block markers are missing or malformed');
  const actual = target.slice(start, end + END.length).replace(/\r\n/g, '\n');
  if (args.includes('--write')) {
    fs.writeFileSync(targetPath, target.slice(0, start) + expected + target.slice(end + END.length));
    console.log('vj-premium-meta: synchronized standalone metadata');
  } else if (actual !== expected) {
    throw new Error('61.html is stale; run npm run sync:vj-premium-meta');
  } else {
    console.log('vj-premium-meta: source and standalone 61.html are synchronized');
  }
} catch (error) {
  console.error(`vj-premium-meta: ${error.message}`);
  process.exitCode = 1;
}
