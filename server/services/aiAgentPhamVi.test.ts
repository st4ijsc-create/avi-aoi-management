/**
 * Phạm vi NHÀ MÁY của phiên/hàng agent (aiAgentPhamVi.ts) — hai nhà máy, nhiều người xem, không DB (phụ thuộc tiêm).
 * Lỗi gốc: engineer nhà máy B đọc mục tiêu agent của người nhà máy A. Mỗi dòng dưới đây là MỘT cách để lỗi đó quay lại.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { chuThayDuoc, locTheoChu, nguoiNhanThayChu, phamViCacChu, xoaCachePhamViChu, TTL_PHAM_VI_CHU_MS, type PhuThuocPhamVi, type PhamViNhaMay } from "./aiAgentPhamVi";

// id người → { vai, nhà máy }. 10/11 = engineer nhà máy 1/2; 12 = engineer cấp tập đoàn (1 và 2); 13 = engineer chưa gán; 1 = admin.
const NGUOI: Record<number, { role: string; pv: PhamViNhaMay }> = {
  1: { role: "admin", pv: null },
  10: { role: "engineer", pv: [1] },
  11: { role: "engineer", pv: [2] },
  12: { role: "engineer", pv: [1, 2] },
  13: { role: "engineer", pv: [] },
  14: { role: "operator", pv: [1] },
};

function taoDep(over: Partial<PhuThuocPhamVi> = {}, nguoi = NGUOI) {
  const goi = { phanGiai: 0, layVaiTro: 0 };
  let t = 1_000_000;
  const dep: PhuThuocPhamVi & { goi: typeof goi; datGio(ms: number): void; nguoi: typeof nguoi } = {
    goi,
    nguoi,
    datGio: (ms) => {
      t = ms;
    },
    bay: () => t,
    async phanGiai(u) {
      goi.phanGiai++;
      const n = nguoi[u.userId];
      if (!n) throw new Error("không phân giải được");
      return n.pv;
    },
    async layVaiTro(ids) {
      goi.layVaiTro++;
      return new Map(ids.filter((i) => nguoi[i]).map((i) => [i, nguoi[i].role] as [number, string]));
    },
    ...over,
  };
  return dep;
}

const hang = (...chu: number[]) => chu.map((userId, i) => ({ id: `h${i}`, userId }));
const ids = (r: Array<{ userId: number }>) => r.map((x) => x.userId);

beforeEach(() => xoaCachePhamViChu());

describe("chuThayDuoc — phép quyết định duy nhất", () => {
  const xem = (id: number, pv: PhamViNhaMay) => ({ id, pv });
  it("★ nhà máy 2 KHÔNG thấy hàng của chủ ở nhà máy 1", () => {
    expect(chuThayDuoc(xem(11, [2]), { id: 10, pv: [1] })).toBe(false);
  });
  it("cùng nhà máy ⇒ thấy; giao một phần (tập đoàn) ⇒ thấy", () => {
    expect(chuThayDuoc(xem(10, [1]), { id: 99, pv: [1] })).toBe(true);
    expect(chuThayDuoc(xem(12, [1, 2]), { id: 10, pv: [1] })).toBe(true);
    expect(chuThayDuoc(xem(12, [1, 2]), { id: 11, pv: [2] })).toBe(true);
  });
  it("admin thấy hết; chính chủ luôn thấy hàng của mình kể cả chưa gán nhà máy", () => {
    expect(chuThayDuoc(xem(1, null), { id: 10, pv: [1] })).toBe(true);
    expect(chuThayDuoc(xem(13, []), { id: 13, pv: [] })).toBe(true);
  });
  it("★ phiên của ADMIN không lộ cho engineer; chủ chưa gán / chưa phân giải ⇒ chặn; người xem chưa gán ⇒ chặn", () => {
    expect(chuThayDuoc(xem(10, [1]), { id: 1, pv: null })).toBe(false);
    expect(chuThayDuoc(xem(10, [1]), { id: 13, pv: [] })).toBe(false);
    expect(chuThayDuoc(xem(10, [1]), { id: 99, pv: undefined })).toBe(false);
    expect(chuThayDuoc(xem(13, []), { id: 10, pv: [1] })).toBe(false);
  });
});

describe("locTheoChu — hai nhà máy, hai người dùng", () => {
  const tat = hang(10, 11, 12, 13, 1, 14);
  it("★ engineer nhà máy 1 chỉ thấy hàng nhà máy 1 (+ tập đoàn chủ giao), KHÔNG thấy nhà máy 2 / chưa gán / admin", async () => {
    const dep = taoDep();
    expect(ids(await locTheoChu(tat, { id: 10, role: "engineer" }, (h) => h.userId, dep))).toEqual([10, 12, 14]);
  });
  it("★ engineer nhà máy 2 chỉ thấy nhà máy 2", async () => {
    expect(ids(await locTheoChu(tat, { id: 11, role: "engineer" }, (h) => h.userId, taoDep()))).toEqual([11, 12]);
  });
  it("engineer cấp tập đoàn thấy cả hai nhà máy nhưng không thấy admin / chưa gán", async () => {
    expect(ids(await locTheoChu(tat, { id: 12, role: "engineer" }, (h) => h.userId, taoDep()))).toEqual([10, 11, 12, 14]);
  });
  it("★ engineer CHƯA gán nhà máy chỉ thấy hàng của chính mình", async () => {
    expect(ids(await locTheoChu(tat, { id: 13, role: "engineer" }, (h) => h.userId, taoDep()))).toEqual([13]);
  });
  it("admin thấy hết và KHÔNG gọi DB", async () => {
    const dep = taoDep();
    expect(ids(await locTheoChu(tat, { id: 1, role: "admin" }, (h) => h.userId, dep))).toEqual(ids(tat));
    expect(dep.goi).toEqual({ phanGiai: 0, layVaiTro: 0 });
  });
  it("giữ thứ tự gốc", async () => {
    expect(ids(await locTheoChu(hang(12, 10, 12), { id: 10, role: "engineer" }, (h) => h.userId, taoDep()))).toEqual([12, 10, 12]);
  });
});

describe("fail-closed", () => {
  it("★ không phân giải được phạm vi NGƯỜI XEM ⇒ chỉ thấy hàng của chính mình (không mở cửa)", async () => {
    const dep = taoDep({
      async phanGiai(u) {
        if (u.userId === 10) throw new Error("db chính vắng");
        return NGUOI[u.userId].pv;
      },
    });
    expect(ids(await locTheoChu(hang(10, 12, 14), { id: 10, role: "engineer" }, (h) => h.userId, dep))).toEqual([10]);
  });
  it("★ không phân giải được phạm vi một CHỦ ⇒ hàng của chủ đó bị LOẠI, các chủ khác không ảnh hưởng", async () => {
    const dep = taoDep({
      async phanGiai(u) {
        if (u.userId === 12) throw new Error("hỏng");
        return NGUOI[u.userId].pv;
      },
    });
    expect(ids(await locTheoChu(hang(10, 12, 14), { id: 10, role: "engineer" }, (h) => h.userId, dep))).toEqual([10, 14]);
  });
  it("★ đọc vai chủ hàng lỗi ⇒ loại hết hàng của người khác (chỉ còn của mình)", async () => {
    const dep = taoDep({
      async layVaiTro() {
        throw new Error("hỏng");
      },
    });
    expect(ids(await locTheoChu(hang(10, 12, 14), { id: 10, role: "engineer" }, (h) => h.userId, dep))).toEqual([10]);
  });
  it("chủ không còn trong bảng users ⇒ loại", async () => {
    expect(ids(await locTheoChu(hang(10, 999), { id: 10, role: "engineer" }, (h) => h.userId, taoDep()))).toEqual([10]);
  });
});

describe("bộ đệm phạm vi chủ hàng — TTL ngắn", () => {
  it("trong TTL: không hỏi lại; sau TTL: hỏi lại và dùng phạm vi MỚI (đổi phân công rồi phát sự kiện)", async () => {
    const nguoi: Record<number, { role: string; pv: PhamViNhaMay }> = { ...NGUOI, 20: { role: "engineer", pv: [1] } };
    const dep = taoDep({}, nguoi);
    const xem = { id: 10, role: "engineer" };
    expect(ids(await locTheoChu(hang(20), xem, (h) => h.userId, dep))).toEqual([20]);
    const n1 = dep.goi.phanGiai;

    nguoi[20] = { role: "engineer", pv: [2] }; // người 20 chuyển sang nhà máy 2
    dep.datGio(1_000_000 + TTL_PHAM_VI_CHU_MS - 1);
    expect(ids(await locTheoChu(hang(20), xem, (h) => h.userId, dep))).toEqual([20]); // còn trong TTL: đệm (nợ ghi nhận, ≤ 30 s)
    expect(dep.goi.phanGiai).toBe(n1 + 1); // chỉ người xem được hỏi lại, chủ 20 lấy từ đệm

    dep.datGio(1_000_000 + TTL_PHAM_VI_CHU_MS + 1);
    expect(ids(await locTheoChu(hang(20), xem, (h) => h.userId, dep))).toEqual([]); // ★ hết TTL ⇒ phạm vi mới ⇒ không còn thấy
  });
  it("xoaCachePhamViChu(id) buộc hỏi lại ngay (điểm nối cho hook F5)", async () => {
    const nguoi: Record<number, { role: string; pv: PhamViNhaMay }> = { ...NGUOI, 20: { role: "engineer", pv: [1] } };
    const dep = taoDep({}, nguoi);
    await phamViCacChu([20], dep);
    nguoi[20] = { role: "engineer", pv: [2] };
    expect((await phamViCacChu([20], dep)).get(20)).toEqual([1]);
    xoaCachePhamViChu(20);
    expect((await phamViCacChu([20], dep)).get(20)).toEqual([2]);
  });
  it("lỗi phân giải KHÔNG được đệm (lần sau thử lại)", async () => {
    let hong = true;
    const dep = taoDep({
      async phanGiai(u) {
        if (hong && u.userId === 10) throw new Error("hỏng");
        return NGUOI[u.userId].pv;
      },
    });
    expect((await phamViCacChu([10], dep)).has(10)).toBe(false);
    hong = false;
    expect((await phamViCacChu([10], dep)).get(10)).toEqual([1]);
  });
});

describe("nguoiNhanThayChu — người nhận sự kiện socket", () => {
  it("★ chủ sự kiện không rõ ⇒ chỉ admin nhận", async () => {
    const dep = taoDep();
    expect(await nguoiNhanThayChu({ id: 1, role: "admin" }, undefined, dep)).toBe(true);
    expect(await nguoiNhanThayChu({ id: 10, role: "engineer" }, undefined, dep)).toBe(false);
  });
  it("★ sự kiện của chủ nhà máy 1: engineer nhà máy 1 nhận, nhà máy 2 / chưa gán không", async () => {
    const dep = taoDep();
    expect(await nguoiNhanThayChu({ id: 10, role: "engineer" }, 14, dep)).toBe(true);
    expect(await nguoiNhanThayChu({ id: 11, role: "engineer" }, 14, dep)).toBe(false);
    expect(await nguoiNhanThayChu({ id: 13, role: "engineer" }, 14, dep)).toBe(false);
  });
});
