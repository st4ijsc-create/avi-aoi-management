/**
 * V14 — CAU_HINH_DUYET là chỗ tiêm trần CHO CA KIỂM. Lưới này giữ hai điều bằng cách đọc mã nguồn: chỉ ba tệp sản xuất được nhắc tới nó (nơi khai báo, tool, phía tác nhân),
 * và KHÔNG tệp nào ngoài *.test.ts(x) ghi vào nó. Nhờ danh sách trắng, việc ghi qua một tên khác ở tệp lạ cũng bị thấy (tệp ấy phải nhắc tên gốc).
 * Giới hạn: ghi qua tên khác NGAY TRONG ba tệp cho phép thì mẫu ghi không thấy.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const GOC = path.resolve(process.cwd());
const THU_MUC = ["server", "shared", "client/src", "scripts"];
const MAU_GHI = /\bCAU_HINH_DUYET\s*(?:(?:\.\s*\w+|\[[^\]]*\])\s*)?(?:=(?!=)|\+=|-=|\*=|\+\+|--)|Object\.(?:assign|defineProperty)\(\s*CAU_HINH_DUYET\b|\bdelete\s+CAU_HINH_DUYET\b/;
/** Dòng KHAI BÁO hợp lệ ở nơi định nghĩa. */
const MAU_KHAI = /\b(?:export\s+)?const\s+CAU_HINH_DUYET\b/;

function lietKe(rel: string, ra: string[]): void {
  for (const e of readdirSync(path.join(GOC, rel), { withFileTypes: true })) {
    const con = `${rel}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name !== "node_modules" && e.name !== "dist") lietKe(con, ra);
    } else if (/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) ra.push(con);
  }
}

function tepSanXuatNhacToi(): Array<{ rel: string; noiDung: string }> {
  const ds: string[] = [];
  for (const t of THU_MUC) lietKe(t, ds);
  return ds.map((rel) => ({ rel, noiDung: readFileSync(path.join(GOC, rel), "utf8") })).filter((x) => x.noiDung.includes("CAU_HINH_DUYET"));
}

describe("V14 — chỉ ca kiểm được ghi vào CAU_HINH_DUYET", () => {
  it("V14-C1 đối chứng của mẫu: bắt được mọi dạng ghi, không bắt phép đọc và phép so", () => {
    for (const s of ["CAU_HINH_DUYET.mucMoiThuMuc = 5", "CAU_HINH_DUYET['latQuetMs']+=1", "CAU_HINH_DUYET = {}", "Object.assign(CAU_HINH_DUYET, x)", "delete CAU_HINH_DUYET.latQuetMs"]) {
      expect(MAU_GHI.test(s), s).toBe(true);
    }
    for (const s of ["const a = CAU_HINH_DUYET.mucMoiThuMuc;", "if (CAU_HINH_DUYET.latQuetMs === 0) x()", "f(CAU_HINH_DUYET.mucMoiThuMuc)", "tran = CAU_HINH_DUYET.mucMoiThuMuc,"]) {
      expect(MAU_GHI.test(s), s).toBe(false);
    }
  });

  it("V14-C2 đúng ba tệp sản xuất nhắc tới cấu hình", () => {
    expect(tepSanXuatNhacToi().map((x) => x.rel).sort()).toEqual([
      "server/services/ai/agent/boThucThiMayChu.ts",
      "server/services/aiLocalTools/repoReadTools.ts",
      "server/services/aiLocalTools/repoSandbox.ts",
    ]);
  }, 60_000);

  it("V14-C3 không tệp sản xuất nào ghi vào cấu hình", () => {
    const viPham = tepSanXuatNhacToi().flatMap((x) =>
      x.noiDung.split("\n").map((dong, i) => ({ dong, o: `${x.rel}:${i + 1}` })).filter((d) => MAU_GHI.test(d.dong) && !MAU_KHAI.test(d.dong)).map((d) => d.o),
    );
    expect(viPham).toEqual([]);
  }, 60_000);
});
