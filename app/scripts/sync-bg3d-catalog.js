#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const START = '/* BG3D_CATALOG_DATA:START */';
const END = '/* BG3D_CATALOG_DATA:END */';
const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const root = rootIndex >= 0 ? path.resolve(args[rootIndex + 1]) : path.resolve(__dirname, '..', '..');
const sourcePath = path.join(root, 'src', 'three', 'background-catalog.json');
const targetPath = path.join(root, '61.html');

function render(config) {
  if (config?.schemaVersion !== 1 || !Array.isArray(config.categories) || !config.categories.length) throw new Error('invalid catalog schema');
  const categories = new Set(), kinds = new Set();
  for (const group of config.categories) {
    if (!group.cat || categories.has(group.cat) || !Array.isArray(group.kinds) || !group.kinds.length) throw new Error(`invalid or duplicate category ${group.cat || ''}`);
    categories.add(group.cat);
    for (const kind of group.kinds) {
      if (kinds.has(kind)) throw new Error(`duplicate 3D kind ${kind}`);
      kinds.add(kind);
    }
  }
  return `${START}\n/* Generated from src/three/background-catalog.json. Do not edit this block by hand. */\nconst BG3D_CATALOG = Object.freeze(${JSON.stringify(config.categories)});\n${END}`;
}

try {
  const expected = render(JSON.parse(fs.readFileSync(sourcePath, 'utf8')));
  const target = fs.readFileSync(targetPath, 'utf8');
  const start = target.indexOf(START), end = target.indexOf(END);
  if (start < 0 || end < start) throw new Error('generated block markers are missing or malformed');
  const actual = target.slice(start, end + END.length).replace(/\r\n/g, '\n');
  if (args.includes('--write')) {
    fs.writeFileSync(targetPath, target.slice(0, start) + expected + target.slice(end + END.length));
    console.log('bg3d-catalog: synchronized standalone catalog');
  } else if (actual !== expected) {
    throw new Error('61.html is stale; run npm run sync:bg3d-catalog');
  } else {
    console.log('bg3d-catalog: source and standalone 61.html are synchronized');
  }
} catch (error) {
  console.error(`bg3d-catalog: ${error.message}`);
  process.exitCode = 1;
}
