#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const START = '/* THREE_R149_ADDONS:START */';
const END = '/* THREE_R149_ADDONS:END */';
const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const root = rootIndex >= 0 ? path.resolve(args[rootIndex + 1]) : path.resolve(__dirname, '..', '..');
const sourcePath = path.join(root, 'src', 'three', 'addons-r149.js');
const targetPath = path.join(root, '61.html');
const source = fs.readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n').trimEnd();
const target = fs.readFileSync(targetPath, 'utf8');
const start = target.indexOf(START), end = target.indexOf(END);

if (start < 0 || end < start) {
  console.error('three-addons: generated block markers are missing or malformed');
  process.exitCode = 1;
} else {
  const expected = `${START}\n/* Generated from src/three/addons-r149.js. Do not edit this block by hand. */\n${source}\n${END}`;
  const actual = target.slice(start, end + END.length).replace(/\r\n/g, '\n');
  if (args.includes('--write')) {
    fs.writeFileSync(targetPath, target.slice(0, start) + expected + target.slice(end + END.length));
    console.log('three-addons: synchronized 61.html from src/three/addons-r149.js');
  } else if (actual !== expected) {
    console.error('three-addons: 61.html is stale; run npm run sync:three-addons');
    process.exitCode = 1;
  } else {
    console.log('three-addons: source and standalone 61.html are synchronized');
  }
}
