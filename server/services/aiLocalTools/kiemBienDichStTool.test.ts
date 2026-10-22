/**
 * ★ Đợt 9 — tool `kiem_bien_dich_st`. Trình biên dịch GIẢ (mã có "AND ;" ⇒ lỗi dòng 4) để lưới chạy không cần docker;
 * phép biên dịch THẬT bằng RuSTy nằm ở `server/services/ai/st/kiemBienDichSt.test.ts`. Rò rỉ hộp cát của ô `path` do
 * `repoSandbox.census.test.ts` §B và `workspaceConfinement.canary.test.ts` phủ (tool có tên trong cả hai bản kiểm đếm).
 */
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ soLan: 0, nem: false, coQuyen: true }));
vi.mock("../../_core/accessControl", () => ({ checkPermission: vi.fn(async () => h.coQuyen) }));
vi.mock("../flow/lib/bienDichST", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../flow/lib/bienDichST")>();
  return {
    ...goc,
    bienDichST: vi.fn(async (ma: string) => {
      h.soLan++;
      if (h.nem) throw new goc.LoiBienDichST("ha-tang", "không thấy docker");
      return ma.includes("AND ;")
        ? { ok: false, chanDoan: [{ tep: "ma.st", dong: 4, cot: 13, mucDo: "error", ma: "E007", thongDiep: "Unexpected token ;" }], ms: 3 }
        : { ok: true, chanDoan: [], ms: 3 };
    }),
  };
});

import { kiemBienDichStTool } from "./kiemBienDichStTool";

const AUTH = { userId: 7, role: "engineer" };
const FB_SAI = "FUNCTION_BLOCK A\nVAR_INPUT x : BOOL; END_VAR\nVAR_OUTPUT y : BOOL; END_VAR\n  y := x AND ;\nEND_FUNCTION_BLOCK";
const goi = async (args: Record<string, unknown>) => {
  h.soLan = 0;
  return kiemBienDichStTool.handler!({ ...args, __authCtx: AUTH } as never, {} as never);
};

describe("kiem_bien_dich_st", () => {
  it("mã thô lỗi ⇒ ok:false, lỗi theo DÒNG trong textSummary", async () => {
    const r = await goi({ code: FB_SAI });
    expect(r.data).toMatchObject({ ok: false, phuongNgu: "st", soLoi: 1, nguon: "code" });
    expect(r.data.chanDoan[0]).toMatchObject({ dong: 4, ma: "E007" });
    expect(r.textSummary).toContain("THẤT BẠI");
    expect(r.note).toBeUndefined();
  });

  it("khối ```st đúng ⇒ ok:true", async () => {
    const r = await goi({ code: "Đây:\n```st\n" + FB_SAI.replace("AND ;", "AND x;") + "\n```" });
    expect(r.data.ok).toBe(true);
    expect(h.soLan).toBe(1);
  });

  it("khối nhãn python ⇒ NO_ST_CODE, KHÔNG gọi trình biên dịch", async () => {
    const r = await goi({ code: "```python\n" + FB_SAI + "\n```" });
    expect(r.note).toBe("NO_ST_CODE");
    expect(h.soLan).toBe(0);
  });

  it("thiếu cả code lẫn path ⇒ MISSING_REQUIRED_ARG", async () => {
    expect((await goi({})).note).toBe("MISSING_REQUIRED_ARG");
  });

  it("path tới tệp bí mật ⇒ mã từ chối CỦA HỘP CÁT (như read_file), không biên dịch", async () => {
    const r = await goi({ path: ".env" });
    expect(r.note).toBe("DENIED_SECRET");
    expect(h.soLan).toBe(0);
  });

  it("docker vắng ⇒ COMPILER_UNAVAILABLE, ok:null (chưa kiểm ≠ không lỗi)", async () => {
    h.nem = true;
    try {
      const r = await goi({ code: FB_SAI });
      expect(r.note).toBe("COMPILER_UNAVAILABLE");
      expect(r.data.ok).toBeNull();
    } finally {
      h.nem = false;
    }
  });

  it("thiếu quyền ⇒ bị chặn trước khi đọc/biên dịch", async () => {
    h.coQuyen = false;
    try {
      const r = await goi({ code: FB_SAI });
      expect(r.note).toBe("PERMISSION_DENIED");
      expect(h.soLan).toBe(0);
    } finally {
      h.coQuyen = true;
    }
  });
});
