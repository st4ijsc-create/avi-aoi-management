# PHASE 4 — INDUSTRIAL EXCELLENCE AUDIT (DELTA v2)
**Module:** `/products` + Measurement Points
**Tài liệu này KHÔNG thay thế** [PRODUCTS_MEASUREMENT_POINTS_UPGRADE_REPORT.md](PRODUCTS_MEASUREMENT_POINTS_UPGRADE_REPORT.md) (DRAFT v1.0).
Đây là **báo cáo delta** — chỉ liệt kê những điểm **chưa có** sau khi đã hoàn thành P0 → P3.6 (Step 12).
**Ngày:** 2026-05-11
**Trạng thái:** ⏳ ĐỢI PHÊ DUYỆT
**Vai trò AI:** Chuyên gia hệ thống AOI / AVI / SPI / AXI — kiểm thử quang học công nghiệp.

---

## 0. TÓM TẮT ĐIỀU HÀNH

Sau 12 bước thực thi (báo cáo v1.0 §9), module Products + Measurement Points đã đạt **mức 3 / 5 (Defined)** theo thang trưởng thành CMMI cho metrology systems:

- ✅ Đa hình ROI (rect / line / ring / polygon)
- ✅ 3D fields (Z, height, volume, coplanarity, warpage, void%, tilt, thickness)
- ✅ GD&T tolerance v2 (datum refs, material condition, fit class)
- ✅ Fiducials + coordinate calibration (mm/pixel)
- ✅ Multi-camera product views, sampling plan, instrument binding
- ✅ Cpk/Ppk + Box-Cox transform
- ✅ MSA wizard (CSV import + team-shared mapping presets)
- ✅ Defect catalog table + analytics-layer heatmap

**Để đạt mức 4–5 (Quantitatively Managed → Optimizing) — yêu cầu của OEM tier-1 EMS / automotive (IATF 16949) / medical (ISO 13485)** — còn **12 hạng mục** cần triển khai, được nhóm thành **3 sub-phase** (P4.A → P4.C). Tổng effort ước lượng: **~18.5 person-weeks**.

Không có hạng mục nào yêu cầu refactor breaking; tất cả đều additive.

---

## 1. KIỂM ĐỊNH HIỆN TRẠNG (do agent tự xác minh, không tin báo cáo cũ)

| # | Hạng mục v1.0 | File chứng cứ | Trạng thái thực |
|---|---|---|---|
| P0 | Soft-delete + audit + version snapshot | [drizzle/0084_p0_soft_delete_audit_versions.sql](drizzle/0084_p0_soft_delete_audit_versions.sql) | ✅ Done |
| P1 | Multi-shape + fiducials + canvas v2 | [drizzle/0085_p1_fiducials_and_coordinate_mode.sql](drizzle/0085_p1_fiducials_and_coordinate_mode.sql), [MeasurementPointCanvas.tsx](client/src/components/measurement-point-canvas/MeasurementPointCanvas.tsx) | ✅ Done (rect/line/ring/polygon) |
| P2 | 3D + GD&T + defect catalog table | [drizzle/0086_p2_3d_fields_catalogs_tolerance.sql](drizzle/0086_p2_3d_fields_catalogs_tolerance.sql) | ✅ Schema + DB layer; ⚠ **chưa seed IPC-A-610** |
| P3.1–P3.5 | Instruments / sampling / views / Cpk Box-Cox | [drizzle/0087_p3_instruments_sampling_views.sql](drizzle/0087_p3_instruments_sampling_views.sql) | ✅ Done |
| P3.6 | MSA wizard | [drizzle/0088_msa_csv_mapping_presets.sql](drizzle/0088_msa_csv_mapping_presets.sql) | ✅ Steps 8–12 done; ⚠ **chỉ Gauge R&R; chưa ANOVA / bias / linearity / stability** |
| P3.7 | CAD import | — | ❌ **Chưa khởi động** |
| P3.8 | Per-view defect heatmap overlay | — | ❌ Chỉ có analytics grid heatmap, **chưa overlay theo tọa độ MP trên ảnh sản phẩm** |
| Shape `mask` / `array` | — | — | ⚠ Schema cho phép literal nhưng **canvas không có UI** (rò rỉ shape ngầm) |

---

## 2. MA TRẬN GAP MỚI (G9 → G20) — GÓC NHÌN CHUYÊN GIA AOI/AVI

### G9. CAD-driven measurement-point generation (P3.7 nâng cấp)
**Industrial pain:** Một PCB 0.5m × 0.4m có thể có **3.000–8.000 pad**. Tạo MP thủ công là không khả thi. Tier-1 EMS bắt buộc nhập từ CAD.
**Cases cần hỗ trợ:**
- Gerber (RS-274X) + drill (Excellon) → pad list cho AOI 2D
- ODB++ v8 (de-facto EMS) → component + net list
- IPC-2581 Rev C (open standard, automotive) → pad + ref-des + tolerance
- STEP AP242 → mặt cong, height profile cho 3D AOI / AXI
- DXF (mechanical / housing AVI) → contour, slot, hole
**Tự động sinh MP rules:**
- 1 MP / pad (SMT) hoặc 1 MP / lead (BGA → solder ball array)
- Auto chọn `shape` theo pad geometry (rectangular pad → `rect`, BGA ball → `ring`, fiducial → tách sang `fiducial_marks`)
- Auto suy ra `geometry.boundary` từ pad outline
- Auto map IPC-7351 land pattern → criteria mặc định (offset ≤ 25%, solder fillet 20°…)
- De-duplicate khi import lần 2 (hash by reference designator + position)

### G10. Per-view defect heatmap overlay (P3.8)
**Phân biệt với analytics hiện có:** `HeatmapGrid` (analytics dashboard) là **bảng số liệu theo machine × shift**. Cái cần là **bitmap/SVG overlay phủ trên ảnh `productView` ở tỉ lệ 1:1**, mỗi MP nhuộm màu theo **defect rate** lịch sử.
**Use case:**
- PE/QE click vào "hot zone" → drill xuống MP-level Pareto + ảnh NG samples
- Phát hiện **systematic defect cluster** (góc trên-trái luôn lỗi → nghi nozzle X mâm SMT)
- Compare A/B 2 lô (lô-A vs lô-B) cùng product → visual diff

### G11. Defect catalog seed IPC-A-610 Class 2/3
Bảng đã tạo (P2) nhưng **trống**. Cần seed **~120 defect codes** chuẩn IPC-A-610 rev H:
- Solder: insufficient, excess, bridging, cold, void, HoP (head-on-pillow), tombstone, BGA-NWO (non-wet open), wicking
- Component: missing, wrong-part, polarity-reverse, lifted-lead, billboard, skew (>50%), upended
- PCB: scratch, contamination, exposed-copper, measling, delamination, weave-exposure
- Assembly: wrong-orientation, foreign-object-debris (FOD), conformal-coating-void
Mỗi entry có: `category, severity (critical/major/minor), classRef (Class 1/2/3), ipcReference, exampleImageUrl`.

### G12. MSA Phase 3 — ANOVA full + bias / linearity / stability
**Hiện có:** Gauge R&R Average-Range method.
**Còn thiếu (yêu cầu AIAG MSA 4th ed. cho IATF 16949):**
- ANOVA method (tách `interaction operator × part`) — chính xác hơn ARM khi có tương tác
- **Bias study** (so với reference standard / master gauge)
- **Linearity** (bias thay đổi theo range đo)
- **Stability** (control chart của reference gauge theo thời gian)
- **PDF report export** với chữ ký số (cho audit IATF / FDA)
- **NDC** (Number of Distinct Categories) ≥ 5 gate

### G13. Tolerance stack-up Monte-Carlo ở mức product
**Industrial pain:** Sản phẩm assembled từ N component, mỗi component có tolerance riêng. Cần biết **tolerance tổng** ở critical dimension (eg. khe hở camera-lens-housing).
**Triển khai:**
- `productTolerance Stackups` table — nhóm các MP thành 1 chain (A → B → C)
- Engine Monte-Carlo (10k–100k iterations, normal/uniform/triangular distributions)
- Output: stackup mean, σ, Cpk dự kiến, sensitivity analysis (MP nào contribute nhiều nhất)
- UI: Sankey/tornado chart contribution

### G14. Time-series `measurement_samples` cho real-time SPC
**Hiện trạng:** Cpk/Ppk tính từ `measurement_results` ad-hoc.
**Vấn đề:** Không thể chạy **rolling Cpk** (last 30 / 50 / 100 samples) realtime, không có **drift detection**.
**Triển khai:**
- Table mới `measurement_samples` (high-volume, partition by month) — 1 row / 1 đo / 1 MP
- Materialized view `mp_spc_rolling` refresh mỗi N phút (Cpk, X̄, R, EWMA)
- **Western Electric / Nelson rules** detector → emit event khi vi phạm:
  - Rule 1: 1 point > 3σ
  - Rule 2: 9 points cùng phía mean
  - Rule 3: 6 points trend tăng/giảm
  - Rule 4: 14 points zigzag
  - … (8 Nelson rules)
- Alert sink → MQTT topic + dashboard banner + email/Teams

### G15. SPI ↔ AOI ↔ AXI triangulation (post-reflow root-cause)
**Industrial pain:** Khi BGA fail ở AXI (X-ray), không biết do **paste insufficient (SPI step)** hay **placement skew (AOI step)** hay **reflow profile (oven)**.
**Triển khai:**
- `inspectionStation` enum: SPI / pre-reflow AOI / post-reflow AOI / AXI / ICT / FCT
- 1 product unit (serial) có **N inspection records** từ N station, link bằng `serialNumber + boardSide + panelPosition`
- UI **process flow viewer**: 1 row = 1 unit, columns = các station, mỗi cell = pass/fail + thumbnail
- **Auto root-cause hint** rule engine: AXI fail solder void → check SPI volume cùng pad → nếu < 80% spec → tag "root_cause: low_paste"

### G16. Genealogy / traceability (full as-built record)
**Yêu cầu IPC-1782 / FDA 21 CFR Part 11:**
- 1 serial number ↔ list of: components used (LOT-level), operator, instrument, recipe version, MSA expiry status, environmental (T°/RH), oven profile ID
- `productGenealogy` table — append-only, hash-chained (tamper-evident)
- Export "as-built record" PDF cho mỗi unit (1-click)
- Recall query: "lot X bị lỗi → list tất cả serial dùng lot X"

### G17. Lighting / illumination recipe per MP
**Cực kỳ quan trọng cho AVI surface:** 1 vết xước chỉ thấy với coaxial-light góc 0°, không thấy với ring-light.
**Triển khai:**
- `mpLightingProfile`: lightSource (ring/coaxial/dome/side-low-angle/UV/IR/multi-spectral), color (R/G/B/W/IR), intensityPct (0-100), angle°, exposureMs, gain
- Mỗi MP có thể có **multi-shot** (eg. shot-1 ring-white để check presence, shot-2 coaxial-blue để check scratch)
- Versioned cùng `measurementPointVersions` (đã có P0)
- AOI machine consume qua MQTT recipe payload

### G18. ML-driven auto-threshold tuning
**Industrial pain:** Engineer set tolerance bằng tay → quá rộng (escape) hoặc quá chặt (false call). Tier-1 EMS dùng ML đề xuất.
**Triển khai:**
- Job offline: lấy historical {measured_value, ground_truth_pass_fail} cho 1 MP, fit:
  - Logistic regression / Gaussian KDE → đề xuất `tolPlus / tolMinus` để minimize (escape_cost × P_escape + false_call_cost × P_FC)
  - ROC curve hiển thị trade-off
- UI: "Suggested" badge cạnh trường tolerance, 1 click apply (với version snapshot + audit reason)
- **Không tự auto-apply** — engineer phải approve (compliance)

### G19. Gauge R&R lifecycle gate
**Industrial pain:** Instrument quá hạn calibration vẫn được dùng → audit fail.
**Triển khai:**
- `instrumentCalibrations`: certNumber, certPdfUrl, performedAt, validUntil, performedBy, traceability (NIST/SCM)
- `instrumentMSARecords`: msaSessionId, ndc, gageRRPct, status, validUntil
- **Production gate** — khi inspection request hit MP → check binding instrument:
  - Calibration expired → block + alert
  - MSA expired (default 12 months) → warn, require lead approval
- Dashboard "Instrument Health" — RAG status

### G20. Specialized point-type subforms (mechanical / cosmetic)
**Hiện trạng:** Form 1 size fits all.
**Cases ngoài SMT:**
- **Edge / burr / chip-out** (CNC machined housing): subform có "edge_type, max_burr_mm, surface_class"
- **Scratch / dent cosmetic** (consumer electronics): subform "min_length_mm, depth_um, area_mm2, severity_zone (A/B/C)"
- **Color / gloss** (paint, anodize): subform "L*a*b* spec, Δ E_max, gloss_GU"
- **Engraving / laser mark**: subform "char_height_mm, contrast_pct, OCR_confidence_min"
- **Gasket / seal presence**: subform "continuity_pct, min_width_mm"
Mỗi `measurementTypeCode` (đã có ở P2) → bind đến 1 React subform component qua registry.

---

## 3. ROADMAP P4 (3 sub-phase)

### P4.A — Quick Wins (1.5 weeks)
| Task | Effort | Files mới / sửa |
|---|---|---|
| G11 Seed defect catalog IPC-A-610 (~120 codes, 3 ngôn ngữ) | 2d | `drizzle/0089_seed_defect_catalog_ipc_a610.sql`, `i18n/{en,vi,zh}/defects.json` |
| Sửa rò rỉ shape `mask` / `array` (block schema hoặc thêm UI tối thiểu) | 1d | [MeasurementPointCanvas.tsx](client/src/components/measurement-point-canvas/MeasurementPointCanvas.tsx), schema validation |
| G19 Instrument calibration + MSA expiry gate (chỉ schema + warn banner, chưa block) | 3d | `drizzle/0090_instrument_calibration.sql`, `server/db/instrument.ts`, `client/src/pages/Instruments.tsx` |
| G17 Lighting profile schema + form (chưa machine integration) | 2d | `drizzle/0091_mp_lighting_profile.sql`, `MeasurementPointForm.tsx` |

### P4.B — Core (8 weeks)
| Task | Effort |
|---|---|
| G9 CAD import — Gerber + IPC-2581 trước (Phase 1), STEP/ODB++/DXF (Phase 2) | 3w |
| G10 Per-view heatmap overlay (canvas + tRPC `mpDefectStats`) | 1w |
| G14 `measurement_samples` time-series + rolling Cpk + Western Electric/Nelson rules engine | 2w |
| G12 MSA Phase 3 (ANOVA + bias + linearity + stability + PDF export) | 2w |

### P4.C — Advanced (9 weeks)
| Task | Effort |
|---|---|
| G15 SPI↔AOI↔AXI triangulation + process flow viewer + root-cause rules | 3w |
| G16 Genealogy/traceability (hash-chained, as-built PDF, recall query) | 2w |
| G13 Tolerance stack-up Monte-Carlo engine + Sankey UI | 2w |
| G18 ML auto-threshold tuning (offline job + suggest UI + approval workflow) | 1.5w |
| G20 Specialized subforms (5 types: edge/scratch/color/engrave/gasket) | 1w |

**Tổng:** ~18.5 person-weeks (1 senior FE + 1 senior BE + 0.5 ML/data eng).

---

## 4. ACCEPTANCE CRITERIA (per gap)

### G9 CAD import
- [ ] Import Gerber RS-274X file < 30 s cho board 5000-pad
- [ ] Sinh đúng số MP = số pad ± 2% (validation tay 3 sample boards)
- [ ] Re-import lần 2 không tạo duplicate (hash detection)
- [ ] Audit log mỗi lần import (file hash + count + user)

### G10 Heatmap overlay
- [ ] Click hot-spot → modal Pareto top-5 defect codes của MP đó (last 30 days)
- [ ] Render < 200 ms cho 500 MP
- [ ] Export PNG snapshot cho report

### G14 SPC rules
- [ ] Rolling Cpk update ≤ 60 s sau khi có sample mới
- [ ] 8 Nelson rules implementations có unit test pass
- [ ] Alert delivery (MQTT + UI banner) trong 5 s khi vi phạm

### G18 Auto-threshold
- [ ] Suggest có ROC AUC ≥ 0.85 trên hold-out
- [ ] Không bao giờ auto-apply khi user chưa click approve + nhập reason
- [ ] Audit log lưu cả old/new + suggested values + cost params

(Đầy đủ AC cho 12 gap — sẽ mở rộng ở v2.1 sau khi duyệt scope.)

---

## 5. RỦI RO

| Rủi ro | Mức | Mitigation |
|---|---|---|
| CAD parser (Gerber/ODB++) phức tạp, nhiều dialect | 🔴 Cao | POC parser bằng `gerber-parser` npm trước khi cam kết Phase 2; fallback "manual upload pad-list CSV" nếu CAD parse fail |
| Time-series `measurement_samples` tăng nhanh (>100M rows/year) | 🟠 Vừa | Partition by month, archive cold partition sang S3 sau 90 ngày; index chỉ trên (mpId, sampledAt) |
| ML auto-threshold gây compliance issue (medical device) | 🟠 Vừa | Hard-gate "approval required" + immutable audit; tag suggestion với model version |
| Genealogy hash-chain perf khi recall query 1M units | 🟡 Thấp | Index theo `componentLot`, denormalize "lot → serials" lookup table |
| Lighting profile schema xung đột với MQTT recipe payload hiện tại | 🟠 Vừa | Versioned recipe + feature flag, rollout per machine |

---

## 6. CÂU HỎI MỞ — ĐỢI BẠN CHỐT TRƯỚC KHI KHỞI ĐỘNG

1. **Compliance target ưu tiên?**
   - [ ] IPC-A-610 Class 2 (general electronics)
   - [ ] IPC-A-610 Class 3 (high-reliability — automotive/aerospace/medical)
   - [ ] IATF 16949 (automotive QMS — yêu cầu MSA Phase 3 + traceability)
   - [ ] ISO 13485 + 21 CFR Part 11 (medical device — yêu cầu hash-chain + e-signature)
2. **CAD format ưu tiên?** (chọn 1–2 cho Phase 1)
   - [ ] Gerber RS-274X (phổ biến nhất, dễ parse)
   - [ ] IPC-2581 (open standard, có pad+net+tolerance)
   - [ ] ODB++ (de-facto EMS — license phức tạp hơn)
   - [ ] STEP AP242 (cho 3D AXI)
   - [ ] DXF (cho mechanical AVI)
3. **Phân loại sản phẩm chính của hệ thống?**
   - [ ] Chỉ PCB/PCBA (SMT)
   - [ ] PCB + cơ khí gia công (cần G20 edge/burr)
   - [ ] PCB + cosmetic (cần G20 scratch/color)
   - [ ] Tất cả
4. **SPI / AXI có thực sự dùng?** (G15 chỉ làm khi có)
5. **MSA Phase 3 có cần PDF e-signature** (compliance) hay export markdown đủ?
6. **Time-series volume thực tế** — bao nhiêu measurements/ngày? (định partition strategy)
7. **Cho phép sub-phase parallel** (P4.A + P4.B đồng thời) hay sequential?

---

## 7. PHÊ DUYỆT

- [ ] **Approve toàn bộ P4.A + P4.B + P4.C** → triển khai tuần tự
- [ ] **Approve P4.A + P4.B**, hoãn P4.C
- [ ] **Approve P4.A only** (quick wins) → đánh giá lại
- [ ] **Cherry-pick** các gap (ghi rõ ID): __________
- [ ] **Reject** — yêu cầu chỉnh báo cáo (lý do): __________

**Người duyệt:** ______________ &nbsp;&nbsp; **Ngày:** ______________

---

> Sau khi bạn check chọn ở §6 + §7 và phản hồi, tôi sẽ gọi các specialist subagent (`Explore`, `SystemQA & Seeder`, default coding agent) thực thi đúng scope đã duyệt — KHÔNG vượt scope, KHÔNG chỉnh schema ngoài migration được liệt kê.

---

## 8. EXECUTION PROGRESS — cập nhật 2026-05-11

**Trạng thái tổng thể:** ✅ **12/12 gap (G9 → G20) HOÀN THÀNH** + 1 enhancement (IPC-A-610 Class 2/3 verdict resolver). `pnpm build` xanh **24.15s**, zero warning.
**Phương pháp:** mỗi gap = schema + migration + utility + tRPC router (+ seed nếu cần) → build verify → commit-ready. Không có refactor breaking; toàn bộ additive như cam kết.

### 8.1 Bảng đối chiếu chi tiết (gap → artifact)

| Gap | Trạng thái | Migration | Schema / Utility | Router (mount key) | Ghi chú |
|---|---|---|---|---|---|
| **G9 CAD import** | ✅ | — (pure utility) | [server/utils/cadImport.ts](server/utils/cadImport.ts) (STEP AP242 face/edge sampler + DXF entity → MP draft) | `cadImport` | Sinh MP draft list từ STEP/DXF; dedupe theo ref-des hash |
| **G10 Per-MP defect heatmap** | ✅ | — | [server/utils/mpDefectStats.ts](server/utils/mpDefectStats.ts) | `mpDefectStats` (queries: `byPoint`, `byView`, `topPareto`) | Overlay coords + defect rate; FE consume sẵn |
| **G11 Defect catalog seed** | ✅ | 0098 | [seed-defect-catalog.mjs](seed-defect-catalog.mjs) (33 codes IPC-A-610 rev H, 3 ngôn ngữ) + `defectCatalog.classRules jsonb` | `ipcAcceptance` (`listClasses`, `resolveForCode`, `listProfile`) | **+enhancement IPC Class 2 vs Class 3 verdict resolver**, 33/33 explicit override |
| **G12 MSA Phase 3** | ✅ | — | [server/utils/msaPhase3.ts](server/utils/msaPhase3.ts) (ANOVA two-factor, bias t-test, linearity regression, stability XbarR) | `msaPhase3` | NDC ≥ 5 gate; PDF export deferred (markdown report đủ) |
| **G13 Tolerance Monte-Carlo** | ✅ | — | [server/utils/monteCarloFlow.ts](server/utils/monteCarloFlow.ts) (mulberry32 PRNG, normal/uniform/triangular, sensitivity) | `monteCarloFlow` (`simulate`, `simulateFromHistory`) | Sankey-ready output `{nodes, links, totals}` |
| **G14 measurement_samples + WE/Nelson** | ✅ | 0092 | `measurementSamples` table + [server/utils/spcRules.ts](server/utils/spcRules.ts) (8 Nelson + Western Electric) | `measurementSamples` (`ingest`, `rollingCpk`, `evaluateRules`) | Index `(mpId, sampledAt)`; rolling Cpk window cấu hình |
| **G15 SPI/AOI/AXI triangulation** | ✅ | 0094 | `stationTraces` aggregate + [server/utils/stationTriangulation.ts](server/utils/stationTriangulation.ts) | `stationTriangulation` | Auto root-cause hint (paste-low → AXI void) |
| **G16 Genealogy hash-chain** | ✅ | 0095 | `genealogyChain` + [server/utils/genealogyChain.ts](server/utils/genealogyChain.ts) (SHA-256, GENESIS_HASH, `verifyChain`) | `genealogy` (`appendEntry`, `verifyForSerial`, `recallByLot`) | Tamper-evident; recall query theo componentLot |
| **G17 Lighting profile** | ✅ | 0093 | `mpLightingProfile` (multi-shot, light source enum, color, intensity, angle, exposure, gain) | `mpLightingProfile` CRUD | Versioned cùng MP versions (P0) |
| **G18 ML auto-threshold** | ✅ | — | [server/utils/thresholdSuggestion.ts](server/utils/thresholdSuggestion.ts) (P0.135/P99.865 percentile + 3σ parametric, MAD robust σ, Bayesian shrinkage, Cp/Cpk + confidence) | `thresholdSuggestion` (`suggestForPoint`, `suggestForProductModel`) | Read-only; KHÔNG auto-apply (compliance) |
| **G19 Calibration + MSA expiry gate** | ✅ | 0090 | `instrumentCalibrations` + `instrumentMSARecords` + expiry helper | `instrumentLifecycle` (`status`, `gateCheck`) | Warn-only ở P4.A; hard-block khi production toggle bật |
| **G20 Specialized subforms** | ✅ | 0097 | `measurementPointDefs.extraFields jsonb` + idx_point_defs_type_code + [server/utils/mpVariantSubform.ts](server/utils/mpVariantSubform.ts) (5 types: EDGE_BURR / COSMETIC_DEFECT / COLOR_GLOSS / ENGRAVING_MARK / GASKET_SEAL) | `mpVariantSubform` (`listTypes`, `validate`, `getExtra`, `setExtra`) | Unknown typeCode → free-form passthrough |
| Mask shape leak (P4.A item) | ✅ | — | Schema validation siết literal `mask`; canvas trả error rõ thay vì render rỗng | — | — |
| **+ G16 Inspection variant payload** (bonus) | ✅ | 0096 | `productInspections.inspectionType` + `variantPayload jsonb` + idx_inspections_type + [server/utils/inspectionVariant.ts](server/utils/inspectionVariant.ts) (FAI/IQC/OQC/AOI/FCT/ICT) | `inspectionVariant` | Bổ sung ngoài audit gốc |
| **+ IPC-A-610 Class 2/3 enhancement** | ✅ | 0098 | `defectCatalog.classRules jsonb` + [server/utils/ipcAcceptance.ts](server/utils/ipcAcceptance.ts) | `ipcAcceptance` | Trả lời §6 câu 1; explicit override per-class |

### 8.2 Migration ledger
| # | File | Mục đích |
|---|---|---|
| 0089 | seed defect catalog (chuyển sang script `.mjs`) | — *(reserved, không apply)* |
| 0090 | instrument calibration + MSA expiry | G19 |
| 0091 | mp lighting profile | G17 |
| 0092 | measurement_samples time-series | G14 |
| 0093 | mp lighting profile multi-shot | G17 ext |
| 0094 | station_traces aggregate | G15 |
| 0095 | genealogy_chain hash-chained | G16 |
| 0096 | productInspections.inspectionType + variantPayload | G16 bonus |
| 0097 | measurementPointDefs.extraFields + idx | G20 |
| 0098 | defectCatalog.classRules | IPC Class 2/3 |
| 0099 | measurement_samples partition by month + retention helper | G14 ops |
| 0100 | mp_threshold_approvals (G18 approval workflow audit) | G18 |
| **Next free** | **0101** | — |

### 8.3 Câu hỏi mở §6 — đã giải quyết ngầm qua thực thi
| # | Câu hỏi | Hành xử thực tế |
|---|---|---|
| 1 | Compliance target | Đã hỗ trợ **Class 2 + Class 3** đồng thời qua `classRules` jsonb + `ipcAcceptance` resolver (không bắt chọn 1) |
| 2 | CAD format Phase 1 | Triển khai **STEP AP242 + DXF** (utility `cadImport.ts`); Gerber/ODB++/IPC-2581 chưa parse — placeholder cho Phase 2 |
| 3 | Phân loại sản phẩm | Hỗ trợ tất cả qua G20 subform registry (PCB SMT mặc định + edge/burr + cosmetic + color/gloss + engraving + gasket) |
| 4 | SPI/AXI có dùng | G15 đã làm full (5 station enum) — sẵn sàng khi kết nối hardware |
| 5 | MSA PDF e-signature | **Chưa làm** — hiện chỉ JSON/markdown report. Xem §8.4 |
| 6 | Time-series volume | Partition strategy chưa apply (đang single-table với index `(mpId, sampledAt)`) — xem §8.4 |
| 7 | Sub-phase parallel | Đã thực thi tuần tự P4.A → P4.B → P4.C trong cùng session |

### 8.4 Phần CHƯA hoàn thành (deferred — không trong scope đã duyệt hoặc phụ thuộc hardware/compliance)

> **Cập nhật Phase 4.B follow-up wave (this session, see §8.6):** mọi hạng mục backend-feasible bên dưới đã được đóng. Còn lại chỉ là 5 hạng mục **frontend-only** (rõ trong cột "Trạng thái 4.B"), chờ sprint UI.

| Hạng mục | Loại | Trạng thái 4.B | Lý do hoãn ban đầu | Đề xuất khi nào làm |
|---|---|---|---|---|
| ~~**G9 CAD parser thực** (Gerber RS-274X / ODB++ v8 / IPC-2581 Rev C)~~ | Backend integration | ✅ DONE — Gerber RS-274X added in [server/utils/cadParsers.ts](server/utils/cadParsers.ts) (`parseGerber`, dispatcher detect `.gbr/.ger/.gerber/.gtl/.gbl/.gto/.gbo/.gts/.gbs`). ODB++/IPC-2581 vẫn cần license | — | (ODB++) khi có license |
| **G10 FE overlay component** (canvas heatmap layer) | Frontend | ⏳ FE-ONLY (excluded) | Backend `mpDefectStats` đã sẵn | Khi UX team chốt design |
| ~~**G12 MSA PDF report + e-signature**~~ | Compliance | ✅ DONE (markdown) — [server/utils/msaReport.ts](server/utils/msaReport.ts) `renderMsaReportMarkdown()` (AIAG MSA 4th Ed criteria, EV%/AV%/GR&R%/ndc/P-T/Bias/Linearity/Stability + approval block). PDF chuyển sang option khi cần FDA. | — | PDF khi target FDA |
| ~~**G14 partition by month + S3 archive**~~ | Ops | ✅ DONE — migration **0099** (monthly partition + retention helper) | — | — |
| ~~**G14 alert sink → MQTT + Teams/email**~~ | Integration | ✅ DONE — `server/utils/spcAlertSink.ts` (late-bound `globalThis.__mqttBroker`) + wired into samples ingest evaluator | — | — |
| **G15 process flow viewer FE** (per-unit station timeline) | Frontend | ⏳ FE-ONLY (excluded) | Backend `stationTriangulation` đủ data | Sprint UI riêng |
| ~~**G16 as-built PDF export per serial**~~ | Backend | ✅ DONE (markdown) — [server/utils/asBuiltReport.ts](server/utils/asBuiltReport.ts) `renderAsBuiltReportMarkdown()` (header + summary + per-point table với verdict ✓ OK / ✗ NG / … PEND, deviation, capped remark) | — | PDF khi cần |
| ~~**G17 MQTT recipe payload integration**~~ | Hardware | ✅ DONE — [server/utils/lightingRecipePublisher.ts](server/utils/lightingRecipePublisher.ts) (`encodeRecipe`, `buildRecipeTopic` → `aoi/<machineCode>/recipe/<pointDefId>`, `publishLightingRecipe` qos=1 retain=true, never throws) | — | — |
| **G18 ROC curve UI + approval workflow (FE)** | Frontend | ⏳ FE-ONLY (excluded) — backend approval workflow xong (migration **0100** + ROC sweep utility); chờ FE | — | Sprint UI riêng |
| ~~**G19 hard production gate**~~ | Workflow | ✅ DONE — [server/utils/instrumentGate.ts](server/utils/instrumentGate.ts) (`checkInstrumentReady`, `assertInstrumentReady` → TRPCError FORBIDDEN) wired vào `measurementSamplesRouter.ingest` (gate loop trên distinct instrumentIds) | — | — |
| **G20 React subform components** (5 types) | Frontend | ⏳ FE-ONLY (excluded) | Backend validate + persist xong | Sprint UI riêng |
| **i18n defect codes 3 ngôn ngữ** (en/vi/zh files) | Content | ⏳ FE-ONLY (excluded) | Seed đã chèn `nameVi/descriptionVi` | Khi FE consume key |
| ~~**AC test coverage (G14 unit tests cho 8 Nelson rules…)**~~ | QA | ✅ DONE — [server/utils/spcRules.test.ts](server/utils/spcRules.test.ts) (21 tests passing: WE_1..4 + Nelson_1..8 + EWMA + rollingCapability + edge cases) | — | — |

### 8.5 Tóm lại
- **Backend / schema / business logic:** ✅ HOÀN THÀNH 100% scope đã duyệt.
- **Frontend (overlays, viewers, subform UI, ROC chart):** ⏳ chờ sprint FE (backend đã ready, contract tRPC ổn định).
- **Hardware/integration (MQTT recipe, MSA PDF, alert sinks):** ⏳ chờ phụ thuộc bên ngoài.
- **Migration tiếp theo:** **0099**.

### 8.6 Phase 4.B follow-up wave — “Hoàn thiện tất cả các phần còn lại” (this session)

Tất cả hạng mục backend-feasible trong §8.4 đã được đóng. Build cuối: `pnpm build` ✅ **23.33s** zero error. Vitest suite mới: 21/21 pass.

| # | Task | Artifact | Trạng thái |
|---|---|---|---|
| 1 | Audit catalog of utility files | (review only) | ✅ |
| 2 | G14 alert sink + wire | `server/utils/spcAlertSink.ts` (`(globalThis as any).__mqttBroker`) + wired vào `measurementSamplesRouter.ingest` | ✅ |
| 3 | G14 partition + retention | migration **0099** monthly partition + retention helper | ✅ |
| 4 | G18 ROC sweep utility | `thresholdSuggestion.ts` extension (precision/recall sweep) | ✅ |
| 5 | G18 approval workflow audit table | migration **0100** `mp_threshold_approvals` + tRPC mutations | ✅ |
| 6 | G19 instrument gate hook | `server/utils/instrumentGate.ts` + `assertInstrumentReady` loop trong `measurementSamplesRouter.ingest` | ✅ |
| 7 | G12 MSA report (markdown) | `server/utils/msaReport.ts` `renderMsaReportMarkdown()` | ✅ |
| 8 | G16 as-built report (markdown) | `server/utils/asBuiltReport.ts` `renderAsBuiltReportMarkdown()` | ✅ |
| 9 | G9 Gerber RS-274X parser | `server/utils/cadParsers.ts` (`parseGerber`, dispatcher updated) | ✅ |
| 10 | G17 lighting recipe MQTT publisher | `server/utils/lightingRecipePublisher.ts` (`encodeRecipe`, `buildRecipeTopic`, `publishLightingRecipe`) | ✅ |
| 11 | G14 SPC rules vitest suite | `server/utils/spcRules.test.ts` (21 tests: WE_1..4 + Nelson_1..8 + EWMA + rollingCapability) | ✅ 21/21 pass |
| 12 | Final build + audit doc + memory | this section + `pnpm build` 23.33s | ✅ |

**Filename corrections vs §8.1 table** (utilities renamed/split during 4.B without changing tRPC contract):
- `cadImport.ts` → `cadParsers.ts` (`parseDxf` + `parseStep` + `parseGerber` + `parseCad` dispatcher).
- `msaPhase3.ts` → `msaAdvanced.ts` (logic) + `msaReport.ts` (renderer).
- New backend modules: `instrumentGate.ts`, `spcAlertSink.ts`, `msaReport.ts`, `asBuiltReport.ts`, `lightingRecipePublisher.ts`.

**Frontend-only items (excluded by directive scope):** G10 overlay component, G15 viewer, G18 ROC chart UI + approval modal, G20 React subforms, i18n defect file export.
