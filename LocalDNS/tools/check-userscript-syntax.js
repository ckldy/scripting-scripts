#!/usr/bin/env node
/**
 * 只做语法解析，不执行 userscript。
 *
 * 为什么不用 `node --check`：本环境的 node 会把它当普通脚本**执行**，
 * userscript 一碰到 document 就抛 ReferenceError，看起来像语法错误，实际是运行时缺 DOM。
 * 用 new Function(src) 只走解析阶段，不进入函数体。
 *
 * 用法：node tools/check-userscript-syntax.js <file.user.js> [more...]
 */
const fs = require('fs');
const path = require('path');

const files = process.argv.slice(2);
if (!files.length) {
  console.log('用法: node tools/check-userscript-syntax.js <file.user.js> [...]');
  process.exit(2);
}

let bad = 0;
for (const f of files) {
  const abs = path.resolve(f);
  let src;
  try {
    src = fs.readFileSync(abs, 'utf8');
  } catch (e) {
    console.log(`❌ ${f}  读取失败: ${e.message}`);
    bad++;
    continue;
  }
  try {
    new Function(src); // 仅解析
    const kb = (Buffer.byteLength(src) / 1024).toFixed(1);
    console.log(`✅ ${path.basename(abs)}  语法 OK  ${kb} KB`);
  } catch (e) {
    console.log(`❌ ${path.basename(abs)}  语法错误: ${e.message}`);
    bad++;
  }
}

console.log(`\n${bad === 0 ? '全部通过' : bad + ' 个文件有语法问题'}`);
process.exit(bad === 0 ? 0 : 1);
