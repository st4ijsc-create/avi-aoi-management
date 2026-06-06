# Bộ luật SPC (SPC Rule Catalog)

## 1. Mục đích
Liệt kê đầy đủ các luật SPC (Statistical Process Control) mà hệ thống AVI-AOI sử dụng để phát hiện điểm bất thường trên control chart và sinh cảnh báo `mp_spc_alerts`.

## 2. Vị trí
- Engine: `server/utils/spcRules.ts` (`detectSpcViolations`, `detectEwmaOoc`)
- Sink ghi DB: `server/utils/spcAlertSink.ts` → bảng `mp_spc_alerts`
- UI hiển thị vi phạm: `/spc-advanced` (tab Control Chart + Violations)

## 3. Tổng số luật: **13**
- **4 luật Western Electric**: `WE_1`, `WE_2`, `WE_3`, `WE_4`
- **8 luật Nelson**: `NELSON_1` … `NELSON_8`
- **1 luật EWMA**: `EWMA_OOC`

## 4. Chi tiết từng luật

### 4.1 Western Electric (4)
| Mã | Mô tả | Mức |
|---|---|---|
| `WE_1` | 1 điểm vượt ±3σ | critical |
| `WE_2` | 2/3 điểm liên tiếp vượt ±2σ cùng phía | warn |
| `WE_3` | 4/5 điểm liên tiếp vượt ±1σ cùng phía | warn |
| `WE_4` | 8 điểm liên tiếp cùng phía mean | warn |

### 4.2 Nelson (8)
| Mã | Mô tả | Mức |
|---|---|---|
| `NELSON_1` | 1 điểm > 3σ so với mean | critical |
| `NELSON_2` | 9 điểm liên tiếp cùng phía mean | warn |
| `NELSON_3` | 6 điểm liên tiếp tăng/giảm đơn điệu | warn |
| `NELSON_4` | 14 điểm xen kẽ tăng/giảm | warn |
| `NELSON_5` | 2/3 điểm liên tiếp > 2σ cùng phía | warn |
| `NELSON_6` | 4/5 điểm liên tiếp > 1σ cùng phía | warn |
| `NELSON_7` | 15 điểm liên tiếp trong ±1σ (stratification) | warn |
| `NELSON_8` | 8 điểm liên tiếp > 1σ về cả hai phía | warn |

### 4.3 EWMA (1)
| Mã | Mô tả | Mức |
|---|---|---|
| `EWMA_OOC` | Giá trị EWMA vượt giới hạn kiểm soát λ-weighted | critical |

## 5. Tiền điều kiện
- Có ≥ N điểm dữ liệu liên tiếp tuỳ theo luật (vd Nelson_7 cần ≥15 điểm).
- `SpcLimits = { mean, sigma }` đã được tính từ baseline (xem `spcAdvancedRouter.computeLimits`).

## 6. API liên quan
- `trpc.spcAdvanced.getViolations({ pointDefId, from, to })`
- `trpc.spcAdvanced.computeLimits({ pointDefId, baselineDays })`
- `trpc.spcAdvanced.getControlChart({ pointDefId, from, to })`
- REST: `/api/spc/violations`, `/api/spc/control-chart`

## 7. Code tham chiếu
```ts
// server/utils/spcRules.ts
const RULES: Record<string, string> = {
  WE_1: "1 point beyond ±3σ (WE Rule 1)",
  WE_2: "2 of 3 consecutive points beyond ±2σ on same side (WE Rule 2)",
  WE_3: "4 of 5 consecutive points beyond ±1σ on same side (WE Rule 3)",
  WE_4: "8 consecutive points on same side of mean (WE Rule 4)",
  NELSON_1: "1 point > 3σ from mean (Nelson 1)",
  NELSON_2: "9 points in a row on same side of mean (Nelson 2)",
  NELSON_3: "6 points in a row monotonically increasing or decreasing (Nelson 3)",
  NELSON_4: "14 points alternating up/down (Nelson 4)",
  NELSON_5: "2 of 3 consecutive points > 2σ same side (Nelson 5)",
  NELSON_6: "4 of 5 consecutive points > 1σ same side (Nelson 6)",
  NELSON_7: "15 points in a row within ±1σ (stratification) (Nelson 7)",
  NELSON_8: "8 points in a row > 1σ from mean either side (Nelson 8)",
  EWMA_OOC: "EWMA value beyond control limits",
};
```

## 8. Lỗi thường gặp
- Quá nhiều `WE_4`/`NELSON_2` cảnh báo → kiểm tra mean/sigma có bị lệch baseline không, recompute limits.
- Không bao giờ thấy `NELSON_4`/`NELSON_7` → cần ≥14/15 điểm; tăng baseline window.
- `EWMA_OOC` quá nhạy → giảm λ trong `detectEwmaOoc({ lambda: 0.2 })` (mặc định 0.3).

## 9. Tính năng liên quan
- [SPC Analysis](analytics/spc-analysis.md)
- [SPC Advanced (Control Chart)](analytics/spc-advanced.md)

## 10. Q&A nhanh

**Q: SPC có bao nhiêu rules?**
A: Hệ thống AVI-AOI dùng tổng cộng **13 luật SPC**: 4 luật Western Electric (`WE_1`..`WE_4`), 8 luật Nelson (`NELSON_1`..`NELSON_8`) và 1 luật EWMA (`EWMA_OOC`).

**Q: Các rules của SPC là gì?**
A: 13 rules chia 3 nhóm:
- **Western Electric (4)**: `WE_1` (1 điểm vượt ±3σ — critical), `WE_2` (2/3 điểm vượt ±2σ cùng phía), `WE_3` (4/5 điểm vượt ±1σ cùng phía), `WE_4` (8 điểm liên tiếp cùng phía mean).
- **Nelson (8)**: `NELSON_1` (1 điểm >3σ), `NELSON_2` (9 điểm cùng phía), `NELSON_3` (6 điểm tăng/giảm đơn điệu), `NELSON_4` (14 điểm xen kẽ), `NELSON_5` (2/3 điểm >2σ cùng phía), `NELSON_6` (4/5 điểm >1σ cùng phía), `NELSON_7` (15 điểm trong ±1σ — stratification), `NELSON_8` (8 điểm >1σ về cả hai phía).
- **EWMA (1)**: `EWMA_OOC` (giá trị EWMA vượt giới hạn λ-weighted — critical).

**Q: SPC là gì?**
A: SPC (Statistical Process Control) là phương pháp dùng biểu đồ kiểm soát thống kê để giám sát ổn định của quá trình sản xuất. Trong AVI-AOI, engine `server/utils/spcRules.ts` áp dụng 13 luật trên dữ liệu measurement point để phát hiện điểm bất thường và sinh cảnh báo vào bảng `mp_spc_alerts`.

**Q: WE_1 và NELSON_1 khác nhau thế nào?**
A: Cả hai đều phát hiện 1 điểm vượt ±3σ và đều gắn mức `critical`. `WE_1` thuộc bộ Western Electric (chuẩn AT&T 1956), `NELSON_1` thuộc bộ Nelson (1984). Engine chạy cả hai để giữ tương thích với hai chuẩn được khách hàng yêu cầu khác nhau.

**Q: EWMA_OOC dùng λ mặc định bao nhiêu?**
A: λ mặc định là `0.3` trong `detectEwmaOoc`. Có thể giảm xuống `0.2` nếu cảnh báo quá nhạy.
