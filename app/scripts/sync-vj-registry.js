#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const START = '/* VJ_TUNNEL_REGISTRY:START */';
const END = '/* VJ_TUNNEL_REGISTRY:END */';
const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const root = rootIndex >= 0 ? path.resolve(args[rootIndex + 1]) : path.resolve(__dirname, '..', '..');
const sourcePath = path.join(root, 'src', 'vj', 'tunnel-registry.json');
const targetPath = path.join(root, '61.html');

function render(config) {
  if (config?.schemaVersion !== 1 || !Array.isArray(config.kinds) || !config.kinds.length) {
    throw new Error('expected schemaVersion 1 and a non-empty kinds array');
  }
  if (new Set(config.kinds).size !== config.kinds.length) throw new Error('duplicate VJ kind');
  if (config.kinds.some(kind => typeof kind !== 'string' || !/^vj[A-Z]/.test(kind))) throw new Error('invalid VJ kind');
  const lines = [];
  for (let i = 0; i < config.kinds.length; i += 5) {
    lines.push(`  ${config.kinds.slice(i, i + 5).map(JSON.stringify).join(',')}`);
  }
  return `${START}\n/* Generated from src/vj/tunnel-registry.json. Do not edit this block by hand. */\nconst VJ_TUNNEL_KINDS = Object.freeze([\n${lines.join(',\n')}\n]);\n${END}`;
}

try {
  const expected = render(JSON.parse(fs.readFileSync(sourcePath, 'utf8')));
  const target = fs.readFileSync(targetPath, 'utf8');
  const start = target.indexOf(START), end = target.indexOf(END);
  if (start < 0 || end < start) throw new Error('generated block markers are missing or malformed');
  const actual = target.slice(start, end + END.length).replace(/\r\n/g, '\n');
  if (args.includes('--write')) {
    fs.writeFileSync(targetPath, target.slice(0, start) + expected + target.slice(end + END.length));
    console.log('vj-registry: synchronized 61.html from src/vj/tunnel-registry.json');
  } else if (actual !== expected) {
    throw new Error('61.html is stale; run npm run sync:vj-registry');
  } else {
    console.log('vj-registry: source and standalone 61.html are synchronized');
  }
} catch (error) {
  console.error(`vj-registry: ${error.message}`);
  process.exitCode = 1;
}
