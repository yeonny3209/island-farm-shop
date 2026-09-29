#!/usr/bin/env node
/* 안드로이드 앱에 넣을 웹 파일을 www/ 로 모은다 (capacitor.config.json 의 webDir).
 * 사용법: node tools/build-web.js */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'www');
const FILES = ['index.html', 'manifest.webmanifest'];
const DIRS = ['css', 'js', 'icons'];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const f of FILES) fs.copyFileSync(path.join(ROOT, f), path.join(OUT, f));
for (const d of DIRS) fs.cpSync(path.join(ROOT, d), path.join(OUT, d), { recursive: true });
console.log(`www/ 준비 완료: ${[...FILES, ...DIRS.map((d) => d + '/')].join(', ')}`);
