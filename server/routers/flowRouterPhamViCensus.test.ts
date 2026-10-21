/**
 * ★★★ Đợt 9 (IDOR, duyệt (d)) — CENSUS "mọi thủ tục `flow.*` đi qua bộ kiểm PHẠM VI NHÀ MÁY của luồng". Lượng từ ∀ suy từ MÃ (AST), không
 * danh sách tay: mọi thuộc tính của `router({...})` trong `flowRouter.ts` phải gọi MỘT trong các hàm kiểm phạm vi
 * (`chanLuong · chanLuot · chanBiMat · luongTrongPhamVi · luotTrongPhamVi · biMatTrongPhamVi · nhaMayChoPhep · nhaMayChoLuongMoi`), trừ
 * danh sách khai tường minh kèm LÝ DO. Thủ tục nhận `flowId` / `runId` phải gọi hàm theo-id (không chỉ hàm danh sách). `meta.chanTruocStepUp`
 * được tính khi hàm chặn-trước có gọi hàm kiểm. Bộ quét tự kiểm bằng đột biến trên mã tổng hợp.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const TEP = resolve(dirname(fileURLToPath(import.meta.url)), "flowRouter.ts");
const HAM_THEO_ID = ["chanLuong", "chanLuot", "chanBiMat", "luongTrongPhamVi", "luotTrongPhamVi", "biMatTrongPhamVi"];
const HAM_DANH_SACH = ["nhaMayChoPhep", "nhaMayChoLuongMoi", "boKiemPhamVi"]; // boKiemPhamVi: chayThuNut — không có flowId, kiểm máy theo phạm vi ctx
const TAT_CA = [...HAM_THEO_ID, ...HAM_DANH_SACH];

/** Thủ tục KHÔNG đụng dữ liệu của luồng nào — khai tường minh, kèm lý do. */
const MIEN_TRU: Record<string, string> = {
  mauLuong: "đọc mẫu luồng TĨNH trong repo (không CSDL, không dữ liệu tenant)",
  danhMucNode: "danh mục loại node (sổ đăng ký trong bộ nhớ) — không dữ liệu của luồng nào",
};

const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const goi = (khoi: string, ds: string[]) => ds.some((h) => new RegExp(`\\b${h}\\s*\\(`).test(khoi));

function thuTuc(nguon: string): { ten: string; khoi: string }[] {
  const sf = ts.createSourceFile("r.ts", nguon, ts.ScriptTarget.Latest, true);
  const ra: { ten: string; khoi: string }[] = [];
  const di = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === "flowRouter" && n.initializer && ts.isCallExpression(n.initializer)) {
      const arg = n.initializer.arguments[0];
      if (arg && ts.isObjectLiteralExpression(arg)) {
        for (const p of arg.properties) if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) ra.push({ ten: p.name.text, khoi: p.initializer.getText(sf) });
      }
    }
    ts.forEachChild(n, di);
  };
  di(sf);
  return ra;
}

/** Thân hàm khai báo cấp tệp theo tên (cho `chanTruocStepUp`). */
function ham(nguon: string, ten: string): string {
  const sf = ts.createSourceFile("r.ts", nguon, ts.ScriptTarget.Latest, true);
  let kq = "";
  sf.forEachChild((n) => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === ten) kq = n.getText(sf);
  });
  return kq;
}

export function viPham(nguonTho: string): string[] {
  const nguon = boChuThich(nguonTho);
  const ra: string[] = [];
  for (const { ten, khoi } of thuTuc(nguon)) {
    if (ten in MIEN_TRU) continue;
    let k = khoi;
    // hàm chặn-trước step-up tính như một phần của thủ tục
    const m = /chanTruocStepUp\s*:\s*(\w+)/.exec(khoi);
    if (m) k += `\n${ham(nguon, m[1])}`;
    if (!goi(k, TAT_CA)) ra.push(`${ten}: không gọi bộ kiểm phạm vi nào`);
    else if (/z\.object\(\{[^}]*\b(flowId|runId)\s*:/.test(khoi) && !goi(k, HAM_THEO_ID)) ra.push(`${ten}: nhận flowId/runId nhưng chỉ có hàm danh sách, thiếu kiểm theo id`);
  }
  return ra;
}

describe("census — flow.* đi qua bộ kiểm phạm vi nhà máy của luồng", () => {
  const nguon = readFileSync(TEP, "utf8");

  it("∀ thủ tục của flowRouter: có kiểm phạm vi (trừ miễn trừ khai tường minh); cầu chì: thấy ≥ 15 thủ tục", () => {
    const ds = thuTuc(boChuThich(nguon));
    expect(ds.length, "bộ quét không thấy đủ thủ tục").toBeGreaterThanOrEqual(15);
    expect(viPham(nguon)).toEqual([]);
  });

  it("miễn trừ KHÔNG phình: mỗi mục miễn trừ phải là thủ tục có thật, và không có chạm CSDL / flowId / runId", () => {
    const theoTen = new Map(thuTuc(boChuThich(nguon)).map((t) => [t.ten, t.khoi]));
    for (const ten of Object.keys(MIEN_TRU)) {
      const k = theoTen.get(ten);
      expect(k, `miễn trừ '${ten}' không còn trong router`).toBeTruthy();
      expect(/\b(flowId|runId|getDb|layDb|aiFlow)/.test(k!), `${ten} có vẻ đụng dữ liệu luồng — bỏ miễn trừ`).toBe(false);
    }
  });

  it("tự kiểm (đột biến): thủ tục không kiểm ⇒ bị bắt; chỉ kiểm danh sách mà nhận flowId ⇒ bị bắt; hàm chặn-trước có kiểm ⇒ qua; miễn trừ ⇒ qua", () => {
    const mau = (than: string, them = "") => `${them}\nexport const flowRouter = router({\n  x: ghi.input(z.object({ flowId: s })).query(async ({ input, ctx }) => {\n${than}\n  }),\n});`;
    expect(viPham(mau("return 1;"))).toEqual(["x: không gọi bộ kiểm phạm vi nào"]);
    expect(viPham(mau("await nhaMayChoPhep(pv); return 1;"))).toEqual(["x: nhận flowId/runId nhưng chỉ có hàm danh sách, thiếu kiểm theo id"]);
    expect(viPham(mau("await chanLuong(ctx, input.flowId, 'a'); return 1;"))).toEqual([]);
    expect(viPham(mau("// chanLuong(ctx) chỉ là chú thích\nreturn 1;"))).toEqual(["x: không gọi bộ kiểm phạm vi nào"]);
    const voiMeta = `async function chan() { await luongTrongPhamVi(pv, id); }\nexport const flowRouter = router({\n  y: ot.meta({ chanTruocStepUp: chan }).input(z.object({ flowId: s })).mutation(async () => 1),\n});`;
    expect(viPham(voiMeta)).toEqual([]);
    const voiMetaRong = `async function chan() { return 1; }\nexport const flowRouter = router({\n  y: ot.meta({ chanTruocStepUp: chan }).input(z.object({ flowId: s })).mutation(async () => 1),\n});`;
    expect(viPham(voiMetaRong)).toEqual(["y: không gọi bộ kiểm phạm vi nào"]);
    expect(viPham(`export const flowRouter = router({\n  mauLuong: xem.query(() => 1),\n});`)).toEqual([]);
  });
});
