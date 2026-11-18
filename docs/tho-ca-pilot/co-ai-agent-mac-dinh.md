# Cờ `AI_AGENT_*` — giá trị MẶC ĐỊNH và nơi đọc (tho-ca-agent, 2026-11-09; chỉ đọc mã @ feat/tho-ca-pilot-runner, main 1b4930fa9)

Quy ước "bật": ✔ = bật khi vắng biến · ✘ = tắt khi vắng biến. Mọi cờ đọc TẠI CHỖ DÙNG từ `process.env` (đổi biến ⇒ lượt chạy kế tiếp thấy ngay, không cần khởi động lại), trừ khi ghi khác.

## Cờ đổi hành vi MODEL / vòng agent (liên quan A/B C6)
| Cờ | Mặc định | Giá trị nhận | Nơi đọc | Ghi chú |
|---|---|---|---|---|
| `AI_AGENT_THEO_VAI_TRO` | ✔ BẬT | tắt khi `0/false/off/no` | `vaiTroTacNhan.ts:43` (`tacNhanTheoVaiTroBat`); `quanLyLuotChay.ts` (chọn model theo vai) | chọn model code.plc / code.software |
| `AI_AGENT_NGHI` | ✔ BẬT (`"1"`) | tắt CHỈ khi `0` | `goiModelMayChu.ts:149` | chế độ suy luận (thinking) của lượt model |
| `AI_AGENT_MAX_TOKENS_MOT_LUOT` | 16 000 | số ≥ 256 | `goiModelMayChu.ts:153` (`TRAN_TOKEN_MOT_LUOT_MAC_DINH` dòng 32) | trần token sinh mỗi lượt model |
| `AI_AGENT_GIU_NGHI` | ✔ BẬT | tắt khi `0/false/off/no` | `quanLyLuotChay.ts:1075` → `giuNghiBat` (`shared/agentCore/vongAgent.ts:262`) | giữ suy luận trong lịch sử; tắt khi `capNgoai` (model ngoài) |
| `AI_AGENT_CUU_TRAN` | ✔ BẬT | như trên | `quanLyLuotChay.ts:1083` → `giuNghiBat` | cứu trần ngữ cảnh |
| `AI_AGENT_KIEM_DAC_TA` | ✔ BẬT | như trên | `quanLyLuotChay.ts:1073` → `kiemDacTaBat` (`vongAgent.ts:248`) | kiểm đặc tả |
| `AI_AGENT_NEN_MOC` | ✘ TẮT (`undefined`) | số thực trong [0,30 ; 0,65], ngoài khoảng/không số ⇒ tắt | `quanLyLuotChay.ts:1079` → `nenMocDich` (`vongAgent.ts:270`) | nén ngữ cảnh theo mục đích; `.env` dự án đặt 0.5 ⇒ BẬT khi nạp `--env-tu` |
| `AI_AGENT_NEN_SO_THAT` | ✘ TẮT | bật CHỈ khi `"1"` | `quanLyLuotChay.ts:1081` | đếm ngữ cảnh số thật |
| `AI_AGENT_TOM_TAT_80` | ✘ TẮT | bật CHỈ khi `"1"` | `quanLyLuotChay.ts:1077` (`quanLyLuotChay` còn xoá/đặt tạm ở 668–681) | nhắc tóm tắt khi đầy 80 % |
| `AI_AGENT_DOC_TRUOC_KHI_GHI` | ✘ TẮT | bật CHỈ khi `"1"` | `boThucThiMayChu.ts:502` (`docTruocKhiGhiBat`); `quanLyLuotChay.ts:911` | bắt đọc tệp trước khi ghi |
| `AI_AGENT_TOOL_TIMEOUT` | ✘ TẮT | bật CHỈ khi `"1"` | `boThucThiMayChu.ts:494` (`hanGioToolBat`); `quanLyLuotChay.ts:913` | hạn giờ từng tool |
| `AI_AGENT_DAU_RA_DAI` | ✘ TẮT | bật CHỈ khi `"1"` | `khoDauRaDai.ts:326` (`dauRaDaiBat`); `quanLyLuotChay.ts:898` | kho đầu ra dài |
| `AI_AGENT_TU_TRA_API` | ✔ BẬT | tắt khi `0/false/off/no` | `apiRef/goiYLoiBienDich.ts:44` (`tuTraApiBat`) | tự tra API khi lỗi biên dịch |
| `AI_AGENT_AN_CONG_CU` | rỗng (không ẩn) | danh sách tên tool cách nhau `,` | `boThucThiMayChu.ts:157` (`congCuBiAn`) | ẩn tool khỏi model |

## Cờ về cổng / cấp quyền / tính năng phụ
| Cờ | Mặc định | Giá trị nhận | Nơi đọc | Ghi chú |
|---|---|---|---|---|
| `AI_AGENT_CONG_KE_HOACH` | ✘ TẮT | bật CHỈ khi `"1"`; bỏ qua khi `cheDo="hoi"` | `quanLyLuotChay.ts:895` | cổng duyệt kế hoạch 11.3-C. **CHƯA kiem-dinh rà** (dieu-phoi 2026-11-08) ⇒ mặc định không đổi |
| `AI_AGENT_TIEP_TUC` | ✘ TẮT | bật CHỈ khi `"1"` | `quanLyLuotChay.ts:717` → `tiepTucBat` (`khoLichSuLuot.ts:18`) | tiếp tục lượt |
| `AI_AGENT_GIAO_VIEC` | ✘ TẮT | bật CHỈ khi `"1"` | `quanLyLuotChay.ts:139` (`giaoViecBat`) | công tắc MÁY CHỦ cho `delegate` (agent con) |
| `AI_AGENT_CON_BAO_CAO` | ✘ TẮT | bật CHỈ khi `"1"` | `quanLyLuotChay.ts:981` | agent con có báo cáo |
| `AI_AGENT_UOC_LUONG_TOKEN` | 64 000 | số > 0 | `vaiTroTacNhan.ts:54` | ước lượng token một lượt cho cổng quota |
| `AI_AGENT_HOUSEKEEPING_ENABLED` | ✔ BẬT (`"true"`) | tắt CHỈ khi `false` | `aiAgentHousekeepingScheduler.ts:45`; `_core/backgroundJobs.ts:205` | cron dọn phiên/pending cũ; KHÔNG đổi hành vi model |
| `AI_AGENT_HOUSEKEEPING_INTERVAL_MS` | 300 000 (5 phút) | ≥ 30 000 | `aiAgentHousekeepingScheduler.ts:49` | nhịp cron dọn |

`AI_AGENT_TU_DONG` và `AI_AGENT_HOAN_TAC` KHÔNG phải công tắc: là chuỗi nhãn lý do (`LY_DO_AGENT_TU_DONG`, `LY_DO_HOAN_TAC`) ghi vào `confirmAction`/audit.

## Hệ quả cho lượt pilot (bộ chạy `napEnv.ts`, `--env-tu`)
- Nạp CÓ LỌC mọi khoá tiền tố `AI_AGENT_` trong `.env` (trừ tên có API_KEY/SECRET/PASSWORD/TOKEN/CREDENTIAL). `.env` dự án hiện chỉ có `AI_AGENT_HOUSEKEEPING_ENABLED=true` và `AI_AGENT_NEN_MOC=0.5` ⇒ lượt TC-05 chạy: THEO_VAI_TRO/NGHI/GIU_NGHI/CUU_TRAN/KIEM_DAC_TA/TU_TRA_API BẬT mặc định, NEN_MOC BẬT 0.5, mọi cờ ✘ ở trên TẮT.
- Đổi cờ nào ngoài mặc định cho một lượt đo ⇒ phải đặt TƯỜNG MINH trong env tiến trình của bộ chạy và ghi vào đánh-giá; không nên để `.env` bật ngầm (cổng kế hoạch sẽ có danh sách cấm cứng riêng).
