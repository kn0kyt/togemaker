// ISNet モデル (isnet-general-use.onnx fp32, Apache-2.0) を models-src/ へダウンロードする。
// これは量子化パイプラインの入力・品質比較用で、アプリ本体は public/models/ の
// 量子化済み分割チャンク（コミット済み）を使うため、通常の開発ではこのスクリプトは不要。
// 量子化 → 分割の手順は docs/guides/deployment.md 参照。
import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// 出典: xuebinqin/DIS (Apache-2.0) の isnet-general-use を rembg (MIT) が ONNX 変換して配布しているもの
const MODEL_URL = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx'
const modelDest = join(root, 'models-src/isnet-general-use.onnx')
if (existsSync(modelDest) && statSync(modelDest).size > 100_000_000) {
  console.log(`model: already exists (${(statSync(modelDest).size / 1e6).toFixed(0)}MB), skip`)
} else {
  mkdirSync(dirname(modelDest), { recursive: true })
  console.log(`model: downloading ${MODEL_URL} ...`)
  const res = await fetch(MODEL_URL)
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(modelDest))
  console.log(`model: saved ${(statSync(modelDest).size / 1e6).toFixed(0)}MB -> models-src/`)
}
