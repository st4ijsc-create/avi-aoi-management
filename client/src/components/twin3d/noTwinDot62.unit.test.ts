import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐỢT 62 mục B — LƯỚI GIỮ **SỔ NỢ**, KHÔNG PHẢI LƯỚI GIỮ MÃ ĐÃ XOÁ
 * ════════════════════════════════════════════════════════════════════════════
 * Đợt 62 xoá `DigitalTwinCenter.tsx` (938 dòng) + `ArticulatedRobot.tsx` (196) —
 * hai tệp 0 importer, route chỉ còn `<Redirect>`. Xoá UI thì dễ; cái dễ mất là
 * **lý do chúng từng tồn tại**. Ba thủ tục server mà trang ấy là consumer UI duy
 * nhất (`twin.status`, `twin.replay`) hoặc consumer đầu tiên (`twin.usdExport`)
 * NAY KHÔNG CÒN AI GỌI TỪ UI — và một thủ tục 0 consumer là thứ đợt sau rất dễ
 * "dọn rác" mất, cùng với cả tính năng chưa kịp di trú.
 *
 * ⇒ Lưới này ghim BA điều, mỗi điều bắt một cách hỏng khác nhau:
 *   1. Hai tệp UI ĐÃ ĐI, và không ai import lại (kể cả bằng đường vòng).
 *   2. Ba thủ tục server CÒN NGUYÊN — ai xoá chúng phải đọc sổ nợ trước, vì
 *      `twin.replay` là đường DUY NHẤT trong mã đọc lịch sử `packml_state` +
 *      khớp robot (`robot_telemetry.poseJson`), thứ mà `twinCanh.anhLichSu` KHAI
 *      là mình KHÔNG dựng được (`LICH_SU_LA_XAP_XI = true`).
 *   3. `usdExport` vẫn có consumer UI SỐNG — đây là món DUY NHẤT của trang cũ đã
 *      thật sự được di trú, và nếu nó rụng thì việc xoá trang mới là mất mát.
 *
 * ⚠ Vì sao không ghim "0 consumer" cho `replay`/`status`: số đó ĐÚNG hôm nay
 *   nhưng phải được phép TĂNG — ngày ai đó di trú replay vào `/twin`, lưới phải
 *   im lặng chứ không đỏ. Ghim thứ không được mất, không ghim thứ đang thiếu.
 */

const GOC = fileURLToPath(new URL("../../../..", import.meta.url)); // → gốc repo

const DA_XOA = [
  "client/src/pages/DigitalTwinCenter.tsx",
  "client/src/components/twin/ArticulatedRobot.tsx",
] as const;

/** Quét mọi tệp nguồn client (bỏ test, bỏ thư mục bằng chứng `.qa-*`). */
function moiTepNguon(thuMuc: string, ra: string[] = []): string[] {
  for (const ten of readdirSync(thuMuc)) {
    if (ten.startsWith(".")) continue;
    const duong = join(thuMuc, ten);
    if (statSync(duong).isDirectory()) moiTepNguon(duong, ra);
    else if (/\.(ts|tsx)$/.test(ten) && !/\.(test|spec)\.tsx?$/.test(ten)) ra.push(duong);
  }
  return ra;
}

describe("Đợt 62 B — hai tệp UI chết đã đi, KHÔNG ai import lại", () => {
  for (const tep of DA_XOA) {
    it(`\`${tep}\` không còn trên đĩa`, () => {
      expect(existsSync(join(GOC, tep))).toBe(false);
    });
  }

  it("★★★ không tệp nguồn client nào import `DigitalTwinCenter` / `ArticulatedRobot`", () => {
    const pham: string[] = [];
    for (const duong of moiTepNguon(join(GOC, "client/src"))) {
      const nguon = readFileSync(duong, "utf8");
      // Chỉ bắt lời gọi IMPORT thật, không bắt chú thích nhắc tên (lịch sử phải
      // được phép kể lại; thứ bị cấm là phụ thuộc mã).
      if (/import[^;]*["'][^"']*(DigitalTwinCenter|components\/twin\/ArticulatedRobot)["']/.test(nguon)) {
        pham.push(duong.replace(GOC, ""));
      }
    }
    expect(pham).toEqual([]);
  });
});

describe("Đợt 62 B — SỔ NỢ: ba thủ tục server KHÔNG được xoá theo UI", () => {
  const router = readFileSync(join(GOC, "server/routers/twinRouter.ts"), "utf8");

  it("★★★ `twin.status` · `twin.replay` · `twin.usdExport` còn nguyên trong `twinRouter`", () => {
    for (const thuTuc of ["status", "replay", "usdExport"]) {
      expect(router, `twinRouter mất thủ tục \`${thuTuc}\` — đọc sổ nợ Đợt 62 trước khi xoá`).
        toMatch(new RegExp(`^  ${thuTuc}: protectedProcedure`, "m"));
    }
  });

  it("★★★ `usdExport` vẫn có consumer UI SỐNG (món DUY NHẤT đã di trú thật)", () => {
    const goi: string[] = [];
    for (const duong of moiTepNguon(join(GOC, "client/src"))) {
      if (/twin\.usdExport\./.test(readFileSync(duong, "utf8"))) goi.push(duong.replace(GOC, ""));
    }
    // ≥1 là đủ để nói "không mồ côi"; ghim con số cứng sẽ đỏ oan khi ai đó thêm
    // một lối xuất thứ ba — thứ ta MUỐN xảy ra.
    expect(goi.length, `usdExport mất hết consumer UI — việc xoá DigitalTwinCenter thành mất mát`).
      toBeGreaterThanOrEqual(1);
  });
});
