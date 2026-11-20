/**
 * Lô D1d C3 (chủ dự án 20/11): thư mục log của llama-server nằm NGOÀI repo và ngoài mọi gốc sandbox (log có 4 ký tự cuối của khoá).
 * MỘT nguồn cho câu báo của :3000. Phải CÙNG tiền tố với mặc định `-ThuMucLog` của start-llama-server.ps1 / khoi-llama-tay.ps1 /
 * doi-model.ps1 và với chuỗi tooltip phía khách (ttAiLocal.tipBoCuoc): luật K2-LOG-NGOAI-REPO (scripts/ai-eval/d1/k2-tinh.mjs) so các nguồn.
 */
export const THU_MUC_LOG_LLAMA = "D:\\LLAMA-LOGS";
/** Mẫu tên tệp log lỗi của start-llama-server (thư mục con `server`), dùng trong câu báo cho người vận hành. */
export const LOG_LOI_LLAMA_SERVER = `${THU_MUC_LOG_LLAMA}\\server\\llama-server-*.err.log`;
