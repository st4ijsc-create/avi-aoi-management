/**
 * ★★★ Audit orphanHolders 2026-10-22 — CỔNG CỦA CÁC llama-server ĐANG PHỤC VỤ AI, và so khớp cổng THEO RANH GIỚI TOKEN.
 *
 * VÌ SAO MODULE NÀY TỒN TẠI. `LLAMA_SERVER_BIN` là MỘT ảnh thực thi dùng chung cho ba loại tiến trình: sidecar thị giác (cổng
 * `LLAMA_VISION_PORT`, mặc định 8081), server AI chính (`LLAMA_SERVER_URL`, mặc định :8091), server FIM / coder
 * (`LLAMA_FIM_SERVER_URL`, `LLAMA_CODER_PORT`). Bộ phân loại hộ GPU chỉ nhìn ảnh thực thi nên xếp CẢ BA vào "tàn dư tắt được" khi cha đã
 * chết (đo trên dev: 920/958 sự kiện `baseline_foreign_pid` có llama-server trong `orphanHolders`, 30 pid khác nhau). Chỉ còn MỘT so khớp
 * chuỗi `--port 8081` (chuỗi CON, không ranh giới) đứng giữa server AI :8091 và `process.kill(SIGTERM)` của đường thu hồi nhận nuôi.
 * Module này cho ba nơi (phân loại · lập kế hoạch nhận nuôi · đường giết) CÙNG MỘT câu trả lời về "cổng nào là cổng AI" và "dòng lệnh này
 * mang cổng nào".
 *
 * ⚠ MODULE LÁ, THUẦN: không import gì, không I/O; `env` được đưa vào (mặc định `process.env`) để ca test dựng đúng thế giới nó cần.
 * ⚠ RANH GIỚI TOKEN: `--port 8091` khớp cổng 8091, KHÔNG khớp cổng 809 (chuỗi con của "8091") hay 80910. Dạng `--port=8091` cũng được hiểu.
 */

/** Cổng mặc định của server AI chính — luôn nằm trong tập cổng AI, kể cả khi `LLAMA_SERVER_URL` chưa đặt (.env.example). */
export const CONG_AI_MAC_DINH = 8091;

type Env = Readonly<Record<string, string | undefined>>;

function congTuUrl(raw: string | undefined): number | null {
  const s = (raw ?? "").trim();
  if (s.length === 0) return null;
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^/@]*@)?(?:\[[^\]]*\]|[^/:?#]*):(\d{1,5})(?=[/?#]|$)/i.exec(s);
  return m ? hopLe(Number(m[1])) : null;
}

function hopLe(n: number): number | null {
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : null;
}

/**
 * Mọi cổng mà một llama-server ĐANG PHỤC VỤ AI có thể nghe: `LLAMA_SERVER_URL` · `LLAMA_FIM_SERVER_URL` · `LLAMA_SERVER_PORT` ·
 * `LLAMA_CODER_PORT` · và 8091 mặc định. Đọc ở MỖI lần gọi (cấu hình đổi lúc chạy), không nhớ đệm.
 */
export function cacCongAI(env: Env = process.env): readonly number[] {
  const ra = new Set<number>([CONG_AI_MAC_DINH]);
  for (const c of [
    congTuUrl(env.LLAMA_SERVER_URL),
    congTuUrl(env.LLAMA_FIM_SERVER_URL),
    hopLe(Number.parseInt(env.LLAMA_SERVER_PORT ?? "", 10)),
    hopLe(Number.parseInt(env.LLAMA_CODER_PORT ?? "", 10)),
  ]) {
    if (c !== null) ra.add(c);
  }
  return [...ra].sort((a, b) => a - b);
}

/** Mọi giá trị `--port N` / `--port=N` trong dòng lệnh (theo token). Dòng lệnh rỗng ⇒ []. */
export function congTrongDongLenh(cmd: string): readonly number[] {
  const ra: number[] = [];
  for (const m of cmd.matchAll(/(?:^|[\s"'])--port(?:=|\s+)["']?(\d{1,5})(?=$|[\s"'])/g)) {
    const c = hopLe(Number(m[1]));
    if (c !== null) ra.push(c);
  }
  return ra;
}

/** Dòng lệnh mang ĐÚNG cổng `cong` (ranh giới token). */
export function dongLenhMangCong(cmd: string, cong: number): boolean {
  return congTrongDongLenh(cmd).includes(cong);
}

/** Dòng lệnh mang BẤT KỲ cổng AI nào. */
export function dongLenhMangCongAI(cmd: string, congAI: readonly number[] = cacCongAI()): boolean {
  return congTrongDongLenh(cmd).some((c) => congAI.includes(c));
}
