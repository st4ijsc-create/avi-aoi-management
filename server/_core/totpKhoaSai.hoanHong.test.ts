/**
 * SCADA R1b-2a Task 10 fix round 1 (M1 + M2 + I1) — ĐƯỜNG HỎNG của lượt HOÀN (không cần DB: kết nối giả).
 *
 *   · M2: câu HOÀN hỏng ⇒ lượt GIỮ được tính; nếu chính lượt ấy đặt khoá ⇒ đúng một audit "bắt đầu khoá" (phat_lai) + NÉM TẠM KHOÁ;
 *         không đặt khoá ⇒ `false`, không audit.
 *   · M1: câu hoàn đã commit, chỉ câu DỌN hàng 0 lượt hỏng ⇒ KHÔNG coi là hoàn hỏng (không audit một khoá đã gỡ, không ném).
 *   · I1: hoàn xong mà khoá CỦA TA còn (đếm vẫn ≥ N) ⇒ audit + TẠM KHOÁ.
 * Kết nối giả: mỗi lời gọi builder drizzle (`insert/update/delete`) trả một chuỗi gọi được, kết thúc bằng hàng do ca test đặt.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const F = vi.hoisted(() => ({
  napRow: { soLan: 10, conLaiMs: 3_600_000, vuaKhoa: true, cuaSo: "1" } as Record<string, unknown>,
  updateLoi: null as Error | null,
  updateRows: [] as Record<string, unknown>[],
  deleteLoi: null as Error | null,
  deleteGoi: 0,
  audit: [] as { action: string; after?: Record<string, unknown> }[],
}));

function chuoi(ketThuc: () => Promise<unknown>) {
  const p: Record<string, unknown> = {};
  for (const m of ["values", "onConflictDoUpdate", "set", "where", "from"]) p[m] = () => p;
  p.returning = () => ketThuc();
  p.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => ketThuc().then(res, rej);
  return p;
}
const dbGia = {
  insert: () => chuoi(async () => [F.napRow]),
  update: () =>
    chuoi(async () => {
      if (F.updateLoi) throw F.updateLoi;
      return F.updateRows;
    }),
  delete: () =>
    chuoi(async () => {
      F.deleteGoi += 1;
      if (F.deleteLoi) throw F.deleteLoi;
      return [];
    }),
};

vi.mock("../db/connection", async (importOriginal) => {
  const real = await importOriginal<typeof import("../db/connection")>();
  return { ...real, getDb: async () => dbGia };
});
vi.mock("../services/audit/controlAuditService", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/audit/controlAuditService")>();
  return {
    ...real,
    recordAuditEvent: async (_db: unknown, e: { action: string; after?: Record<string, unknown> }) => {
      F.audit.push({ action: e.action, after: e.after });
      return undefined as never;
    },
  };
});

import { kiemMaDuPhongCoBoDem, hoanLuotThu } from "./totpKhoaSai";

const appCodeCua = async (p: Promise<unknown>) => {
  try {
    return { ok: await p, appCode: undefined as string | undefined };
  } catch (e) {
    return { ok: undefined, appCode: (e as { cause?: { appCode?: string } })?.cause?.appCode ?? String((e as Error)?.message) };
  }
};

beforeEach(() => {
  F.napRow = { soLan: 10, conLaiMs: 3_600_000, vuaKhoa: true, cuaSo: "1" };
  F.updateLoi = null;
  F.updateRows = [];
  F.deleteLoi = null;
  F.deleteGoi = 0;
  F.audit = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("R1b-2a T10 fix round 1 — đường hỏng của lượt hoàn", () => {
  it("M2: câu HOÀN hỏng + chính lượt này đặt khoá ⇒ NÉM MA_DU_PHONG_TAM_KHOA, đúng 1 audit 'tam_khoa' (phat_lai)", async () => {
    F.updateLoi = new Error("probe: connection terminated");
    expect(await appCodeCua(kiemMaDuPhongCoBoDem(7, async () => "thua_dua"))).toMatchObject({ appCode: "MA_DU_PHONG_TAM_KHOA" });
    expect(F.audit).toHaveLength(1);
    expect(F.audit[0]).toMatchObject({ action: "ma_du_phong.tam_khoa", after: { nguyenNhan: "phat_lai" } });
    expect(F.deleteGoi, "hoàn hỏng ⇒ không dọn gì").toBe(0);
  });

  it("M2: câu HOÀN hỏng + lượt này KHÔNG đặt khoá ⇒ false, không audit (lượt giữ được tính)", async () => {
    F.napRow = { soLan: 3, conLaiMs: 0, vuaKhoa: false, cuaSo: "1" };
    F.updateLoi = new Error("probe: connection terminated");
    expect(await kiemMaDuPhongCoBoDem(7, async () => "thua_dua")).toBe(false);
    expect(F.audit).toHaveLength(0);
  });

  it("M1: hoàn ĐÃ commit (về 0, khoá của ta đã gỡ), chỉ câu DỌN hỏng ⇒ không ném, false, KHÔNG audit khoá", async () => {
    F.updateRows = [{ soLan: 0, khongKhoa: true, khoaCuaLuotNayConLai: false }];
    F.deleteLoi = new Error("probe: delete failed");
    expect(await hoanLuotThu(7, "backup", "luot-x", "1")).toEqual({ khoaCuaLuotNayConLai: false });
    expect(F.deleteGoi).toBe(1);
    F.deleteGoi = 0;
    expect(await kiemMaDuPhongCoBoDem(7, async () => "thua_dua")).toBe(false);
    expect(F.deleteGoi).toBe(1);
    expect(F.audit, "không audit một khoá đã gỡ").toHaveLength(0);
  });

  it("I1: hoàn xong nhưng khoá CỦA TA còn (đếm vẫn ≥ N) ⇒ NÉM TAM_KHOA + đúng 1 audit (phat_lai)", async () => {
    F.updateRows = [{ soLan: 10, khongKhoa: false, khoaCuaLuotNayConLai: true }];
    expect(await appCodeCua(kiemMaDuPhongCoBoDem(7, async () => "thua_dua"))).toMatchObject({ appCode: "MA_DU_PHONG_TAM_KHOA" });
    expect(F.audit).toHaveLength(1);
    expect(F.audit[0]).toMatchObject({ action: "ma_du_phong.tam_khoa", after: { nguyenNhan: "phat_lai" } });
  });

  it("hoàn xong, khoá của ta đã gỡ (đếm < N) ⇒ false, không audit", async () => {
    F.updateRows = [{ soLan: 9, khongKhoa: true, khoaCuaLuotNayConLai: false }];
    expect(await kiemMaDuPhongCoBoDem(7, async () => "thua_dua")).toBe(false);
    expect(F.audit).toHaveLength(0);
    expect(F.deleteGoi, "đếm 9 ⇒ không dọn").toBe(0);
  });
});
