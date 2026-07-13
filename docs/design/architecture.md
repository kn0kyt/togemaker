# アーキテクチャ設計

## 1. システム構成図

```
[ブラウザ（すべての処理がここで完結）]
  ├─ UI / 合成・保存        index.html + src/main.ts
  ├─ トゲトゲ背景生成       src/toge-background.ts（Canvas 手続き生成）
  ├─ 背景除去               src/bg-removal.ts（onnxruntime-web + ISNet）
  └─ 静的アセット           ISNet モデル（public/models/）・WASM ランタイム

[Cloudflare Pages（予定）]   静的配信のみ。サーバー処理・DB・ストレージなし
```

設計思想（InspirationCat 踏襲）: **サーバーに計算させない・保存させない・転送は CDN に任せる**

---

## 2. モジュール構成

| モジュール | 責務 | 依存 |
|-----------|------|------|
| `src/main.ts` | UI 状態・被写体操作（ドラッグ/ピンチ/ホイール）・合成描画・PNG 保存 | toge-background, bg-removal |
| `src/toge-background.ts` | トゲトゲ背景の手続き生成。シード付き乱数（mulberry32）で再現性あり。DOM 依存は Canvas のみ | なし |
| `src/bg-removal.ts` | モデル取得（進捗つき）・前処理・ISNet 推論・マスク合成。セッションはシングルトン | onnxruntime-web |
| `cutout.html` + `src/cutout.ts` | 背景除去の単体検証ページ（**dev 専用**・`vite build` の対象外） | bg-removal |
| `scripts/setup-assets.mjs` | fp32 元モデルの取得（量子化パイプライン用・通常の開発では不要） | Node.js |
| `scripts/split-model.mjs` | モデルの 25MiB 制限対応チャンク分割 | Node.js |

---

## 3. データフロー（写真 → 合成画像）

1. ユーザーが写真を選択（画像はブラウザ内のみ。外部送信なし）
2. `bg-removal`: 1024² に縮小 → `/255 - 0.5` 正規化 → ISNet 推論（マルチスレッド WASM）
   → 出力を min-max 正規化してアルファマスク化 → `destination-in` で元解像度の透過 PNG に合成
3. `main`: トゲトゲ背景（キャッシュ済み Canvas）の上に被写体レイヤーを transform 付きで描画
4. 被写体操作中は transform のみ更新し背景は再生成しない（60fps 維持）
5. `canvas.toBlob('image/png')` でダウンロード

### トゲトゲ背景の描画レイヤー（下から）

1. ほぼ黒のベース → 2. 赤いモヤ（放射グラデ散布） → 3. 破片のにじみ（グロー） →
4. 色収差（赤/シアンのチャンネルずれ） → 5. 破片本体（外周ほど高密度・中央は空ける） →
6. ビネット → 7. フィルムグレイン

---

## 4. セキュリティ・プライバシー

- 認証・アカウントなし。個人情報を扱わない
- 画像・EXIF（GPS 等）は外部送信されない（全処理クライアント内）
- COOP/COEP ヘッダーで crossOriginIsolated を有効化（マルチスレッド WASM の SharedArrayBuffer 用）。
  dev は `vite.config.ts`、本番は `public/_headers`（予定）
- 外部リソースは Google Fonts のみ（COEP 対応のため `crossorigin` 属性つき）

---

## 5. 環境一覧

| 環境 | 用途 | URL |
|------|------|-----|
| local | 開発 | http://localhost:5173 |
| production | 本番（未構築） | togemaker.pages.dev（予定・空き要確認） |

---

## 6. 技術選定理由

| 技術 | 選定理由 | 代替案 |
|------|---------|--------|
| Vite + バニラ TypeScript | バンドル最小・参考プロダクト踏襲 | React 等（過剰） |
| onnxruntime-web + ISNet 自前実装 | ライセンス自由（MIT/Apache-2.0）→ [ADR-001](../decisions/001-bg-removal-engine.md) | `@imgly/background-removal`（AGPL-3.0） |
| WASM 固定推論 | WebGPU EP の制約 → [ADR-002](../decisions/002-wasm-backend.md) | WebGPU（ort 対応後に再評価） |
| Canvas 手続き生成 | 著作権安全・パラメータ化 → [ADR-003](../decisions/003-procedural-background.md) | 静止画素材 |
| Cloudflare Pages | 帯域無制限・無料 | Vercel（帯域課金あり） |

---

## 変更履歴

| 日付 | 変更者 | 内容 |
|------|--------|------|
| 2026-07-13 | yuta.kaneoka | テンプレートを実内容に置き換え（MVP 実装時点） |
