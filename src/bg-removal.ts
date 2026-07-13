// ブラウザ内背景除去 — onnxruntime-web (MIT) + ISNet (xuebinqin/DIS, Apache-2.0)
// AGPL のライブラリに依存せず、前処理・推論・マスク合成を自前で行う。
// モデルと WASM ランタイムは同一オリジン（public/）から配信し、画像は外部送信しない。
// WASM 専用バンドルを使う（ADR-002 で WASM 固定のため）。通常バンドルだと未使用の
// jsep 版ランタイム（WebGPU 用、26.8MB — Cloudflare Pages の 25MiB 制限超え）まで
// ビルドに同梱されてしまう。ランタイム本体は Vite の ?url インポートで参照する
// （public 経由だと Vite が .mjs の動的インポートを 500 で拒否するため）。
import * as ort from 'onnxruntime-web/wasm'
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import ortMjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url'

// モデルは int8 量子化 + 分割配信（Cloudflare Pages の 25MiB/ファイル制限のため）。
// ブラウザで全パートを並列 fetch して結合する。生成手順は docs/guides/deployment.md 参照。
const MODEL_PART_URLS = [
  '/models/isnet-quint8.onnx.part0',
  '/models/isnet-quint8.onnx.part1',
  '/models/isnet-quint8.onnx.part2',
]
// 検証用: ?model=<URL> で単一ファイルのモデルに差し替えられる（fp32 との品質比較などに使う）
const modelOverride = new URLSearchParams(location.search).get('model')
const INPUT_SIZE = 1024

ort.env.wasm.wasmPaths = { wasm: ortWasmUrl, mjs: ortMjsUrl }

export type ProgressHandler = (stage: 'model' | 'session' | 'inference', ratio: number) => void

let sessionPromise: Promise<ort.InferenceSession> | null = null

/** 分割されたモデルを並列取得して結合する（2回目以降はブラウザの HTTP キャッシュが効く） */
async function fetchModel(onProgress?: ProgressHandler): Promise<Uint8Array> {
  const urls = modelOverride ? [modelOverride] : MODEL_PART_URLS
  const responses = await Promise.all(urls.map((u) => fetch(u)))
  for (const res of responses) {
    if (!res.ok || !res.body) throw new Error(`モデルの取得に失敗しました: HTTP ${res.status}`)
  }
  const total = responses.reduce(
    (sum, res) => sum + (Number(res.headers.get('content-length')) || 0),
    0,
  )
  let received = 0
  const parts = new Array<Uint8Array>(urls.length)
  await Promise.all(
    responses.map(async (res, i) => {
      const reader = res.body!.getReader()
      const chunks: Uint8Array[] = []
      let length = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        length += value.length
        received += value.length
        if (total) onProgress?.('model', received / total)
      }
      const buf = new Uint8Array(length)
      let offset = 0
      for (const c of chunks) {
        buf.set(c, offset)
        offset += c.length
      }
      parts[i] = buf
    }),
  )
  // パートを順序どおりに結合
  const model = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0))
  let offset = 0
  for (const p of parts) {
    model.set(p, offset)
    offset += p.length
  }
  return model
}

/** 推論セッション（モジュールスコープでシングルトン化して再ロードを防ぐ） */
function getSession(onProgress?: ProgressHandler): Promise<ort.InferenceSession> {
  if (sessionPromise) return sessionPromise
  const p = (async () => {
    const model = await fetchModel(onProgress)
    onProgress?.('session', 0)

    // 検証用: ?threads=N でスレッド数を強制できる（マルチスレッド初期化が
    // 環境要因（拡張機能の Worker ブロック等）でハングするケースの切り分け用）
    const threadsParam = Number(new URLSearchParams(location.search).get('threads'))
    if (Number.isInteger(threadsParam) && threadsParam > 0) {
      ort.env.wasm.numThreads = threadsParam
    }
    console.debug(
      `[bg-removal] model fetched: ${(model.byteLength / 1e6).toFixed(0)}MB, creating session (numThreads=${ort.env.wasm.numThreads ?? 'auto'})...`,
    )

    // WASM 固定。WebGPU EP は ISNet の MaxPool(ceil_mode) 未対応で
    // 推論時に "using ceil() in shape computation is not yet supported for MaxPool"
    // を投げる（ort 1.27 時点）。対応されたら WebGPU 優先に戻すことを検討する。
    // 初期化は環境要因で無言のままハングすることがあるため、タイムアウトで明示的に失敗させる。
    const create = ort.InferenceSession.create(model, { executionProviders: ['wasm'] })
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(
        () =>
          reject(
            new Error(
              'WASM の初期化が 30 秒以内に完了しませんでした。ブラウザ拡張機能や管理ポリシーの干渉が疑われます。シークレットウィンドウ・別ブラウザ・?threads=1 をお試しください。',
            ),
          ),
        30_000,
      )
    })
    try {
      const session = await Promise.race([create, timeout])
      onProgress?.('session', 1)
      console.debug('[bg-removal] session ready')
      return session
    } catch (err) {
      console.error('[bg-removal] session creation failed:', err)
      throw err
    }
  })()
  sessionPromise = p
  p.catch(() => {
    // 失敗時は次回の呼び出しでリトライできるようにする
    if (sessionPromise === p) sessionPromise = null
  })
  return p
}

/** 事前にモデル取得とセッション初期化だけ済ませる（ページ表示直後のプリフェッチ用） */
export function warmup(onProgress?: ProgressHandler): Promise<unknown> {
  return getSession(onProgress)
}

interface PreprocessResult {
  tensor: ort.Tensor
  bitmap: ImageBitmap
}

/** ISNet の前処理: 1024x1024 に縮小し、RGB を /255 - 0.5 で正規化した CHW テンソルへ */
async function preprocess(blob: Blob): Promise<PreprocessResult> {
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
  const canvas = document.createElement('canvas')
  canvas.width = INPUT_SIZE
  canvas.height = INPUT_SIZE
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bitmap, 0, 0, INPUT_SIZE, INPUT_SIZE)
  const { data } = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE)
  const n = INPUT_SIZE * INPUT_SIZE
  const input = new Float32Array(3 * n)
  for (let i = 0; i < n; i++) {
    input[i] = data[i * 4] / 255 - 0.5
    input[n + i] = data[i * 4 + 1] / 255 - 0.5
    input[2 * n + i] = data[i * 4 + 2] / 255 - 0.5
  }
  return { tensor: new ort.Tensor('float32', input, [1, 3, INPUT_SIZE, INPUT_SIZE]), bitmap }
}

/** 出力ロジットを min-max 正規化してアルファマスクの Canvas にする */
function toMaskCanvas(mask: Float32Array): HTMLCanvasElement {
  let min = Infinity
  let max = -Infinity
  let sum = 0
  for (const v of mask) {
    if (v < min) min = v
    if (v > max) max = v
    sum += v
  }
  const range = max - min || 1
  console.debug(
    `[bg-removal] mask stats: min=${min.toFixed(4)} max=${max.toFixed(4)} mean=${(sum / mask.length).toFixed(4)} len=${mask.length}`,
  )
  const image = new ImageData(INPUT_SIZE, INPUT_SIZE)
  for (let i = 0; i < mask.length; i++) {
    image.data[i * 4 + 3] = ((mask[i] - min) / range) * 255
  }
  const canvas = document.createElement('canvas')
  canvas.width = INPUT_SIZE
  canvas.height = INPUT_SIZE
  canvas.getContext('2d')!.putImageData(image, 0, 0)
  return canvas
}

/** 背景を除去した PNG (透過) の Blob を返す */
export async function removeBackground(blob: Blob, onProgress?: ProgressHandler): Promise<Blob> {
  const session = await getSession(onProgress)
  const { tensor, bitmap } = await preprocess(blob)

  onProgress?.('inference', 0)
  const outputs = await session.run({ [session.inputNames[0]]: tensor })
  const output = outputs[session.outputNames[0]]
  onProgress?.('inference', 1)

  const maskCanvas = toMaskCanvas(output.data as Float32Array)

  // 元解像度で「元画像 × マスクのアルファ」を合成
  const out = document.createElement('canvas')
  out.width = bitmap.width
  out.height = bitmap.height
  const ctx = out.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0)
  ctx.globalCompositeOperation = 'destination-in'
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(maskCanvas, 0, 0, bitmap.width, bitmap.height)

  return await new Promise<Blob>((resolve, reject) => {
    out.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG エンコードに失敗しました'))), 'image/png')
  })
}
