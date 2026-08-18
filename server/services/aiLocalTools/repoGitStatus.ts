/**
 * ★★★ doc 78 · PHA C — **HÀNG RÀO "TỆP BẨN": trạng thái git của ĐÚNG MỘT tệp sắp ghi.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO FILE NÀY TỒN TẠI, VÀ VÌ SAO NÓ TÁCH KHỎI `writeHandlers/applyDiff.ts`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * doc 78 §3 mục 1 — sự cố ĐÃ XẢY RA THẬT ngày 2026-08-18: một tác nhân chạy `git checkout <file>`
 * để hoàn nguyên một sửa đổi 1 dòng và **xoá mất 123 dòng chưa commit**. Pha C tồn tại để chống
 * đúng lớp lỗi ấy: **không ghi đè một tệp có thay đổi chưa commit**. Hàng rào là điều kiện tiên
 * quyết, không thương lượng.
 *
 * Tách khỏi bề mặt tool (`applyDiff.ts`) vì cùng lý lẽ mà pha B tách `repoCommandSandbox` khỏi
 * `writeHandlers/repoCommand`: chính sách/bộ chạy ở một chỗ, bề mặt HITL ở chỗ khác. Và vì lý do
 * ĐO ĐƯỢC: `repoCommand.census.test.ts §J` đếm **mọi** điểm gọi `chayLenhTrongHopCat` trong mã sản
 * phẩm — đặt lời gọi git-status ở **một** hàm duy nhất (`trangThaiGitCuaTep`) làm §J chỉ mọc thêm
 * đúng MỘT dòng, và người viết phải nhìn thấy nó một lần.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ PHẢI HỎI **ĐÚNG TỆP**, KHÔNG PHẢI TOÀN REPO — VÀ ĐÂY LÀ MỘT PHÉP ĐO, KHÔNG PHẢI THẨM MỸ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Repo này thường xuyên có HÀNG TRĂM tệp chưa commit ở khắp nơi (git status lúc bắt đầu phiên có
 * ~300 mục). Kiểm "toàn repo sạch không" ⇒ **mọi** lượt ghi bị chặn vĩnh viễn. Vì thế lệnh là
 * `git status --porcelain -- <tệp>`: `-- <tệp>` bó phạm vi về đúng một đường dẫn. Tệp khác bẩn ở
 * chỗ khác KHÔNG liên quan.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ LỆNH NÀY **CỐ ĐỊNH**, KHÔNG PHẢI DANH SÁCH TRẮNG CỦA `run_command`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `run_command` (pha B) chỉ cho `git status` TRẦN (không đối số đường dẫn) vì lệnh ở đó do **model**
 * chọn. Ở đây `argv` là một hằng của mã nguồn — chỉ ô `<tệp>` biến thiên, và nó ĐÃ đi qua
 * `phanQuyetDuongDan()` + `confineTargetUnder()` của người gọi TRƯỚC khi tới đây (ta nhận `relPath`
 * đã chứng minh nằm trong hộp cát). Nên ta gọi thẳng bộ chạy `chayLenhTrongHopCat`, KHÔNG qua danh
 * sách trắng — cùng cách `writeHandlers/repoCommand.execute` gọi nó, chỉ khác argv là hằng.
 * ⚠ `git status` là lệnh CHỈ HỎI: nó không đổi một byte nào của cây làm việc. Chạy nó trong
 *   `preview()` (trước cổng HITL) vì thế AN TOÀN — khác hẳn việc chạy một lệnh model chọn ở đó.
 *
 * ⚠ `--no-pager`: phòng một `core.pager` cứng đầu treo tiến trình con đọc stdin đã đóng.
 * ⚠ FAIL-CLOSED: git không phân giải được / thoát khác 0 / hết giờ ⇒ `GIT_STATUS_FAILED`. Không
 *   chứng minh được tệp SẠCH thì phải coi như KHÔNG sạch — một hàng rào không chứng minh được thì
 *   không phải hàng rào.
 */
import { chayLenhTrongHopCat } from "./repoCommandSandbox";
import { gocHopCat } from "./repoSandbox";

/** Hạn giờ cho một lượt `git status` một tệp — rộng rãi, nhưng hữu hạn. */
export const HAN_GIO_GIT_MS = 20_000;

export type TrangThaiGit =
  | { ok: true; sach: boolean; trangThai: string }
  | { ok: false; ma: "GIT_STATUS_FAILED"; chiTiet: string };

/**
 * Trạng thái git-porcelain của **đúng một tệp** (đường dẫn TƯƠNG ĐỐI so với gốc hộp cát, đã được
 * người gọi chứng minh nằm trong hộp cát).
 *
 *   • `sach: true`  ⇔ đầu ra porcelain RỖNG ⇒ tệp KHÔNG có thay đổi chưa commit (đã track & sạch,
 *                     hoặc chưa tồn tại). ĐÂY là điều kiện cho phép ghi/tạo.
 *   • `sach: false` ⇔ có bất kỳ dòng porcelain nào: ` M` (sửa chưa staged) · `M ` (đã staged) ·
 *                     `??` (chưa track — tức toàn bộ tệp là công việc CHƯA commit) · `A ` · `MM` …
 *                     Mọi trạng thái ấy đều là "chưa commit" ⇒ TỪ CHỐI ghi đè.
 *
 * ⚠ Phân biệt "tệp MỚI hợp lệ" với "tệp đã track & bẩn" nằm ở NGƯỜI GỌI, không ở đây: một tệp sắp
 * TẠO còn chưa tồn tại lúc gọi hàm này ⇒ porcelain RỖNG ⇒ `sach: true`. `??` chỉ xuất hiện cho một
 * tệp **đã tồn tại nhưng chưa track**, và đó ĐÚNG là "chưa commit" nên bị coi là bẩn.
 */
export async function trangThaiGitCuaTep(relPath: string): Promise<TrangThaiGit> {
  const p = String(relPath).replace(/\\/g, "/");
  const kq = await chayLenhTrongHopCat(
    { file: "git", args: ["--no-pager", "status", "--porcelain", "--", p] },
    { hanGioMs: HAN_GIO_GIT_MS, goc: gocHopCat() },
  );
  // Fail-closed: bất kỳ thứ gì khác "đã sinh tiến trình, thoát 0" đều là KHÔNG chứng minh được.
  if (kq.ma !== null || kq.maThoat !== 0) {
    return {
      ok: false,
      ma: "GIT_STATUS_FAILED",
      chiTiet: `git status thoát ${kq.maThoat ?? "—"}${kq.ma ? ` (${kq.ma})` : ""}${kq.hetGio ? " · hết giờ" : ""}`,
    };
  }
  const out = kq.dauRa.replace(/\r/g, "").trim();
  return { ok: true, sach: out === "", trangThai: out };
}
