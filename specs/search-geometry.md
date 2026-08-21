# Spec — 搜尋幾何：偏移／扇形／多點／A→B 走廊

**Goal:** 搜尋範圍由「單一圓心」升級做四種幾何 — 圓心平移、方向扇形、多點（≤5）、A→B 走廊 — 用座標合併算法將 API call 壓到最少。

**Definition of done:** 四種模式喺 conditions drawer 揀到、抽到、上轉盤；每次抽 nearby call ≤3；194+ 單元測試覆蓋幾何／合併／公平配額；preview E2E 全部走通；deploy 上 production。

## In scope

1. **偏移**：圓心由目前位置向指定方向移 X 米（8 方位 + 距離），半徑照主滑桿。
2. **扇形開關**：「只限呢個方向」— 90°／180° 可切換，以方位角 client-side 過濾。
3. **多點**：最多 5 個地點（搜尋揀 或 用目前位置），共用主半徑；結果 union + dedupe。
4. **走廊**：A→B 兩個端點（各自可搜尋／用 GPS）+ 專用闊度滑桿 100m–2km；長度上限 8km；點對線段距離 ≤ 闊度先入池。
5. **合併算法（成本核心）**：目標幾何 → 最少 fetch 圓覆蓋（重疊點合一個圓；走廊先試 1 個大圓，唔夠先分 2–3 個），**每次抽 nearby 上限 3 個 call**；fetch 圓半徑照舊 snap 上 cache 級距（級距表加大碼以容納合併圓）。
6. **轉盤公平配額**：每個點／段 round-robin 攞格，旺區唔冚死其他點。
7. 口味標籤只喺第 1 點搜（上限 3 text call）→ 每次抽最多 6 calls，BYO 每日 cap 頂得住 ~5 次全新抽。

## Out of scope（今輪唔做）

- AI 語音講「向西搵 500 米」（下輪加）
- 地圖視覺化（**下一輪已批**：OSM tile 做 HTML map element ＋ **SVG overlay** 標記搜尋範圍（Samson 2026-08-22 確認嘅形態）— 較控制項時即時投影圓／扇形／走廊條帶；tile 自托管 Protomaps 喺佢 CF（$0 冇 key，OSM 公共 tile server 政策禁止 app 用）；今輪嘅 `geometry.ts` Geometry 物件直接餵 overlay，零重工；互動揀點做 v2）
- 走廊沿真實道路（直線走廊 only）

> **GO 已於 2026-08-22 給出**（「今輪照 GO，map 下一輪做預覽」）。
> **2026-08-22 深夜追加並出貨：** (1) map 預覽輪（OpenFreeMap tiles — Samson 拍板棄自托管改即用；MapLibre lazy chunk；overlay 投影四種幾何；CSP 加 `worker-src blob:`）；(2) 偏移基準點可以係任何搜尋到嘅地點（null＝現在位置）。視覺合成部分 headless 驗證唔到（隱藏 pane rAF 停頓），交 Samson 於裝置上肉眼 QA。

## Approach

1. `src/lib/geo/` 新增 `geometry.ts`：offsetPoint（方位+米→座標）、bearing、pointToSegmentMeters、扇形判定、**coverage planner**（幾何 → ≤3 個 fetch 圓）＋單元測試
2. `OriginSetting` 擴充做 discriminated union（`gps | picked | offset | multi | corridor`）；`hydrateConditions` 前向相容
3. Engine：`runDraw` 行 planner 出嚟嘅圓逐個 fetch（照用現有 per-circle cache）→ union → 幾何 client-filter → 公平配額入 `selectCandidates`
4. UI：「由邊度出發」**預設維持而家咁**（目前位置／搵地點）— 進階幾何收埋喺一個「⚙️ 進階範圍」掣後面，撳先展開（偏移／多點／走廊三個模式 chips + 各自控制項）；有進階模式生效時自動保持展開＋喺收合行顯示 summary chip（例：「🧭 東 300m」「🗺️ 3 個點」），一撳返「目前位置／搵地點」即退出進階。防止 filter drawer 過長
5. 測試＋preview E2E＋deploy Pages（worker 唔使郁）

## Decisions you made

| 問題 | 你嘅答案 |
|---|---|
| 今輪範圍 | 三種全做，算法慳 call |
| 偏移語義 | 平移＋可選方向限定（兩樣都要） |
| 扇形角度 | 90°／180° 可切換 |
| 標籤 API | 只喺第 1 點搜 |
| 轉盤分配 | 每點公平配額 |
| nearby 上限 | 每次抽最多 3 個 call |
| 走廊闊度 | 專用滑桿 100m–2km |
| 進階收納 | 預設隱藏，撳「⚙️ 進階範圍」先展開；防 filter 過長 |

## Still assumed（我作主嘅細位，唔啱可以嗌停）

- 偏移距離控制 = 100m–2000m 滑桿；方向 = 8 方位按鈕
- 多點共用主半徑滑桿（唔逐點設半徑）
- 走廊 A 預設有「用而家位置」快捷 chip
- 放寬提示喺走廊模式下「擴大」= 加闊闊度一級
- 合併圓 cache 級距加 8000m 一檔
- 「進階範圍」用 inline 展開（喺 drawer 入面原位撐開），唔係另開一層 sheet — sheet 疊 sheet 喺手機好核突
- Preset／stale-pool fingerprint 自動涵蓋新模式（現有機制）

**Alignment: ~97%**

回覆 **GO**（或「開始」）就動工；想改邊行直接講。
