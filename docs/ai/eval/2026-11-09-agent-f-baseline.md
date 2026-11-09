# Đo Thợ Cả 2026-11-09 (agent-f-baseline)

Trục M · commit `a4eb85df4` · 3 mẫu/bài · trần 16000 token
Model `Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf` · sha256 `707a55a8a4397ecde44de0c499d3e68c1ad1d240d1da65826b4949d1043f4450` · ctx 65536 · budget 12000
Cờ: `AI_AGENT_CONG_KE_HOACH=0` `AI_AGENT_CON_BAO_CAO=0` `AI_AGENT_CUU_TRAN=1` `AI_AGENT_DAU_RA_DAI=0` `AI_AGENT_DOC_TRUOC_KHI_GHI=0` `AI_AGENT_GIAO_VIEC=0` `AI_AGENT_GIU_NGHI=1` `AI_AGENT_HOUSEKEEPING_ENABLED=false` `AI_AGENT_KIEM_DAC_TA=1` `AI_AGENT_NEN_MOC=0` `AI_AGENT_NEN_SO_THAT=0` `AI_AGENT_NGHI=1` `AI_AGENT_THEO_VAI_TRO=1` `AI_AGENT_TIEP_TUC=0` `AI_AGENT_TOM_TAT_80=0` `AI_AGENT_TOOL_TIMEOUT=0` `AI_AGENT_TU_TRA_API=1`
Ghi chú: Baseline agent-f. May :3013 tren aoi_management_test, vai avi_app, co khai tuong minh (NEN_MOC=0 tat, cong ke hoach tat), RAG embed CPU, llama-server :8091 khong restart.
Tải máy: không thấy tiến trình nặng, slot không bận (1 mẫu, CPU TB 33 %, đỉnh 33 %)

| Stack | Bài | Đạt | pass@1 TB | pass@N | Đạt từng mẫu | Cụt | Token ra TB | Giây TB |
|---|---|---|---|---|---|---|---|---|
| cs | 2 | 3/6 | 50.0 % | 100.0 % | 1 · 2 · 0 | không đo | 15209 | 89.9 |
| js | 1 | 3/3 | 100.0 % | 100.0 % | 1 · 1 · 1 | không đo | 12224 | 70.5 |
| py | 2 | 3/6 | 50.0 % | 50.0 % | 1 · 1 · 1 | không đo | 17398 | 98.2 |
| ts | 1 | 3/3 | 100.0 % | 100.0 % | 1 · 1 · 1 | không đo | 12761 | 72.5 |
| **TỔNG** | 6 | 12/18 | 66.7 % | 83.3 % | 4 · 5 · 3 | không đo | 15033 | 86.5 |

Chưa đo:
- pilot-repo (TC-02, TC-03, TC-04, TC-05): cần bộ chạy pilot và lượt _test

## Ghi chú sau đo (do-model, 10/11 00:50)

- **Nhãn trục sai:** dòng đầu ghi "Trục M" vì `run-eval` không được truyền `--truc`. agent-f thực tế chạy qua agent của server :3013 (`run-f --project-id phatlai-f`, cookie người dùng đo), không gọi thẳng llama-server.
- **Tải máy:** chỉ có 1 mẫu tải trong cả đợt agent-f, nên nhãn "không thấy tiến trình nặng" không có giá trị.
- **Bài thử** `2026-11-09-thu-f.*` (js-cli-viec 10/12, 23:16) là lượt thử đường chạy, không tính.
- **Theo bài:** js-cli-viec 3/3, ts-gio-hang 3/3, py-kho-cache 3/3, cs-dat-phong 2/3, cs-nhat-ky 1/3, py-dang-ky 0/3 (cả ba lượt trượt đúng 1 test, 13/14).
- **Hàng trên `_test` của người dùng đo** (id 223473, đếm 00:45, giờ UTC): `ai_agent_runs` 19 (16:16–16:42, đều `xong`), `ai_pending_actions` 193 (188 `executed`, 5 `bi_tu_choi_ghi`, không thẻ nào treo), `ai_llm_audit` 146, `ai_gateway_metrics` 630, `audit_logs` 581, `user_sessions` 2; cộng hàng gieo `users`, `user_secrets`, `factories`, `user_factory_assignments`. Không DELETE.
- Worktree sau agent-f không còn tệp đổi (bộ chạy run-f khôi phục `sandbox-projects/agent-f`).
