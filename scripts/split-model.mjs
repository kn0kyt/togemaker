// モデルファイルを Cloudflare Pages の 25MiB/ファイル制限に収まるチャンクへ分割する。
// 使い方: node scripts/split-model.mjs <入力ファイル> [チャンクMiB=16]
// 出力: <入力ファイル>.part0, .part1, ... （ブラウザ側で fetch → 結合する）
import { readFileSync, writeFileSync } from 'node:fs'

const [, , input, chunkMibArg] = process.argv
if (!input) {
  console.error('usage: node scripts/split-model.mjs <file> [chunkMiB]')
  process.exit(1)
}
const chunkBytes = (Number(chunkMibArg) || 16) * 1024 * 1024
const buf = readFileSync(input)
let i = 0
for (let off = 0; off < buf.length; off += chunkBytes) {
  const part = buf.subarray(off, off + chunkBytes)
  writeFileSync(`${input}.part${i}`, part)
  console.log(`${input}.part${i}: ${(part.length / 1e6).toFixed(1)}MB`)
  i++
}
console.log(`done: ${i} parts`)
