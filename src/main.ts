// CSS は index.html の <link> で読み込む（JS import だと適用が JS 実行後になり FOUC が出る）
import { renderTogeBackground } from './toge-background'
import { removeBackground, warmup } from './bg-removal'

const ASPECTS = {
  '16:9': [1600, 900],
  '1:1': [1200, 1200],
  '9:16': [900, 1600],
  '3:1': [1500, 500],
} as const
type AspectKey = keyof typeof ASPECTS

const canvas = document.querySelector<HTMLCanvasElement>('#stage')!
const gauge = document.querySelector<HTMLInputElement>('#gauge')!
const gaugeValue = document.querySelector<HTMLSpanElement>('#gauge-value')!
const seedLabel = document.querySelector<HTMLSpanElement>('#seed')!
const regenBtn = document.querySelector<HTMLButtonElement>('#regen')!
const saveBtn = document.querySelector<HTMLButtonElement>('#save')!
const aspectGroup = document.querySelector<HTMLDivElement>('#aspects')!
const photoBtn = document.querySelector<HTMLButtonElement>('#photo')!
const fileInput = document.querySelector<HTMLInputElement>('#file')!
const aiStatus = document.querySelector<HTMLSpanElement>('#ai-status')!
const loading = document.querySelector<HTMLDivElement>('#loading')!
const loadingText = document.querySelector<HTMLSpanElement>('#loading-text')!

// タッチ端末では操作説明をスマホ向けにする
const isTouch = matchMedia('(pointer: coarse)').matches
const GESTURE_HINT = isTouch
  ? 'ドラッグで移動 / ピンチで拡大縮小・回転'
  : 'ドラッグで移動 / ホイールで拡縮 / ⌥+ホイールで回転'

// 検証用: ?gauge=0-100 & ?seed=16進 & ?aspect=16:9 で状態を再現、?demo で /test.local.png を自動合成
const params = new URLSearchParams(location.search)
let seed = parseInt(params.get('seed') ?? '', 16) >>> 0 || 0x07132026
let aspect: AspectKey = (Object.keys(ASPECTS) as AspectKey[]).includes(
  params.get('aspect') as AspectKey,
)
  ? (params.get('aspect') as AspectKey)
  : '16:9'

const gaugeParam = Number(params.get('gauge'))
if (Number.isFinite(gaugeParam) && params.has('gauge')) {
  gauge.value = String(Math.min(100, Math.max(0, gaugeParam)))
}

/** 切り抜き済み被写体とキャンバス上の配置（x, y は中心座標） */
interface Subject {
  bmp: ImageBitmap
  x: number
  y: number
  scale: number
  rot: number
}
let subject: Subject | null = null

// 背景はキャッシュし、被写体の操作中に再生成しない（ドラッグを 60fps に保つ）
const bgCanvas = document.createElement('canvas')
let bgKey = ''

function ensureBackground(w: number, h: number, intensity: number): void {
  const key = `${w}x${h}:${seed}:${intensity}`
  if (key === bgKey) return
  bgCanvas.width = w
  bgCanvas.height = h
  renderTogeBackground(bgCanvas, { intensity, seed })
  bgKey = key
}

let queued = false
function render(): void {
  if (queued) return
  queued = true
  requestAnimationFrame(() => {
    queued = false
    const [w, h] = ASPECTS[aspect]
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    ensureBackground(w, h, Number(gauge.value) / 100)
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bgCanvas, 0, 0)
    if (subject) {
      ctx.save()
      ctx.translate(subject.x, subject.y)
      ctx.rotate(subject.rot)
      ctx.scale(subject.scale, subject.scale)
      ctx.drawImage(subject.bmp, -subject.bmp.width / 2, -subject.bmp.height / 2)
      ctx.restore()
    }
    gaugeValue.textContent = gauge.value
    seedLabel.textContent = seed.toString(16).padStart(8, '0')
  })
}

// ---- 画像の取り込み → 背景除去 → 被写体として配置 ----

let busy = false
async function handleFile(blob: Blob): Promise<void> {
  if (busy) return
  busy = true
  photoBtn.disabled = true
  loading.hidden = false
  loadingText.textContent = '画像を読み込み中…'
  try {
    const cut = await removeBackground(blob, (stage, ratio) => {
      loadingText.textContent =
        stage === 'model'
          ? `AIモデルをダウンロード中… ${Math.round(ratio * 100)}%`
          : stage === 'session'
            ? 'AIを準備中…'
            : 'AIが切り抜き中…'
    })
    loadingText.textContent = '合成中…'
    const bmp = await createImageBitmap(cut)
    const [w, h] = ASPECTS[aspect]
    const fit = Math.min((w * 0.7) / bmp.width, (h * 0.7) / bmp.height)
    subject = { bmp, x: w / 2, y: h / 2, scale: fit, rot: 0 }
    aiStatus.textContent = GESTURE_HINT
    ;(window as unknown as { __subject_ready: boolean }).__subject_ready = true
    render()
  } catch (err) {
    console.error(err)
    aiStatus.textContent = `エラー: ${err instanceof Error ? err.message : err}（HEIC の場合は JPEG で書き出してください）`
    ;(window as unknown as { __error: string }).__error = String(err)
  } finally {
    loading.hidden = true
    busy = false
    photoBtn.disabled = false
  }
}

photoBtn.addEventListener('click', () => fileInput.click())
fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0]
  if (f) void handleFile(f)
  fileInput.value = ''
})

// ページ表示直後にモデルをプリフェッチしておく（画像選択時には準備完了している状態を狙う）
warmup((stage, ratio) => {
  aiStatus.textContent =
    stage === 'model' ? `モデル準備中 ${Math.round(ratio * 100)}%` : 'AI準備中…'
})
  .then(() => {
    aiStatus.textContent = 'AI準備完了'
  })
  .catch(() => {
    aiStatus.textContent = ''
  })

// ---- 被写体の操作（ドラッグ / ホイール / ピンチ） ----

const pointers = new Map<number, { x: number; y: number }>()
interface DragGesture {
  mode: 'drag'
  start: { x: number; y: number }
  subj: { x: number; y: number }
}
interface PinchGesture {
  mode: 'pinch'
  startDist: number
  startAngle: number
  startMid: { x: number; y: number }
  subj: { x: number; y: number; scale: number; rot: number }
}
let gesture: DragGesture | PinchGesture | null = null

function canvasPos(e: PointerEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect()
  return {
    x: ((e.clientX - rect.left) * canvas.width) / rect.width,
    y: ((e.clientY - rect.top) * canvas.height) / rect.height,
  }
}

function startGesture(): void {
  if (!subject) return
  const pts = [...pointers.values()]
  if (pts.length === 1) {
    gesture = { mode: 'drag', start: pts[0], subj: { x: subject.x, y: subject.y } }
  } else if (pts.length >= 2) {
    const [p1, p2] = pts
    gesture = {
      mode: 'pinch',
      startDist: Math.hypot(p2.x - p1.x, p2.y - p1.y),
      startAngle: Math.atan2(p2.y - p1.y, p2.x - p1.x),
      startMid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
      subj: { x: subject.x, y: subject.y, scale: subject.scale, rot: subject.rot },
    }
  }
}

canvas.addEventListener('pointerdown', (e) => {
  if (!subject) return
  canvas.setPointerCapture(e.pointerId)
  pointers.set(e.pointerId, canvasPos(e))
  startGesture()
  e.preventDefault()
})

canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId) || !subject || !gesture) return
  pointers.set(e.pointerId, canvasPos(e))
  const pts = [...pointers.values()]
  if (gesture.mode === 'drag' && pts.length === 1) {
    subject.x = gesture.subj.x + (pts[0].x - gesture.start.x)
    subject.y = gesture.subj.y + (pts[0].y - gesture.start.y)
  } else if (gesture.mode === 'pinch' && pts.length >= 2) {
    const [p1, p2] = pts
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y)
    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x)
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
    subject.scale = clampScale(gesture.subj.scale * (dist / gesture.startDist))
    subject.rot = gesture.subj.rot + (angle - gesture.startAngle)
    subject.x = gesture.subj.x + (mid.x - gesture.startMid.x)
    subject.y = gesture.subj.y + (mid.y - gesture.startMid.y)
  }
  render()
})

const endPointer = (e: PointerEvent) => {
  pointers.delete(e.pointerId)
  startGesture() // 残った指でジェスチャーを再アンカー
}
canvas.addEventListener('pointerup', endPointer)
canvas.addEventListener('pointercancel', endPointer)

const clampScale = (s: number) => Math.min(8, Math.max(0.05, s))

canvas.addEventListener(
  'wheel',
  (e) => {
    if (!subject) return
    e.preventDefault()
    if (e.altKey) {
      subject.rot += e.deltaY * 0.005
    } else {
      subject.scale = clampScale(subject.scale * Math.exp(-e.deltaY * 0.002))
    }
    render()
  },
  { passive: false },
)

// ---- その他のコントロール ----

gauge.addEventListener('input', render)

regenBtn.addEventListener('click', () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  render()
})

aspectGroup.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-aspect]')
  if (!btn) return
  aspect = btn.dataset.aspect as AspectKey
  for (const b of aspectGroup.querySelectorAll('button')) {
    b.classList.toggle('is-active', b === btn)
  }
  render()
})

saveBtn.addEventListener('click', () => {
  canvas.toBlob(async (blob) => {
    if (!blob) return
    const filename = `togemaker-${aspect.replace(':', 'x')}-${seed.toString(16)}.png`
    const file = new File([blob], filename, { type: 'image/png' })
    // iOS/Android では共有シートを開く（写真アプリへの保存や X への直接投稿ができる）
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] })
        return
      } catch (e) {
        if ((e as DOMException).name === 'AbortError') return // ユーザーがキャンセル
        // 共有シートが開けなかった場合はダウンロードにフォールバック
      }
    }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  })
})

for (const b of aspectGroup.querySelectorAll('button')) {
  b.classList.toggle('is-active', b.dataset.aspect === aspect)
}

if (params.has('demo')) {
  fetch('/test.local.png')
    .then((r) => {
      if (!r.ok) throw new Error('public/test.local.png がありません')
      return r.blob()
    })
    .then(handleFile)
    .catch((e) => {
      aiStatus.textContent = String(e)
    })
}

render()
