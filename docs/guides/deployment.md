# デプロイガイド（Cloudflare Pages）

> **ステータス: デプロイ準備完了（2026-07-13）。** Cloudflare アカウント作成と GitHub リポジトリ公開後、
> 下記 3 章の手順でデプロイする。

## 1. 構成

| 項目 | 内容 |
|------|------|
| ホスティング | Cloudflare Pages（無料・帯域無制限） |
| プロジェクト名 | `togemaker`（→ `togemaker.pages.dev`。作成時に空き確認） |
| デプロイ方法 | GitHub 連携で `main` push → 自動デプロイ |
| ビルド設定 | build command: `npm run build` / output: `dist` |

25MiB/ファイル制限への対応は**済み**（dist 内の最大ファイルは 16.8MB）:

- モデルは int8 量子化（179MB → 46MB、品質劣化なしを実写で検証済み）した上で
  **16MiB × 3 チャンクに分割してリポジトリにコミット**（`public/models/*.part*`）。
  ブラウザ側で並列 fetch → 結合する（`src/bg-removal.ts`）
- ONNX ランタイムは WASM 専用ビルド（13.5MB。WebGPU 用 jsep 版 26.8MB は不使用・非同梱）
- COOP/COEP と `/models/*` の長期キャッシュは `public/_headers` で設定済み
- ローカル検証用のテスト画像・モデル元ファイルは `public/` 外に置いてあり、ビルドに含まれない

## 2. モデルの再生成手順（モデルを更新するときのみ）

```bash
npm run setup                                  # fp32 元モデルを models-src/ に取得
python3 -m venv .venv && .venv/bin/pip install onnx onnxruntime
.venv/bin/python -c "
from onnxruntime.quantization import quantize_dynamic, QuantType
quantize_dynamic('models-src/isnet-general-use.onnx', 'models-src/isnet-quint8.onnx', weight_type=QuantType.QUInt8)
"
node scripts/split-model.mjs models-src/isnet-quint8.onnx 16   # → .part0..N を生成
mv models-src/isnet-quint8.onnx.part* public/models/
# パート数が変わった場合は src/bg-removal.ts の MODEL_PART_URLS も更新すること
```

品質確認: `/cutout.html?auto&model=/models-src/isnet-general-use.onnx`（fp32）と
デフォルト（量子化版）の結果・マスク統計（コンソールの `[bg-removal] mask stats`）を比較する。

## 3. デプロイ手順

1. Cloudflare ダッシュボード → Workers & Pages → Create → Pages → Connect to Git
2. リポジトリ `togemaker` を選択、build command `npm run build` / output `dist` を設定
3. プロジェクト名 `togemaker` を指定（`togemaker.pages.dev` の空きをここで確認）
4. Deploy 実行

## 4. デプロイ後の確認チェックリスト

- [ ] DevTools コンソールで `crossOriginIsolated === true`（false なら `_headers` が効いていない）
- [ ] 初回アクセスでモデル DL 進捗（46MB / 3 並列）が表示され、切り抜きが完走する
- [ ] 2 回目以降はモデルがブラウザキャッシュから即ロードされる（Network タブで 304/disk cache）
- [ ] iPhone / Android 実機で速度・タッチ操作を確認（HTTPS なのでマルチスレッド WASM が有効）
- [ ] PNG 保存 → X に投稿できる
- [ ] フッターに非公式・非営利・端末内処理の明記がある

## 5. ロールバック

Cloudflare Pages のデプロイ履歴から前バージョンに即時ロールバック可能
（ダッシュボード → Deployments → Rollback）。

---

## 変更履歴

| 日付 | 変更者 | 内容 |
|------|--------|------|
| 2026-07-13 | yuta.kaneoka | テンプレートを実内容（計画）に置き換え |
| 2026-07-13 | yuta.kaneoka | 量子化・分割配信・_headers 対応完了。デプロイ準備完了に更新 |
