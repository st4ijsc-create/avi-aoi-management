/**
 * Pilot "Thợ Cả nhận việc" — nạp CÓ LỌC các khoá cấu hình MODEL từ một tệp env (do người chạy chỉ đường, `--env-tu <đường>`).
 *
 * Vì sao: tiến trình pilot không có `.env` (worktree) ⇒ thiếu LLAMA_SERVER_ENABLED/MODEL, GGUF_*_MODEL ⇒ model null ⇒ `TOOL_CALL_KHONG_HO_TRO`.
 * Nạp NGUYÊN `.env` thì kéo cả DATABASE_URL (trỏ DEV!), khoá bí mật, cờ điều khiển thiết bị — nên chỉ nạp DANH SÁCH TRẮNG:
 *   • khoá tiền tố  AI_AGENT_  (cờ harness Thợ Cả: THEO_VAI_TRO, NEN_MOC, NGHI, GIU_NGHI, MAX_TOKENS_MOT_LUOT, …)
 *   • LLAMA_SERVER_ (ENABLED · URL · MODEL · CTX · CTX_PER_SLOT · SLOTS · PARALLEL · TIMEOUT_MS · STREAM_IDLE_TIMEOUT_MS · STRICT · HEALTH_TIMEOUT_MS)
 *   • GGUF_ (DEFAULT_MODEL · CODE_MODEL · FAST_MODEL · MODELS_DIR · DEFAULT_CTX · MAX_CTX · SEQUENCES …)
 *   • AI_THINKING_ · AI_SAMPLING_PROFILE · AI_CODING_MODEL_TASK · LLM_PRIORITY_GATE_
 * LOẠI CỨNG (kể cả khi khớp tiền tố): tên có API_KEY/SECRET/PASSWORD/TOKEN/CREDENTIAL; mọi DATABASE_/REDIS_/JWT_/SESSION_; AI_REPO_SANDBOX_ROOT(S)
 * (bộ chạy tự đặt); AI_GHI_LUOT_DIR; AI_AGENT_* không bao giờ gồm khoá cấm trên. KHÔNG ghi đè khoá ĐÃ có trong môi trường (giá trị đặt tường minh thắng).
 * Chỉ in TÊN khoá đã nạp, không in giá trị.
 */
import fs from "node:fs";

// ★ AI_AGENT_* KHÔNG còn nạp theo tiền tố từ tệp env (dieu-phoi 2026-11-09, sau TC-05): cờ harness đổi hành vi model, nạp ngầm từ `.env` làm số đo mất nghĩa
// (TC-05 lượt 1–2 chạy với AI_AGENT_NEN_MOC=0.5 chỉ vì `.env` có sẵn). Chỉ hai cờ vận hành KHÔNG đổi hành vi model được nạp; mọi cờ AI_AGENT_* khác
// phải khai TƯỜNG MINH ở lệnh chạy (`--co AI_AGENT_X=1,…`, hoặc `--cong-ke-hoach`) và được ghi vào JSON kết quả (`coAiAgent`).
const TIEN_TO = ["LLAMA_SERVER_", "GGUF_", "AI_THINKING_", "LLM_PRIORITY_GATE_"];
const CHINH_XAC = new Set(["AI_SAMPLING_PROFILE", "AI_CODING_MODEL_TASK", "AI_AGENT_HOUSEKEEPING_ENABLED", "AI_AGENT_HOUSEKEEPING_INTERVAL_MS"]);
const CAM = /(API_KEY|SECRET|PASSWORD|TOKEN|CREDENTIAL)/i;
const CAM_TIEN_TO = ["DATABASE_", "REDIS_", "JWT_", "SESSION_", "AI_REPO_SANDBOX_ROOT", "AI_GHI_LUOT_DIR"];

/**
 * Khoá cấu hình chỉ mang ĐƯỜNG DẪN tới tệp bí mật (KHÔNG mang bí mật): server đọc khoá :8091 qua `khoaLlamaServer` từ tệp này. Tên có "API_KEY" nên bộ lọc bí mật sẽ loại
 * nó và lượt pilot nhận 401 — cho phép ĐÚNG tên này (khớp nguyên văn). `LLAMA_SERVER_API_KEY` (giá trị khoá) vẫn BỊ LOẠI.
 * ⚠ Tệp phải nằm NGOÀI worktree pilot. Và lệnh kiểm / tsc do bộ chạy chạy KHÔNG được thừa kế biến này (xem `envSachChoTienTrinhCon` ở kiemChung.ts):
 * test do model viết chạy mã tuỳ ý, không được tự đọc được khoá.
 */
export const KHOA_DUONG_DAN_BI_MAT: ReadonlySet<string> = new Set(["LLAMA_SERVER_API_KEY_FILE"]);

export function khoaDuocNap(ten: string): boolean {
  if (KHOA_DUONG_DAN_BI_MAT.has(ten)) return true;
  if (CAM.test(ten)) return false;
  if (CAM_TIEN_TO.some((t) => ten.startsWith(t))) return false;
  return CHINH_XAC.has(ten) || TIEN_TO.some((t) => ten.startsWith(t));
}

/** Đọc văn bản dạng .env (KEY=VALUE, `#` chú thích, nháy đơn/đôi bao giá trị, `export `). THUẦN. Không nội suy biến. */
export function docEnvLoc(van: string): { nap: Record<string, string>; boQua: string[] } {
  const nap: Record<string, string> = {};
  const boQua: string[] = [];
  for (const dong0 of van.replace(/\r\n/g, "\n").split("\n")) {
    const dong = dong0.trim();
    if (dong === "" || dong.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(dong);
    if (!m) continue;
    const ten = m[1];
    let gt = m[2].trim();
    if ((gt.startsWith('"') && gt.endsWith('"') && gt.length >= 2) || (gt.startsWith("'") && gt.endsWith("'") && gt.length >= 2)) gt = gt.slice(1, -1);
    else gt = gt.replace(/\s+#.*$/, "");
    if (khoaDuocNap(ten)) nap[ten] = gt;
    else boQua.push(ten);
  }
  return { nap, boQua };
}

/** Nạp vào `env` các khoá được phép mà `env` CHƯA có. Trả tên đã nạp / đã bỏ vì đã có. */
export function napEnvTuTep(duong: string, env: NodeJS.ProcessEnv = process.env): { daNap: string[]; daCo: string[]; boQuaCoAgent: string[] } {
  const { nap, boQua } = docEnvLoc(fs.readFileSync(duong, "utf8"));
  const daNap: string[] = [];
  const daCo: string[] = [];
  for (const [k, v] of Object.entries(nap)) {
    if (env[k] !== undefined && env[k] !== "") daCo.push(k);
    else {
      env[k] = v;
      daNap.push(k);
    }
  }
  return { daNap: daNap.sort(), daCo: daCo.sort(), boQuaCoAgent: boQua.filter((k) => k.startsWith("AI_AGENT_") && !CAM.test(k)).sort() };
}

// ── Cờ AI_AGENT_* khai TƯỜNG MINH ở lệnh chạy ─────────────────────────────────────────────────────

const RE_CO_AGENT = /^AI_AGENT_[A-Z0-9_]+$/;

/** `--co A=1,B=2` ⇒ { A:"1", B:"2" }. Tên phải là AI_AGENT_* và không mang chữ bí mật; giá trị không rỗng, không khoảng trắng / dấu phẩy. THUẦN. */
export function docCoTuongMinh(chuoi: string | undefined): { co: Record<string, string>; loi: string[] } {
  const co: Record<string, string> = {};
  const loi: string[] = [];
  for (const phan of (chuoi ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
    const i = phan.indexOf("=");
    const ten = i < 0 ? phan : phan.slice(0, i).trim();
    const gt = i < 0 ? "" : phan.slice(i + 1).trim();
    if (!RE_CO_AGENT.test(ten) || CAM.test(ten)) loi.push(`cờ "${ten}" không hợp lệ (phải là AI_AGENT_*, không chứa API_KEY/SECRET/PASSWORD/TOKEN/CREDENTIAL)`);
    else if (gt === "" || /\s/.test(gt)) loi.push(`cờ ${ten}: giá trị rỗng hoặc có khoảng trắng`);
    else co[ten] = gt;
  }
  return { co, loi };
}

/** Đặt cờ tường minh vào `env` (GHI ĐÈ — người chạy khai thì thắng). Trả danh sách đã đặt. */
export function datCoTuongMinh(co: Record<string, string>, env: NodeJS.ProcessEnv = process.env): string[] {
  for (const [k, v] of Object.entries(co)) env[k] = v;
  return Object.keys(co).sort();
}

/**
 * DANH SÁCH CHO PHÉP các cờ AI_AGENT_* đã biết, MỖI CỜ MỘT KIỂU. Giá trị chỉ được ghi nguyên văn vào JSON/stderr khi khớp kiểu của cờ (số ⇒ RE_SO, bật/tắt ⇒ RE_BAT_TAT);
 * không khớp ⇒ `<không hợp lệ, độ dài N>` (một bí mật đặt nhầm vào biến không lộ); TÊN LẠ (không có trong bảng) ⇒ chỉ ghi tên, giá trị `<tên lạ, không ghi giá trị>`.
 * Thêm cờ mới vào harness ⇒ phải thêm tên vào bảng này (không thì JSON chỉ có tên, không có giá trị).
 */
const CO_KIEU_SO: ReadonlySet<string> = new Set([
  "AI_AGENT_SO_LUOT_TOI_DA",
  "AI_AGENT_NEN_MOC",
  "AI_AGENT_HOUSEKEEPING_INTERVAL_MS",
  "AI_AGENT_UOC_LUONG_TOKEN",
  "AI_AGENT_MAX_TOKENS_MOT_LUOT",
  "AI_AGENT_TOOL_TIMEOUT",
]);
const CO_KIEU_BAT_TAT: ReadonlySet<string> = new Set([
  "AI_AGENT_THEO_VAI_TRO",
  "AI_AGENT_AN_CONG_CU",
  "AI_AGENT_CONG_KE_HOACH",
  "AI_AGENT_GIU_NGHI",
  "AI_AGENT_CON_BAO_CAO",
  "AI_AGENT_TIEP_TUC",
  "AI_AGENT_DAU_RA_DAI",
  "AI_AGENT_TU_TRA_API",
  "AI_AGENT_HOUSEKEEPING_ENABLED",
  "AI_AGENT_GIAO_VIEC",
  "AI_AGENT_DOC_TRUOC_KHI_GHI",
  "AI_AGENT_TU_DONG",
  "AI_AGENT_NEN_SO_THAT",
  "AI_AGENT_CUU_TRAN",
  "AI_AGENT_TOM_TAT_80",
  "AI_AGENT_NGHI",
  "AI_AGENT_KIEM_DAC_TA",
  "AI_AGENT_HOAN_TAC",
]);
const RE_SO = /^[0-9.+-]{1,12}$/;
const RE_BAT_TAT = /^(?:true|false|0|1|on|off|yes|no)$/i;

/** Giá trị cờ ở dạng AN TOÀN để ghi báo cáo (xem bảng trên). THUẦN. */
export function giaTriCoAnToan(ten: string, gt: string): string {
  const kieu = CO_KIEU_SO.has(ten) ? RE_SO : CO_KIEU_BAT_TAT.has(ten) ? RE_BAT_TAT : null;
  if (kieu === null) return "<tên lạ, không ghi giá trị>";
  return kieu.test(gt) ? gt : `<không hợp lệ, độ dài ${gt.length}>`;
}

/** Mọi cờ AI_AGENT_* THỰC SỰ có trong `env` — ghi vào JSON kết quả / stderr để số đo nói rõ chạy với cờ nào. Giá trị CHỈ nguyên văn khi khớp kiểu của cờ đã biết (không bao giờ lộ bí mật đặt nhầm). */
export function coAiAgentHieuLuc(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const ra: Record<string, string> = {};
  for (const k of Object.keys(env).sort()) {
    if (k.startsWith("AI_AGENT_") && !CAM.test(k) && env[k] !== undefined) ra[k] = giaTriCoAnToan(k, String(env[k]));
  }
  return ra;
}
