# Đo Thợ Cả 2026-11-09 (truc-h-baseline)

Trục H · commit `0302129a9` · 3 mẫu/bài · trần 16000 token
Model `Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf` · sha256 `707a55a8a4397ecde44de0c499d3e68c1ad1d240d1da65826b4949d1043f4450` · ctx 65536 · budget 12000
Cờ: `AI_AGENT_CONG_KE_HOACH=0` `AI_AGENT_CON_BAO_CAO=0` `AI_AGENT_CUU_TRAN=1` `AI_AGENT_DAU_RA_DAI=0` `AI_AGENT_DOC_TRUOC_KHI_GHI=0` `AI_AGENT_GIAO_VIEC=0` `AI_AGENT_GIU_NGHI=1` `AI_AGENT_HOUSEKEEPING_ENABLED=false` `AI_AGENT_KIEM_DAC_TA=1` `AI_AGENT_NEN_MOC=0` `AI_AGENT_NEN_SO_THAT=0` `AI_AGENT_NGHI=1` `AI_AGENT_THEO_VAI_TRO=1` `AI_AGENT_TIEP_TUC=0` `AI_AGENT_TOM_TAT_80=0` `AI_AGENT_TOOL_TIMEOUT=0` `AI_AGENT_TU_TRA_API=1` `AI_CODING_AUTOLOOP=0` `AI_CODING_TU_TRI_GHI=0`
Ghi chú: Baseline truc H. May :3013 tren aoi_management_test, vai avi_app, du an repo = worktree do, vong tu ghi tat, co khai tuong minh (NEN_MOC=0 tat, cong ke hoach tat), RAG embed CPU, llama-server :8091 khong restart. Khong so truc tiep voi H11.
**Tải máy: có tiến trình khác trong lúc đo, thời gian có thể méo.** dotnet 1/54 mẫu; slot bận 0 lượt; CPU TB 18 %, đỉnh 40 %

| Stack | Bài | Đạt | pass@1 TB | pass@N | Đạt từng mẫu | Cụt | Token ra TB | Giây TB |
|---|---|---|---|---|---|---|---|---|
| cpp | 3 | 6/9 | 66.7 % | 100.0 % | 1 · 2 · 3 | không đo | — | 25.7 |
| cs | 3 | 6/9 | 66.7 % | 66.7 % | 2 · 2 · 2 | không đo | — | 24.5 |
| ot-dotnet | 6 | 4/18 | 22.2 % | 33.3 % | 1 · 2 · 1 | không đo | — | 24.9 |
| ot-node | 5 | 2/15 | 13.3 % | 40.0 % | 0 · 0 · 2 | không đo | — | 25.7 |
| powershell | 5 | 8/15 | 53.3 % | 80.0 % | 2 · 3 · 3 | không đo | — | 23.2 |
| py | 3 | 5/9 | 55.6 % | 66.7 % | 2 · 2 · 1 | không đo | — | 21.2 |
| react | 4 | 11/12 | 91.7 % | 100.0 % | 3 · 4 · 4 | không đo | — | 18.5 |
| sql | 6 | 9/18 | 50.0 % | 66.7 % | 3 · 3 · 3 | không đo | — | 23.7 |
| ts | 3 | 5/9 | 55.6 % | 66.7 % | 1 · 2 · 2 | không đo | — | 29.6 |
| ts-thu-vien | 4 | 6/12 | 50.0 % | 75.0 % | 2 · 2 · 2 | không đo | — | 23.9 |
| **TỔNG** | 42 | 62/126 | 49.2 % | 66.7 % | 17 · 22 · 23 | không đo | — | 24.0 |

Chưa đo:
- pilot-repo (TC-02, TC-03, TC-04, TC-05): cần bộ chạy pilot và lượt _test

## Ghi chú sau đo (do-model, 10/11 00:50)

- **Lượt bị loại, không tính:** bài thử trục H đầu tiên lúc 23:15:59 (`2026-11-09-thu-h.*`, H-py1 trượt sau 23 ms) là lỗi thước đo. :3013 khi đó chỉ khai dự án `phatlai-f`, đường sản phẩm gửi `projectId: "repo"`, server trả lời từ chối dự án mà không gọi model, `run-eval` chấm thành bài trượt. Bước trục H của script đêm bị cắt sau 1 giây, không sinh báo cáo.
- **Sửa thước đo:** `0302129a9` (commit riêng): lời từ chối dự án là cấu hình sai, `run-eval` thoát 2 và không ghi báo cáo. Test mới đạt; gỡ chốt thì test đỏ.
- **Máy đo lần hai:** :3013 dựng lại 23:45 (pid 2744) với `repo` trỏ vào worktree `_ai9_do_d` và `AI_CODING_AUTOLOOP=0`, `AI_CODING_TU_TRI_GHI=0`. Kiểm `laYDinhTuTri` trên 42 prompt bộ khó + api2: 0 prompt vào vòng tự ghi, nên tắt hai cờ này không đổi nhánh của bài nào. Bài thử lần hai (`2026-11-09-thu-h-2.*`) đạt, câu trả lời là mã thật.
- **Worktree không bị ghi:** `git status --porcelain` trước và sau trục H đều rỗng, HEAD `0302129a9`.
- **Tải máy:** nhãn "dotnet 1/54 mẫu" nhiều khả năng là tiến trình build .NET do chính bước chấm bài `cs`/`ot-dotnet` để lại (tách khỏi cây tiến trình nên không bị loại), chưa xác minh.
- **Tách theo bộ:** bộ khó 22/36 (61,1 %, mẫu 6 · 8 · 8), api2 40/90 (44,4 %, mẫu 11 · 14 · 15). Trục M baseline lượt 1 (2026-11-08): bộ khó 53/72 (73,6 %, 6 mẫu), api2 36/90 (40,0 %). Khác số mẫu, khác máy chủ (`_test`, RAG embed CPU); chưa đủ để nói trục H kém hay hơn trục M. Bộ khó theo bài: H-cs2 0/3, H-py3 0/3, H-ts3 0/3, H-cpp3 1/3.
- **Không so trực tiếp với H11** (Đợt 11.0 đo trên Node khác và DB thật).
