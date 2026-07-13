# ADR-002: 推論バックエンドは当面 WASM 固定

## ステータス

Accepted（2026-07-13）

## コンテキスト

onnxruntime-web には WebGPU バックエンドがあり高速化が期待できるが、ISNet が使う
`MaxPool(ceil_mode)` が未対応で、推論時に
`using ceil() in shape computation is not yet supported for MaxPool` を投げる（ort 1.27 時点）。
また、失敗した WebGPU 初期化は WASM 側の初期化状態も汚染し
（`previous call to 'initWasm()' failed`）、同一ページ内でのリトライでは復帰できない。

## 決定

`executionProviders: ['wasm']` に固定する。COOP/COEP ヘッダーで crossOriginIsolated を
有効化し、マルチスレッド + SIMD で実行する。

## 理由

- 実測でマルチスレッド WASM の推論は 2.5〜6.4 秒、シングルスレッドでも約 7 秒と実用圏
- WebGPU の失敗はユーザー環境依存で発生し、無言のハング/エラーの原因になる（実際に発生した）
- iOS Safari など WebGPU 非対応環境ではどのみち WASM が必要

## 影響

- WebGPU 対応環境での高速化（最大数倍）は当面享受できない
- ort-web が MaxPool(ceil_mode) に対応したら再評価する（`src/bg-removal.ts` のコメント参照）
- 初期化ハング対策として 30 秒タイムアウト + `?threads=N` の強制オプションを実装済み

## 参考

- [setup.md トラブルシューティング](../guides/setup.md)
