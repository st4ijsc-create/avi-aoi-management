/**
 * Điểm vào chung của check.mjs: chọn bộ chấm theo `bai.kieu`.
 *   ma-don     — một câu trả lời có khối mã (bộ khó `tasks-hard.json`), chấm bằng `codegen-chay-duoc/cham.mjs`
 *   agent-f    — dự án nhiều tệp trong `sandbox-projects/agent-f/<id>`, chấm bằng `agent-f/cham.mjs` (test ẩn + băm tệp test)
 *   pilot-repo — việc thật trong repo (thẻ TC-xx của pilot Thợ Cả): lệnh kiểm vitest + đột biến khai trong check.mjs
 */
import { docBai, ketThuc, LoiThuoc, THUOC_HONG } from "./chung.mjs";

export async function chayCheck(urlCheck, tuyChon = {}) {
  let id = "?";
  // Chạy dưới `node --test` biến này được kế thừa, và `node --test` lồng bên trong (bộ chấm) thoát 0 dù test đỏ: lời giải sai thành ĐẠT.
  delete process.env.NODE_TEST_CONTEXT;
  try {
    const b = docBai(urlCheck);
    id = b.bai.id;
    const bo =
      b.bai.kieu === "ma-don" ? await import("./maDon.mjs")
        : b.bai.kieu === "agent-f" ? await import("./agentF.mjs")
          : b.bai.kieu === "pilot-repo" ? await import("./pilotRepo.mjs")
            : null;
    if (!bo) throw new LoiThuoc(`kiểu bài lạ: ${b.bai.kieu}`);
    return await bo.cham(b, tuyChon);
  } catch (e) {
    const thuoc = e instanceof LoiThuoc;
    return ketThuc({ id, dat: false, lyDo: [thuoc ? "THUOC_HONG" : "LOI_CHECK"], loi: String(e?.message ?? e).slice(0, 800) }, THUOC_HONG);
  }
}
