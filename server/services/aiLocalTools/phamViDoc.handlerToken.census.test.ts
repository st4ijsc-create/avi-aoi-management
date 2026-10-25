/**
 * ★★★ W20 — CENSUS bổ sung cho `phamViDoc.census.test.ts` (L8): kiểm CHÍNH THÂN handler, không chỉ bảng khai.
 *   §1 mọi tool ĐỌC khai `loc` / `da-co` / `chi-toan-quyen` phải có TOKEN PHẠM VI trong thân handler (giaiPhamVi* · cong*Tool · statsScopeArgs · mayThay · dongThay · donViTool …) —
 *      khai "lọc" mà thân handler không hề nhắc tới bộ phân giải phạm vi là một lời khai trống;
 *   §2 mọi tool ĐỌC khai `mien` KHÔNG chạm CSDL ở thân handler (getDb / db. / .select( / .execute();
 *   §3 mọi tool KHÔNG miễn trừ được GỌI TÊN trong ít nhất một test CSDL (`*.db.test.ts` / `*scopeDb*.test.ts` trong thư mục này) — lọc chưa được đo trên hàng thật thì chưa có bằng chứng.
 * GIỚI HẠN: §1 là kiểm văn bản thân handler (đã biên dịch); hàm phụ do handler gọi mà chứa phạm vi (không nhắc token) sẽ bị báo — khi đó thêm token vào danh sách `TOKEN_PHAM_VI` kèm lý do.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isWriteTool, listTools } from "./toolRegistry";
import { KHOA_PHAM_VI_DOC_TOOL } from "./phamViDoc";

const TOKEN_PHAM_VI =
  /giaiPhamVi|ctxCuaTool|cong[A-Z]\w*Tool|statsScopeArgs|idsNhaMayCuaTool|donViTool|nguoiTrongPhamViTool|mayThay|dongThay|mayCot|machineIdsParam|resolveFactoryScope|giaiPhamViNhaMay|applyReportScope|applyGlobalReportScope|ketQuaChiToanQuyen|TrongPhamVi|scope/i;
const TOKEN_DB = /\bgetDb\b|\bdb\./;
const TOKEN_DB_TRUY_VAN = /\.select\(|\.execute\(/;

async function toolDoc() {
  await import("./index");
  await import("../visionDefectProposal");
  return listTools().filter((t) => !isWriteTool(t));
}

describe("§1 thân handler của tool lọc có token phạm vi", () => {
  it("loc / da-co / chi-toan-quyen ⇒ thân handler nhắc bộ phân giải phạm vi", async () => {
    const thieu: string[] = [];
    let dem = 0;
    for (const t of await toolDoc()) {
      const luat = KHOA_PHAM_VI_DOC_TOOL[t.name];
      if (!luat || luat.kieu === "mien") continue;
      dem++;
      if (!t.handler || !TOKEN_PHAM_VI.test(t.handler.toString())) thieu.push(t.name);
    }
    expect(dem, "cầu chì: có tool lọc để kiểm").toBeGreaterThanOrEqual(30);
    expect(thieu).toEqual([]);
  });
  it("vị từ không mù: một thân handler giả KHÔNG nhắc phạm vi ⇒ bị báo; có `giaiPhamViMay` ⇒ qua", () => {
    expect(TOKEN_PHAM_VI.test("async () => { const rows = await db.select().from(machines); return rows; }")).toBe(false);
    expect(TOKEN_PHAM_VI.test("async ({ __authCtx }) => { const pv = await giaiPhamViMay(__authCtx); return pv; }")).toBe(true);
  });
});

describe("§2 tool miễn trừ không chạm CSDL ở thân handler", () => {
  it("mien ⇒ không getDb / db. / .select( / .execute(", async () => {
    const cham: string[] = [];
    let dem = 0;
    for (const t of await toolDoc()) {
      const luat = KHOA_PHAM_VI_DOC_TOOL[t.name];
      if (luat?.kieu !== "mien") continue;
      dem++;
      const h = t.handler ? t.handler.toString() : "";
      if (TOKEN_DB.test(h) || TOKEN_DB_TRUY_VAN.test(h)) cham.push(t.name);
    }
    expect(dem).toBeGreaterThanOrEqual(10);
    expect(cham).toEqual([]);
  });
});

/** Khe hở TẠM đã biết (gỡ khi lô sửa tương ứng lên main): tool CHƯA được gọi tên trong test CSDL ở main hiện tại. Dòng nào đã được gọi tên ⇒ ĐỎ "gỡ khỏi khe hở" (chống hoá thạch). */
// 2026-10-25 (dieu-phoi, gộp W20 với L8b): analytics_defect_heatmap_summary đã có ca DB "người nhiều nhà máy thấy HỢP" ⇒ khe hở tạm rỗng.
const KHE_HO_TAM: ReadonlySet<string> = new Set<string>([]);

describe("§3 mọi tool không miễn trừ được gọi tên trong test CSDL", () => {
  it("tên tool xuất hiện (dạng chuỗi) trong ít nhất một test CSDL của thư mục tool", async () => {
    const dir = __dirname;
    const noiDungTest = readdirSync(dir)
      .filter((f) => f.endsWith(".test.ts") && (f.includes(".db.") || /scopeDb/i.test(f)))
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .join("\n");
    const chuaDo: string[] = [];
    for (const t of await toolDoc()) {
      const luat = KHOA_PHAM_VI_DOC_TOOL[t.name];
      if (!luat || luat.kieu === "mien") continue;
      const duocGoi = noiDungTest.includes(`"${t.name}"`) || noiDungTest.includes(`'${t.name}'`);
      if (!duocGoi && !KHE_HO_TAM.has(t.name)) chuaDo.push(t.name);
      if (duocGoi && KHE_HO_TAM.has(t.name)) chuaDo.push(`${t.name} (đã được gọi tên — gỡ khỏi KHE_HO_TAM)`);
    }
    expect(noiDungTest.length, "cầu chì: đọc được test CSDL").toBeGreaterThan(1000);
    expect(chuaDo).toEqual([]);
  });
});
