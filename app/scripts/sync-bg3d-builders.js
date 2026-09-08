#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const START = '/* BG3D_BUILDERS:START */';
const END = '/* BG3D_BUILDERS:END */';
const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const root = rootIndex >= 0 ? path.resolve(args[rootIndex + 1]) : path.resolve(__dirname, '..', '..');
const targetPath = path.join(root, '61.html');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function builderName(kind) {
  if (kind === 'festival') return 'buildBg3DFestivalBuilding';
  return `buildBg3D${kind[0].toUpperCase()}${kind.slice(1)}`;
}

function sourceKinds() {
  const catalog = readJson(path.join('src', 'three', 'background-catalog.json'));
  const vj = readJson(path.join('src', 'vj', 'tunnel-registry.json'));
  const regular = catalog.categories.flatMap(group => group.kinds);
  const kinds = [...regular, ...vj.kinds];
  if (new Set(kinds).size !== kinds.length) throw new Error('duplicate kind across 3D catalog and VJ registry');
  return { regular, vj: vj.kinds, kinds };
}

function render() {
  const { regular, vj, kinds } = sourceKinds();
  const entries = kinds.map(kind => `  ${kind}: ${builderName(kind)}`);
  return `${START}\n/* Generated from background-catalog.json + tunnel-registry.json. Do not edit by hand. */\nconst BG3D_BUILDERS = {\n${entries.join(',\n')}\n};\n/* ${regular.length} regular 3D backgrounds + ${vj.length} VJ tunnels share this builder registry. */\n${END}`;
}

try {
  const expected = render();
  const target = fs.readFileSync(targetPath, 'utf8');
  const start = target.indexOf(START), end = target.indexOf(END);
  if (start >= 0 && end >= start) {
    const actual = target.slice(start, end + END.length).replace(/\r\n/g, '\n');
    if (args.includes('--write')) {
      fs.writeFileSync(targetPath, target.slice(0, start) + expected + target.slice(end + END.length));
      console.log('bg3d-builders: synchronized generated registry');
    } else if (actual !== expected) {
      throw new Error('61.html is stale; run npm run sync:bg3d-builders');
    } else {
      console.log('bg3d-builders: source catalogs and standalone registry are synchronized');
    }
  } else if (args.includes('--write')) {
    const legacy = /^const BG3D_BUILDERS = \{[^\r\n]+$/m;
    if (!legacy.test(target)) throw new Error('legacy BG3D_BUILDERS declaration was not found');
    fs.writeFileSync(targetPath, target.replace(legacy, expected));
    console.log('bg3d-builders: replaced legacy registry with generated registry');
  } else {
    throw new Error('generated block markers are missing; run npm run sync:bg3d-builders');
  }
} catch (error) {
  console.error(`bg3d-builders: ${error.message}`);
  process.exitCode = 1;
}
