// トゲトゲ演出（怒りのオーラ）風の背景を Canvas に手続き生成する。
// アニメのフレームは一切使わず、パラメータ駆動の自前描画のみ。
//
// レイヤー構成（下から順）:
//   1. ほぼ黒のベース
//   2. 赤いモヤ（低アルファの放射グラデを中〜外周に散布）
//   3. 破片レイヤーのにじみ（グロー）
//   4. 破片レイヤーの色収差（赤 / シアンのチャンネルずれ）
//   5. 破片レイヤー本体（シャープ）
//   6. ビネット
//   7. フィルムグレイン

export interface TogeOptions {
  /** 怒りゲージ 0..1 — トゲの量・長さ・赤の強さ・中心への迫り方に効く */
  intensity: number
  /** 乱数シード。同じシード + 同じキャンバスサイズなら同じ絵になる */
  seed: number
}

const TAU = Math.PI * 2

/** mulberry32 — 再現性のための軽量シード付き乱数 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

/** 両端が尖った細長い破片のパスを作る（waist でくびれ位置を軸方向にずらす） */
function traceShard(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  len: number,
  halfW: number,
  waist: number,
): void {
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  const px = -dy
  const py = dx
  const wx = x + dx * len * waist
  const wy = y + dy * len * waist
  ctx.beginPath()
  ctx.moveTo(x + dx * len * 0.5, y + dy * len * 0.5)
  ctx.lineTo(wx + px * halfW, wy + py * halfW)
  ctx.lineTo(x - dx * len * 0.5, y - dy * len * 0.5)
  ctx.lineTo(wx - px * halfW, wy - py * halfW)
  ctx.closePath()
}

/** 破片の色。明るい赤ほど希少で、怒りが強いほど明るい赤の比率が上がる */
function pickShardColor(rng: () => number, intensity: number): { fill: string; alpha: number } {
  const r = rng() + intensity * 0.1
  if (r < 0.3) return { fill: '#0c0303', alpha: lerp(0.8, 1, rng()) }
  if (r < 0.55) return { fill: '#5c0c07', alpha: lerp(0.6, 0.9, rng()) }
  if (r < 0.8) return { fill: '#a80f08', alpha: lerp(0.6, 0.95, rng()) }
  if (r < 0.97) return { fill: '#e01410', alpha: lerp(0.7, 1, rng()) }
  return { fill: '#ff2a18', alpha: 1 }
}

/** 破片をオフスクリーンに描く。中央は空け、外周ほど密度・長さを上げる */
function drawShardLayer(
  width: number,
  height: number,
  intensity: number,
  rng: () => number,
): HTMLCanvasElement {
  const layer = document.createElement('canvas')
  layer.width = width
  layer.height = height
  const ctx = layer.getContext('2d')!
  const cx = width / 2
  const cy = height / 2
  const rMax = Math.hypot(cx, cy)
  const diag = Math.hypot(width, height)

  // 怒りが強いほどトゲが中心に迫る
  const innerHole = lerp(0.45, 0.22, intensity)

  /** 中央を避けた外周寄りの位置とそのバイアス値 t を返す */
  const pickPos = () => {
    const posAngle = rng() * TAU
    // pow < 0.5 で外周寄りの分布にする
    const t = Math.pow(rng(), 0.35)
    const r = (innerHole + (1 - innerHole) * t) * rMax
    return { posAngle, t, x: cx + Math.cos(posAngle) * r, y: cy + Math.sin(posAngle) * r }
  }

  // メインの破片
  const count = Math.round(lerp(180, 950, intensity))
  for (let i = 0; i < count; i++) {
    const { posAngle, t, x, y } = pickPos()

    // 3/4 は放射方向 ± ゆらぎ、残りはランダム方向で乱す
    const angle = rng() < 0.75 ? posAngle + (rng() - 0.5) * 0.9 : rng() * TAU

    let len =
      lerp(0.015, 0.055, rng() ** 2) * diag * lerp(0.7, 1.5, intensity) * lerp(0.6, 1.4, t)
    if (rng() < 0.05) len *= 2.4 // たまに長く走るヒーロー破片
    const halfW = Math.max(0.4, len * lerp(0.008, 0.035, rng()))
    const waist = (rng() - 0.5) * 0.3
    const { fill, alpha } = pickShardColor(rng, intensity)

    ctx.fillStyle = fill
    // 動きの尾: 軸方向の前後に薄い残像を置いてモーションブラー感を出す
    const tx = Math.cos(angle) * len * 0.16
    const ty = Math.sin(angle) * len * 0.16
    ctx.globalAlpha = alpha * 0.22
    traceShard(ctx, x - tx, y - ty, angle, len, halfW, waist)
    ctx.fill()
    traceShard(ctx, x + tx, y + ty, angle, len, halfW, waist)
    ctx.fill()
    ctx.globalAlpha = alpha
    traceShard(ctx, x, y, angle, len, halfW, waist)
    ctx.fill()
  }

  // 微細な針: ごく短い破片を大量に散らしてザラついた鋭さを足す
  const tickCount = Math.round(lerp(150, 700, intensity))
  for (let i = 0; i < tickCount; i++) {
    const { posAngle, x, y } = pickPos()
    const angle = rng() < 0.75 ? posAngle + (rng() - 0.5) * 1.1 : rng() * TAU
    const len = lerp(0.004, 0.014, rng()) * diag
    const halfW = Math.max(0.3, len * 0.05)
    const { fill, alpha } = pickShardColor(rng, intensity)
    ctx.fillStyle = fill
    ctx.globalAlpha = alpha * 0.9
    traceShard(ctx, x, y, angle, len, halfW, 0)
    ctx.fill()
  }
  ctx.globalAlpha = 1
  return layer
}

/** layer の単一チャンネル成分だけをずらして加算合成する（色収差） */
function drawChannelShift(
  ctx: CanvasRenderingContext2D,
  layer: HTMLCanvasElement,
  tint: string,
  dx: number,
  dy: number,
  alpha: number,
): void {
  const t = document.createElement('canvas')
  t.width = layer.width
  t.height = layer.height
  const tc = t.getContext('2d')!
  tc.drawImage(layer, 0, 0)
  tc.globalCompositeOperation = 'multiply'
  tc.fillStyle = tint
  tc.fillRect(0, 0, t.width, t.height)
  // multiply で透明部が塗り潰されるので元レイヤーのアルファで切り直す
  tc.globalCompositeOperation = 'destination-in'
  tc.drawImage(layer, 0, 0)

  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = alpha
  ctx.drawImage(t, dx, dy)
  ctx.restore()
}

function supportsCanvasFilter(ctx: CanvasRenderingContext2D): boolean {
  ctx.save()
  ctx.filter = 'blur(1px)'
  const ok = ctx.filter === 'blur(1px)'
  ctx.restore()
  return ok
}

/** 128 中心の弱いノイズを overlay で重ねるフィルムグレイン */
function drawGrain(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  rng: () => number,
): void {
  const size = 128
  const noise = document.createElement('canvas')
  noise.width = size
  noise.height = size
  const nc = noise.getContext('2d')!
  const img = nc.createImageData(size, size)
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 118 + Math.floor(rng() * 20)
    img.data[i] = v
    img.data[i + 1] = v
    img.data[i + 2] = v
    img.data[i + 3] = 255
  }
  nc.putImageData(img, 0, 0)

  ctx.save()
  ctx.globalCompositeOperation = 'overlay'
  ctx.globalAlpha = 0.4
  ctx.fillStyle = ctx.createPattern(noise, 'repeat')!
  ctx.fillRect(0, 0, width, height)
  ctx.restore()
}

export function renderTogeBackground(canvas: HTMLCanvasElement, opts: TogeOptions): void {
  const width = canvas.width
  const height = canvas.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const intensity = clamp(opts.intensity, 0, 1)
  const rng = mulberry32(opts.seed)
  const cx = width / 2
  const cy = height / 2
  const rMax = Math.hypot(cx, cy)
  const diag = Math.hypot(width, height)

  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.fillStyle = '#060303'
  ctx.fillRect(0, 0, width, height)

  ctx.globalCompositeOperation = 'lighter'
  const hazeCount = Math.round(lerp(5, 11, intensity))
  for (let i = 0; i < hazeCount; i++) {
    const a = rng() * TAU
    const r = lerp(0.35, 0.85, rng()) * rMax
    const hx = cx + Math.cos(a) * r
    const hy = cy + Math.sin(a) * r
    const hr = lerp(0.1, 0.28, rng()) * diag
    const alpha = lerp(0.06, 0.17, rng()) * lerp(0.5, 1.15, intensity)
    const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, hr)
    g.addColorStop(0, `rgba(150, 16, 10, ${alpha})`)
    g.addColorStop(1, 'rgba(150, 16, 10, 0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, width, height)
  }
  ctx.globalCompositeOperation = 'source-over'

  const layer = drawShardLayer(width, height, intensity, rng)

  if (supportsCanvasFilter(ctx)) {
    ctx.filter = `blur(${Math.max(1, diag / 900)}px)`
    ctx.globalAlpha = 0.32
    ctx.drawImage(layer, 0, 0)
    ctx.filter = 'none'
  }

  const shift = clamp(diag * 0.0015, 1, 4) * lerp(0.6, 1.2, intensity)
  drawChannelShift(ctx, layer, '#ff0000', shift, shift * 0.25, 0.45)
  drawChannelShift(ctx, layer, '#00ffff', -shift, -shift * 0.25, 0.3)

  ctx.globalAlpha = 1
  ctx.drawImage(layer, 0, 0)

  const vg = ctx.createRadialGradient(cx, cy, rMax * 0.5, cx, cy, rMax * 1.02)
  vg.addColorStop(0, 'rgba(0,0,0,0)')
  vg.addColorStop(1, 'rgba(0,0,0,0.42)')
  ctx.fillStyle = vg
  ctx.fillRect(0, 0, width, height)

  drawGrain(ctx, width, height, rng)
  ctx.restore()
}
