# ADR-001: 背景除去エンジンは onnxruntime-web + ISNet の自前実装

## ステータス

Accepted（2026-07-13）

## コンテキスト

InspirationCat と同様の「ブラウザ内で完結する背景除去」が必要。最有力ライブラリの
`@imgly/background-removal` は動作検証で品質・速度とも良好だったが、ライセンスが
**AGPL-3.0** と判明。採用するとプロジェクト全体を AGPL 互換で公開する義務が生じる。

## 決定

`onnxruntime-web`（MIT） + ISNet `isnet-general-use`（xuebinqin/DIS 由来・Apache-2.0、
rembg 配布の ONNX 変換版）で前処理・推論・マスク合成を自前実装する（`src/bg-removal.ts`）。

## 理由

- ライセンスが完全に自由になる（MIT 等で公開可能）。非営利ファンツールでも将来の選択肢を狭めない
- `@imgly` の中身も同じ ISNet のため品質は同等（同一テスト画像で比較検証済み。
  失敗の仕方＝暗い服が暗い背景に溶けるケースまで一致）
- 実装量は約 150 行で保守可能な規模
- 代替案: AGPL を受け入れて `@imgly` を採用（案A）→ 実装で問題が出た場合の再検討先として残す

## 影響

- 前処理（1024²・正規化）・後処理（min-max 正規化マスク）を自前で保守する
- モデル配信も自前になり、サイズ対策（量子化・分割配信）が必要になった（→ deployment.md）
- 精度を上げたくなった場合の乗り換え先は BiRefNet（MIT・高精度・ただし 100MB 超）

## 参考

- [spec.md 4. 技術スタック](../spec.md)
- [requirements 7. 留意点](../requirements/requirements.md)
