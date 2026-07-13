import { defineConfig } from 'vite'

// COOP/COEP: crossOriginIsolated を有効にして onnxruntime-web の
// マルチスレッド WASM (SharedArrayBuffer) を使えるようにする。
// 本番 (Cloudflare Pages) では public/_headers で同じヘッダーを配信する。
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

export default defineConfig({
  // host: true — スマホ実機テスト用に LAN からのアクセスを許可
  server: { headers: isolationHeaders, host: true },
  preview: { headers: isolationHeaders, host: true },
})
