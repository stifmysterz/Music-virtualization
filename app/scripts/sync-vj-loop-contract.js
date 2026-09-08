#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const START = '/* VJ_LOOP_CONTRACT:START */';
const END = '/* VJ_LOOP_CONTRACT:END */';
const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const root = rootIndex >= 0 ? path.resolve(args[rootIndex + 1]) : path.resolve(__dirname, '..', '..');
const sourcePath = path.join(root, 'src', 'vj', 'loop-contract.js');
const targetPath = path.join(root, '61.html');
const source = fs.readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n').trimEnd();
const target = fs.readFileSync(targetPath, 'utf8');
const start = target.indexOf(START), end = target.indexOf(END);

if (start < 0 || end < start) {
  console.error('vj-loop-contract: generated block markers are missing or malformed');
  process.exitCode = 1;
} else {
  const expected = `${START}\n/* Generated from src/vj/loop-contract.js. Do not edit this block by hand. */\n${source}\n${END}`;
  const actual = target.slice(start, end + END.length).replace(/\r\n/g, '\n');
  if (args.includes('--write')) {
    fs.writeFileSync(targetPath, target.slice(0, start) + expected + target.slice(end + END.length));
    console.log('vj-loop-contract: synchronized standalone loop contract');
  } else if (actual !== expected) {
    console.error('vj-loop-contract: 61.html is stale; run npm run sync:vj-loop-contract');
    process.exitCode = 1;
  } else {
    console.log('vj-loop-contract: source and standalone 61.html are synchronized');
  }
}
