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

const TIEN_TO = ["AI_AGENT_", "LLAMA_SERVER_", "GGUF_", "AI_THINKING_", "LLM_PRIORITY_GATE_"];
const CHINH_XAC = new Set(["AI_SAMPLING_PROFILE", "AI_CODING_MODEL_TASK"]);
const CAM = /(API_KEY|SECRET|PASSWORD|TOKEN|CREDENTIAL)/i;
const CAM_TIEN_TO = ["DATABASE_", "REDIS_", "JWT_", "SESSION_", "AI_REPO_SANDBOX_ROOT", "AI_GHI_LUOT_DIR"];

export function khoaDuocNap(ten: string): boolean {
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
export function napEnvTuTep(duong: string, env: NodeJS.ProcessEnv = process.env): { daNap: string[]; daCo: string[] } {
  const { nap } = docEnvLoc(fs.readFileSync(duong, "utf8"));
  const daNap: string[] = [];
  const daCo: string[] = [];
  for (const [k, v] of Object.entries(nap)) {
    if (env[k] !== undefined && env[k] !== "") daCo.push(k);
    else {
      env[k] = v;
      daNap.push(k);
    }
  }
  return { daNap: daNap.sort(), daCo: daCo.sort() };
}
