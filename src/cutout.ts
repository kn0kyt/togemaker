// 自前実装 (onnxruntime-web + ISNet) の背景除去の動作検証（dev 専用ページ）
import { removeBackground } from './bg-removal'

const statusEl = document.querySelector<HTMLParagraphElement>('#status')!
const logEl = document.querySelector<HTMLPreElement>('#log')!
const origImg = document.querySelector<HTMLImageElement>('#orig')!
const resultImg = document.querySelector<HTMLImageElement>('#result')!
const fileInput = document.querySelector<HTMLInputElement>('#file')!
const dropZone = document.querySelector<HTMLDivElement>('#drop')!

let running = false

const log = (message: string) => {
  logEl.textContent += `${message}\n`
}

// 診断用: このビルドが読み込まれているか / スレッドが使えるかをページ上で確認できるようにする
const BUILD_LINE = `build: wasm-only-2 / crossOriginIsolated=${crossOriginIsolated} / threads=${navigator.hardwareConcurrency}`
log(BUILD_LINE)
resultImg.addEventListener('error', () => {
  statusEl.textContent = '結果画像の表示に失敗しました（PNG デコードエラー）'
})

async function run(blob: Blob): Promise<void> {
  if (running) return
  running = true
  const t0 = performance.now()
  const elapsed = () => `${((performance.now() - t0) / 1000).toFixed(1)}s`
  origImg.src = URL.createObjectURL(blob)
  resultImg.removeAttribute('src')
  logEl.textContent = `${BUILD_LINE}\n`
  // ハング検知用: 10 秒ごとに経過を残す
  let currentStage = 'start'
  const watchdog = window.setInterval(() => log(`${elapsed()} まだ実行中… (stage=${currentStage})`), 10_000)
  try {
    const result = await removeBackground(blob, (stage, ratio) => {
      statusEl.textContent = `${stage} ${Math.round(ratio * 100)}%`
      if (stage !== currentStage) {
        log(`${elapsed()} ${stage}`)
        currentStage = stage
      }
    })
    resultImg.src = URL.createObjectURL(result)
    statusEl.textContent = `完了: ${elapsed()}（初回はモデルDL込み）`
    log(`done in ${elapsed()}, output ${(result.size / 1024).toFixed(0)}KB ${result.type}`)
    ;(window as unknown as { __done: boolean }).__done = true
  } catch (err) {
    statusEl.textContent = `エラー: ${err}`
    log(String(err))
    ;(window as unknown as { __error: string }).__error = String(err)
  } finally {
    window.clearInterval(watchdog)
    running = false
  }
}

fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0]
  if (f) void run(f)
})
dropZone.addEventListener('dragover', (e) => e.preventDefault())
dropZone.addEventListener('drop', (e) => {
  e.preventDefault()
  const f = e.dataTransfer?.files?.[0]
  if (f) void run(f)
})

if (new URLSearchParams(location.search).has('auto')) {
  fetch('/test.local.png')
    .then((r) => {
      if (!r.ok) throw new Error('public/test.local.png が見つかりません')
      return r.blob()
    })
    .then(run)
    .catch((e) => {
      statusEl.textContent = String(e)
      ;(window as unknown as { __error: string }).__error = String(e)
    })
}
