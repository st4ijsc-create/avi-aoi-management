/**
 * R1a Task 7 · Fix round 1 — CENSUS NGƯỜI NHẬP CỬA GHI CACHE STEP-UP.
 *
 *   ***∀ file trong `server`/`client`/`shared`/`scripts` (sản xuất LẪN test) nhập `_core/trpc.ts` và
 *   nhắc một CỬA GHI cache step-up (`ghiStepUpPhien`): file ấy PHẢI nằm trong `NGUOI_NHAP_DUOC_PHEP`.***
 *
 * Vì sao: `ghiStepUpPhien` mở cache phiên 10 phút KHÔNG cần mã — nó dành cho `xacThucTheoMuc.ts` gọi
 * SAU KHI đã verify một TOTP. Một người nhập thứ hai là một đường mở bước 2FA mức 4 (và
 * `requireFreshTotp` của deploy) không qua mã.
 *
 * Khuôn: `totpReplayScan.test.ts` §2b(ii) — phép phân giải đường nhập `phanGiaiToi` (bắt cả `"./trpc"`
 * lẫn `"../_core/trpc"`), mọi dạng nhập `moiDuongNhap` (tĩnh · `export … from` · `import()` · `require`),
 * tên khớp theo ranh giới từ (bắt cả bí danh nhập vì tên gốc vẫn phải xuất hiện ở mệnh đề nhập).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { moiFileDuoi, phanGiaiToi } from "../routers/deployProcedureScan";
import { moiDuongNhap } from "./quetDiemXacThuc";

const GOC_REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CORE_TRPC = join(GOC_REPO, "server", "_core", "trpc.ts");

/** Cửa GHI cache step-up mà `trpc.ts` export. Thêm một cửa ghi mới ⇒ thêm vào đây (cầu chì dưới canh). */
const CUA_GHI = ["ghiStepUpPhien"] as const;

/**
 * GHIM. Chỉ được GIẢM, hoặc thêm kèm ghi chú ngày · task · lý do.
 *  - 2026-10-24 · R1a T7 — `xacThucTheoMuc.ts`: ghi SAU verifyFreshTotp hợp lệ; lưới của nó.
 */
const NGUOI_NHAP_DUOC_PHEP = ["server/_core/xacThucTheoMuc.test.ts", "server/_core/xacThucTheoMuc.ts"];

const CAY = ["server", "client", "shared", "scripts"];
const MOI_FILE = CAY.flatMap((c) => moiFileDuoi(GOC_REPO, c, [".ts", ".tsx", ".mts", ".cts"]));

/**
 * R1b-1 T10 — tái xuất TOÀN BỘ (`export *` / `export * as ns` từ trpc.ts): tái xuất TOÀN BỘ, KHÔNG nhắc tên `ghiStepUpPhien` trong
 * mã nên vị từ "nhắc tên" bên dưới mù; ai nhập barrel đó lấy được cửa ghi mà không qua `trpc.ts`. Phân tích bằng AST (không regex dòng),
 * cùng phép phân giải đường nhập `phanGiaiToi`.
 */
export function taiXuatToanBo(tuFile: string, ma: string, dich: string): boolean {
  const src = ts.createSourceFile(tuFile, ma, ts.ScriptTarget.Latest, true);
  let thay = false;
  const di = (n: ts.Node): void => {
    if (
      ts.isExportDeclaration(n) &&
      n.moduleSpecifier !== undefined &&
      ts.isStringLiteral(n.moduleSpecifier) &&
      (n.exportClause === undefined || ts.isNamespaceExport(n.exportClause)) &&
      phanGiaiToi(tuFile, n.moduleSpecifier.text, dich)
    ) {
      thay = true;
    }
    n.forEachChild(di);
  };
  di(src);
  return thay;
}

/** Một file (đường tương đối `duong`, đường thật `that`, mã `ma`) có phải người nhập cửa ghi không: nhắc tên + nhập từ trpc, HOẶC tái xuất toàn bộ trpc. */
export function laNguoiNhapCuaGhi(duong: string, that: string, ma: string, dich: string = CORE_TRPC): boolean {
  if (that === dich) return false;
  if (taiXuatToanBo(that, ma, dich)) return true;
  if (!CUA_GHI.some((ten) => new RegExp(`\\b${ten}\\b`).test(ma))) return false;
  return moiDuongNhap(duong, ma).some((sp) => phanGiaiToi(that, sp, dich));
}

function nguoiNhapCuaGhi(): string[] {
  const ra: string[] = [];
  for (const f of MOI_FILE) {
    if (f.that === CORE_TRPC) continue;
    if (laNguoiNhapCuaGhi(f.duong, f.that, readFileSync(f.that, "utf8"))) ra.push(f.duong);
  }
  return ra.sort();
}

describe("★★★ census — người nhập cửa GHI cache step-up (`ghiStepUpPhien`) bị GHIM", () => {
  it("cầu chì — phạm vi quét không mù (đủ nhiều file, và thấy `trpc.ts`)", () => {
    expect(MOI_FILE.length).toBeGreaterThan(1000);
    expect(MOI_FILE.some((f) => f.that === CORE_TRPC)).toBe(true);
  });

  it("cầu chì — `trpc.ts` export ĐÚNG các cửa ghi đã khai, và Map cache KHÔNG bị export", () => {
    const ma = readFileSync(CORE_TRPC, "utf8");
    for (const ten of CUA_GHI) expect(ma, ten).toMatch(new RegExp(`export function ${ten}\\(`));
    expect(ma).not.toMatch(/export\s+(const|let)\s+stepUpVerifiedUntil\b/);
    expect(ma).not.toMatch(/export\s*\{[^}]*\bstepUpVerifiedUntil\b/);
    // Ghi vào Map chỉ ở HAI chỗ: middleware cũ (sau verify) + `ghiStepUpPhien`. Chỗ thứ ba ⇒ một cửa
    // ghi mới chưa khai ở `CUA_GHI`.
    expect(ma.match(/stepUpVerifiedUntil\.set\(/g)?.length).toBe(2);
  });

  it("★ R1b-1 T10 — hiệu chuẩn: tái xuất `export *` trpc.ts bị BẮT (mã tổng hợp), nhập tên gốc vẫn bị bắt, file vô can KHÔNG bị bắt", () => {
    // KHÔNG viết nguyên văn dạng tái xuất toàn bộ trong mã nguồn này: các bộ quét regex khác (deployProcedureScan, congGiayPhepAi) đọc cả file test.
    const EXP = "export";
    const tu = join(GOC_REPO, "server", "routers", "zzBarrelTongHop.ts");
    // vi phạm tổng hợp: KHÔNG nhắc `ghiStepUpPhien` ở đâu cả — vị từ "nhắc tên" cũ mù
    expect(laNguoiNhapCuaGhi("server/routers/zzBarrelTongHop.ts", tu, `${EXP} * from "../_core/trpc";
`)).toBe(true);
    expect(laNguoiNhapCuaGhi("server/routers/zzBarrelTongHop.ts", tu, `${EXP} * as t from "../_core/trpc";
`)).toBe(true);
    expect(laNguoiNhapCuaGhi("server/routers/zzBarrelTongHop.ts", tu, `${EXP} * from "../_core/trpc.js";
`)).toBe(false); // đường .js không phân giải về .ts (đúng như phanGiaiToi hiện có)
    // đối chứng: đường cũ vẫn bắt
    expect(laNguoiNhapCuaGhi("server/routers/zzBarrelTongHop.ts", tu, `import { ghiStepUpPhien } from "../_core/trpc";
ghiStepUpPhien();
`)).toBe(true);
    // vô can: tái xuất có tên (không phải `*`) không nhắc cửa ghi; tái xuất toàn bộ module KHÁC
    expect(laNguoiNhapCuaGhi("server/routers/zzBarrelTongHop.ts", tu, `export { router } from "../_core/trpc";
`)).toBe(false);
    expect(laNguoiNhapCuaGhi("server/routers/zzBarrelTongHop.ts", tu, `${EXP} * from "./deployProcedureScan";
`)).toBe(false);
  });

  it("★★★ ∀ người nhập `trpc.ts` nhắc cửa ghi ⇒ nằm trong GHIM (không thừa, không thiếu)", () => {
    expect(
      nguoiNhapCuaGhi(),
      "một file MỚI nhập cửa ghi cache step-up ⇒ nó mở được bước 2FA mức 4 KHÔNG cần mã. Đi qua `kiemXacThucTheoMuc`, hoặc khai ở GHIM kèm lý do",
    ).toEqual([...NGUOI_NHAP_DUOC_PHEP].sort());
  });
});
