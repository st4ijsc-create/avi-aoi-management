import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { driverHost, locTruocKhiCho, duongCuaDeXuat, duyetQuaTep, tomTatKiemChoModel, tomTatChiSoChoModel, TRAN_TU_CHAY, hanDuyetHieuLucMs, hanKeHoachHieuLucMs, idKeHoach, tepDangCho, TTL_THE_DUYET_MS, tepChoDuyet, type PhuThuocHost, type ChinhSachDuyet } from "./driverHost";
import type { KetQuaKiem } from "./kiemChung";
import { ghiQuyet } from "./duyet";
import type { DauVaoDriver } from "./chayMotViec";
import type { TheViec } from "./theViec";

const THE: TheViec = {
  ma: "TC-77",
  mucTieu: "x",
  tepDuocPhep: ["client/src/lib/a.test.ts"],
  nguCanhDoc: [],
  lenhKiem: "npx vitest run client/src/lib/a.test.ts",
  gioiHan: { giay: 5, vong: 3 },
};
const WT = path.resolve(os.tmpdir(), "_tho_ca_wt_ao");

describe("locTruocKhiCho — tự từ chối trước khi tới người duyệt", () => {
  const loc = (ten: string, thamSo: Record<string, unknown>) => locTruocKhiCho({ ten, thamSo }, THE, WT);
  it("★ ghi đúng tệp trong thẻ ⇒ cho (đường tương đối và tuyệt đối trong worktree)", () => {
    expect(loc("apply_diff", { path: "client/src/lib/a.test.ts" })).toEqual({ loai: "cho", duong: ["client/src/lib/a.test.ts"] });
    expect(loc("write_file", { file: path.join(WT, "client", "src", "lib", "a.test.ts") })).toMatchObject({ loai: "cho" });
  });
  it("★ ngoài danh sách / vùng cấm / thoát worktree / tuyệt đối ngoài worktree ⇒ tự từ chối", () => {
    for (const p of ["client/src/lib/b.ts", "server/services/ot/x.ts", "../x.ts", "/etc/passwd", path.resolve(WT, "..", "ngoai.ts"), ".env"]) {
      expect(loc("apply_diff", { path: p }).loai, p).toBe("tu-choi");
    }
  });
  it("★ không xác định được đường ⇒ từ chối (fail-closed); tool lạ ⇒ từ chối; delete/rename ngoài thẻ ⇒ từ chối", () => {
    expect(loc("apply_diff", {}).loai).toBe("tu-choi");
    expect(loc("delegate", { path: "client/src/lib/a.test.ts" }).loai).toBe("tu-choi");
    expect(loc("delete_file", { path: "client/src/lib/b.ts" }).loai).toBe("tu-choi");
    expect(loc("rename_file", { from: "client/src/lib/a.test.ts", to: "client/src/lib/b.ts" }).loai).toBe("tu-choi");
  });
  it("★ một đường hợp lệ + một đường ngoài trong cùng lời gọi ⇒ từ chối cả lời gọi", () => {
    expect(loc("apply_diff", { files: [{ path: "client/src/lib/a.test.ts" }, { path: "client/src/lib/b.ts" }] }).loai).toBe("tu-choi");
  });
  it("★ run_command: chỉ ĐÚNG lệnh kiểm", () => {
    expect(loc("run_command", { command: THE.lenhKiem })).toMatchObject({ loai: "tu-chay", lenh: THE.lenhKiem });
    expect(loc("run_command", { command: `${THE.lenhKiem} && rm -rf x` }).loai).toBe("tu-choi");
    expect(loc("run_command", { command: "npm test" }).loai).toBe("tu-choi");
    expect(loc("run_command", {}).loai).toBe("tu-choi");
  });
  it("duongCuaDeXuat gom mọi khoá", () => {
    expect(duongCuaDeXuat({ path: "a", files: ["b", { path: "c" }], to: "d" }).sort()).toEqual(["a", "b", "c", "d"]);
  });
});

// ── driver với bản giả của host ────────────────────────────────────────────────────────────────────
type Su = { loai: string; [k: string]: unknown };
function taoDep(kichBan: (phat: (e: Su) => void, dep: { duyet: string[]; bac: string[] }) => Promise<void> | void, chinhSach: ChinhSachDuyet, over: Partial<PhuThuocHost> = {}) {
  const dd = { duyet: [] as string[], bac: [] as Array<string> };
  let f: ((m: { seq: number; suKien: Su }) => void) | null = null;
  let seq = 0;
  const dep: PhuThuocHost = {
    kiemMoiTruong: async () => null,
    taoLuot: async () => {
      setTimeout(() => void kichBan((e) => f?.({ seq: seq++, suKien: e }), dd), 30);
      return { ok: true, runId: "r1" };
    },
    nghe: (_r, fn) => {
      f = fn as never;
      return () => {
        f = null;
      };
    },
    huy: () => undefined,
    duyet: async (id) => {
      dd.duyet.push(id);
      return { ok: true, daGhi: true, status: "executed" };
    },
    bac: async (id, ly) => {
      dd.bac.push(`${id}|${ly}`);
    },
    duAnId: () => "_tho_ca_wt_ao",
    chinhSachDuyet: chinhSach,
    bay: () => Date.now(),
    datKhoaKy: () => ({ ok: true, tam: false }),
    ...over,
  };
  return { dep, dd };
}
const dauVao = (ra: string): DauVaoDriver => ({ the: THE, wt: WT, lenh: "L", hanGiay: 5, ra, ghiLuotDir: null, khoGhi: {} });
const canDuyet = (ten: string, thamSo: Record<string, unknown>, id = "act-1") => ({ loai: "can-duyet", id: "tc1", deXuat: { ten, thamSo, moTa: "m", pendingActionId: id, xemTruoc: "diff" } });

let ra: string;
beforeEach(() => {
  ra = fs.mkdtempSync(path.join(os.tmpdir(), "drv-"));
});
afterEach(() => fs.rmSync(ra, { recursive: true, force: true }));

describe("driverHost", () => {
  it("★ chấp nhận ⇒ gọi duyệt thật (một lần), đếm số liệu, token từ usage, vòng từ goi-tool", async () => {
    const dongY: ChinhSachDuyet = async () => ({ quyet: "chap-nhan" });
    const { dep, dd } = taoDep(async (phat) => {
      phat({ loai: "goi-tool", luot: 2, goi: {} });
      phat({ loai: "usage", vao: 100, ra: 5, cacheN: 80, promptN: 20 });
      phat(canDuyet("apply_diff", { path: "client/src/lib/a.test.ts", reason: "viết test" }));
      await new Promise((r) => setTimeout(r, 150));
      phat({ loai: "usage", vao: 120, ra: 5, cacheN: 100, promptN: 20 });
      phat({ loai: "xong", lyDo: "hoan-thanh" });
    }, dongY);
    const kq = await driverHost(dep)(dauVao(ra));
    expect(dd.duyet).toEqual(["act-1"]);
    expect(dd.bac).toEqual([]);
    expect(kq).toMatchObject({ vong: 2, hetGio: false, token: { cache: 180, prompt: 40, soLuotModel: 2 }, duyet: { soLanCho: 1, soChapNhan: 1, soTuChoi: 0 } });
    expect(kq.loi).toBeUndefined();
  });

  it("★ ghi NGOÀI thẻ ⇒ tự từ chối, KHÔNG gọi chính sách duyệt (không hỏi người)", async () => {
    let hoi = 0;
    const { dep, dd } = taoDep(async (phat) => {
      phat(canDuyet("apply_diff", { path: "server/services/ot/x.ts" }));
      await new Promise((r) => setTimeout(r, 100));
      phat({ loai: "xong", lyDo: "hoan-thanh" });
    }, async () => {
      hoi++;
      return { quyet: "chap-nhan" };
    });
    const kq = await driverHost(dep)(dauVao(ra));
    expect(hoi).toBe(0);
    expect(dd.duyet).toEqual([]);
    expect(dd.bac[0]).toContain("tự từ chối");
    expect(kq.duyet).toMatchObject({ soLanCho: 0, soTuChoi: 1 });
  });

  it("từ chối của người ⇒ bac với lý do; hết giờ duyệt ⇒ bac + hetGio", async () => {
    const { dep, dd } = taoDep(async (phat) => {
      phat(canDuyet("apply_diff", { path: "client/src/lib/a.test.ts" }));
      await new Promise((r) => setTimeout(r, 100));
      phat({ loai: "xong", lyDo: "hoan-thanh" });
    }, async () => ({ quyet: "tu-choi", lyDo: "sai" }));
    expect((await driverHost(dep)(dauVao(ra))).duyet).toMatchObject({ soTuChoi: 1, soChapNhan: 0 });
    expect(dd.bac[0]).toBe("act-1|sai");

    const t = taoDep(async (phat) => {
      phat(canDuyet("apply_diff", { path: "client/src/lib/a.test.ts" }));
      await new Promise((r) => setTimeout(r, 100));
      phat({ loai: "xong", lyDo: "hoan-thanh" });
    }, async () => ({ quyet: "het-gio" }));
    expect((await driverHost(t.dep)(dauVao(ra))).hetGio).toBe(true);
  });

  it("★ môi trường không đạt ⇒ KHÔNG tạo lượt; lỗi model ⇒ loi", async () => {
    let tao = 0;
    const a = taoDep(() => undefined, async () => ({ quyet: "tu-choi" }), { kiemMoiTruong: async () => "current_database() = aoi_management", taoLuot: async () => (tao++, { ok: false as const, loi: "x" }) });
    const kq = await driverHost(a.dep)(dauVao(ra));
    expect(kq.loi).toContain("môi trường không đạt");
    expect(tao).toBe(0);
    const b = taoDep(async (phat) => phat({ loai: "loi", ma: "MODEL", thongDiep: "chết" }), async () => ({ quyet: "tu-choi" }));
    expect((await driverHost(b.dep)(dauVao(ra))).loi).toContain("MODEL");
  });

  it("★ thời gian chờ người KHÔNG tính vào hạn model (chờ 1,5 s với hạn 1 s vẫn không het-gio)", async () => {
    const cham: ChinhSachDuyet = async () => {
      await new Promise((r) => setTimeout(r, 1500));
      return { quyet: "chap-nhan" };
    };
    const { dep } = taoDep(async (phat) => {
      phat(canDuyet("apply_diff", { path: "client/src/lib/a.test.ts" }));
      await new Promise((r) => setTimeout(r, 1700));
      phat({ loai: "xong", lyDo: "hoan-thanh" });
    }, cham);
    const kq = await driverHost(dep)({ ...dauVao(ra), hanGiay: 1 });
    expect(kq.hetGio).toBe(false);
    expect(kq.duyet?.giayChoDuyet).toBeGreaterThanOrEqual(1.4);
  });
});

describe("duyetQuaTep + duyet.ts (hồ sơ ↔ quyết định)", () => {
  const ho = (id: string) => ({ ma: "TC-77", id, ten: "apply_diff", duong: ["a"], moTa: null, lyDoModel: null, xemTruoc: null, thamSo: {}, nguonDangNgo: [], luc: "t" });
  it("★ id lệch ⇒ ghiQuyet từ chối; đúng id ⇒ duyetQuaTep nhận quyết định", async () => {
    const p = duyetQuaTep(ho("act-9"), { ra, hanMs: 5000 });
    await new Promise((r) => setTimeout(r, 100));
    expect(fs.existsSync(tepChoDuyet(ra, "TC-77"))).toBe(true);
    expect(ghiQuyet({ ma: "TC-77", id: "act-SAI", quyet: "chap-nhan", ra })).toMatchObject({ ok: false });
    expect(ghiQuyet({ ma: "TC-77", id: "act-9", quyet: "tu-choi", lyDo: "không", ra })).toMatchObject({ ok: true });
    expect(await p).toEqual({ quyet: "tu-choi", lyDo: "không" });
  });
  it("★ tệp quyết định mang id KHÁC bị bỏ qua (không trả lời nhầm thẻ), đúng id mới nhận", async () => {
    const p = duyetQuaTep(ho("act-5"), { ra, hanMs: 5000 });
    await new Promise((r) => setTimeout(r, 100));
    fs.writeFileSync(path.join(ra, "TC-77.quyet.json"), JSON.stringify({ id: "act-LA", quyet: "tu-choi" }));
    await new Promise((r) => setTimeout(r, 900));
    fs.writeFileSync(path.join(ra, "TC-77.quyet.json"), JSON.stringify({ id: "act-5", quyet: "chap-nhan" }));
    expect(await p).toEqual({ quyet: "chap-nhan" });
  });
  it("không có hồ sơ ⇒ ghiQuyet từ chối (không duyệt trước); hết hạn ⇒ het-gio", async () => {
    expect(ghiQuyet({ ma: "TC-77", id: "x", quyet: "chap-nhan", ra })).toMatchObject({ ok: false });
    expect(await duyetQuaTep(ho("act-1"), { ra, hanMs: 700 })).toEqual({ quyet: "het-gio" });
  });
});

import { thieuKhoaModel } from "./driverHost";

describe("driverHost — đo ĐÚNG kết cục (bug TC-01 lần 1: lượt lỗi model bị báo 'xong')", () => {
  const chay = async (kb: Parameters<typeof taoDep>[0], over: Partial<PhuThuocHost> = {}) => {
    const { dep } = taoDep(kb, async () => ({ quyet: "tu-choi" }), over);
    return driverHost(dep)(dauVao(ra));
  };
  it("★ loi RỒI xong(loi-model) — thứ tự thật của host — vẫn là LỖI, mang mã lỗi", async () => {
    const kq = await chay(async (phat) => {
      phat({ loai: "loi", ma: "TOOL_CALL_KHONG_HO_TRO", thongDiep: "model null" });
      phat({ loai: "xong", lyDo: "loi-model" });
    });
    expect(kq.loi).toContain("TOOL_CALL_KHONG_HO_TRO");
    expect(kq.lyDoDung).toBe("loi-model");
  });
  it("★ xong với lyDo KHÁC hoan-thanh (loi-model / het-luot / huy / het-token) ⇒ loi; het-gio ⇒ hetGio; hoan-thanh ⇒ sạch", async () => {
    for (const ly of ["loi-model", "het-luot", "huy", "het-token", "lap-lai"]) {
      const kq = await chay(async (phat) => phat({ loai: "xong", lyDo: ly }));
      expect(kq.loi, ly).toContain(ly);
    }
    expect((await chay(async (phat) => phat({ loai: "xong", lyDo: "het-gio" }))).hetGio).toBe(true);
    const ok = await chay(async (phat) => phat({ loai: "xong", lyDo: "hoan-thanh" }));
    expect(ok.loi).toBeUndefined();
    expect(ok.hetGio).toBe(false);
  });
  it("★ nguồn thứ hai: hàng lượt trangThai=loi mà sự kiện không báo lỗi ⇒ loi", async () => {
    const kq = await chay(async (phat) => phat({ loai: "xong", lyDo: "hoan-thanh" }), { trangThaiLuot: async () => ({ trangThai: "loi", lyDoDung: "loi-model" }) });
    expect(kq.loi).toContain("trangThai=loi");
    const sach = await chay(async (phat) => phat({ loai: "xong", lyDo: "hoan-thanh" }), { trangThaiLuot: async () => ({ trangThai: "xong", lyDoDung: "hoan-thanh" }) });
    expect(sach.loi).toBeUndefined();
  });
  it("thieuKhoaModel liệt kê đúng khoá thiếu", () => {
    expect(thieuKhoaModel({})).toEqual(["LLAMA_SERVER_ENABLED=true", "LLAMA_SERVER_URL", "LLAMA_SERVER_MODEL", "GGUF_CODE_MODEL|GGUF_DEFAULT_MODEL"]);
    expect(thieuKhoaModel({ LLAMA_SERVER_ENABLED: "true", LLAMA_SERVER_URL: "u", LLAMA_SERVER_MODEL: "m", GGUF_DEFAULT_MODEL: "g" })).toEqual([]);
    expect(thieuKhoaModel({ LLAMA_SERVER_ENABLED: "false", LLAMA_SERVER_URL: "u", LLAMA_SERVER_MODEL: "m", GGUF_CODE_MODEL: "g" })).toEqual(["LLAMA_SERVER_ENABLED=true"]);
  });
});

describe("driverHost — lỗi đầu tiên là lỗi gốc", () => {
  it("★ hai sự kiện loi liên tiếp ⇒ giữ lỗi ĐẦU (nguyên nhân gốc), không bị lỗi sau ghi đè", async () => {
    const { dep } = taoDep(async (phat) => {
      phat({ loai: "loi", ma: "GOC", thongDiep: "a" });
      phat({ loai: "loi", ma: "HE_QUA", thongDiep: "b" });
    }, async () => ({ quyet: "tu-choi" }));
    const kq = await driverHost(dep)(dauVao(ra));
    expect(kq.loi).toContain("GOC");
    expect(kq.loi).not.toContain("HE_QUA");
  });
});

import { bamKhoaKyTam, keLoiCongCu } from "./driverHost";

describe("khoá ký checkpoint & đếm lỗi công cụ (TC-01 lượt 2: KHONG_CO_KHOA chặn mọi lần ghi)", () => {
  it("★ bamKhoaKyTam: đã có khoá ≥16 ⇒ giữ nguyên (không tạm); thiếu / ngắn ⇒ SINH khoá riêng 64 hex", () => {
    const co: Record<string, string> = { SECRET_ENCRYPTION_KEY: "x".repeat(20) };
    expect(bamKhoaKyTam(co)).toEqual({ ok: true, tam: false });
    expect(co.SECRET_ENCRYPTION_KEY).toBe("x".repeat(20));
    const jwt: Record<string, string> = { JWT_SECRET: "y".repeat(16) };
    expect(bamKhoaKyTam(jwt)).toEqual({ ok: true, tam: false });
    expect(jwt.SECRET_ENCRYPTION_KEY).toBeUndefined();
    for (const e of [{}, { SECRET_ENCRYPTION_KEY: "ngan" }, { JWT_SECRET: "ngan" }] as Array<Record<string, string>>) {
      expect(bamKhoaKyTam(e)).toEqual({ ok: true, tam: true });
      expect(e.SECRET_ENCRYPTION_KEY).toMatch(/^[0-9a-f]{64}$/);
    }
    const a: Record<string, string> = {};
    const b: Record<string, string> = {};
    bamKhoaKyTam(a);
    bamKhoaKyTam(b);
    expect(a.SECRET_ENCRYPTION_KEY).not.toBe(b.SECRET_ENCRYPTION_KEY);
  });
  it("★ không tạo được khoá ⇒ KHÔNG tạo lượt (loi-driver nêu rõ); khoá tạm ⇒ luuY, không lộ khoá", async () => {
    let tao = 0;
    const a = taoDep(() => undefined, async () => ({ quyet: "tu-choi" }), { datKhoaKy: () => ({ ok: false, tam: false }), taoLuot: async () => (tao++, { ok: false as const, loi: "x" }) });
    expect((await driverHost(a.dep)(dauVao(ra))).loi).toContain("khoá ký checkpoint");
    expect(tao).toBe(0);
    const b = taoDep(async (phat) => phat({ loai: "xong", lyDo: "hoan-thanh" }), async () => ({ quyet: "tu-choi" }), { datKhoaKy: () => ({ ok: true, tam: true }) });
    const kq = await driverHost(b.dep)(dauVao(ra));
    expect(kq.luuY?.join(" ")).toContain("khoá pilot tạm");
    expect(JSON.stringify(kq)).not.toMatch(/[0-9a-f]{64}/);
  });
  it("★ loiCongCu đếm theo mã (kèm mã chi tiết trong tóm tắt)", async () => {
    const { dep } = taoDep(async (phat) => {
      for (let i = 0; i < 3; i++) phat({ loai: "ket-qua-tool", id: `t${i}`, ten: "write_file", ok: false, ma: "CHECKPOINT_LOI", tomTat: "Refused: checkpoint could not be created (KHONG_CO_KHOA)" });
      phat({ loai: "ket-qua-tool", id: "t9", ten: "x", ok: false, tomTat: "boom" });
      phat({ loai: "ket-qua-tool", id: "t10", ten: "x", ok: true, tomTat: "ok" });
      phat({ loai: "xong", lyDo: "hoan-thanh" });
    }, async () => ({ quyet: "tu-choi" }));
    expect((await driverHost(dep)(dauVao(ra))).loiCongCu).toEqual({ "CHECKPOINT_LOI:KHONG_CO_KHOA": 3, KHONG_RO: 1 });
  });
  it("keLoiCongCu: không mã chi tiết ⇒ chỉ ma", () => {
    expect(keLoiCongCu({ ma: "NOT_FOUND", tomTat: "file not found" })).toBe("NOT_FOUND");
    expect(keLoiCongCu({})).toBe("KHONG_RO");
  });
});

describe("loiCongCu — nhãn riêng cho từ chối (không lẫn lỗi công cụ thật)", () => {
  it("★ BI_BAC do bộ chạy tự từ chối ⇒ TU_CHOI_BO_CHAY; do người duyệt ⇒ TU_CHOI_NGUOI_DUYET; BI_BAC lạ (id không do ta bác) vẫn là BI_BAC; lỗi thật giữ mã", async () => {
    const { dep } = taoDep(async (phat) => {
      phat(canDuyet("apply_diff", { path: "server/services/ot/x.ts" }, "a1")); // bộ chạy tự từ chối
      await new Promise((r) => setTimeout(r, 80)); // host chỉ phát kết quả tool SAU quyết định (thứ tự thật)
      phat({ loai: "ket-qua-tool", id: "tc1", ten: "apply_diff", ok: false, ma: "BI_BAC", tomTat: "rejected" });
      phat({ loai: "ket-qua-tool", id: "tc-la", ten: "x", ok: false, ma: "BI_BAC", tomTat: "rejected" });
      phat({ loai: "ket-qua-tool", id: "tc-that", ten: "x", ok: false, ma: "NOT_FOUND", tomTat: "no file" });
      phat({ loai: "xong", lyDo: "hoan-thanh" });
    }, async () => ({ quyet: "tu-choi" }));
    expect((await driverHost(dep)(dauVao(ra))).loiCongCu).toEqual({ TU_CHOI_BO_CHAY: 1, BI_BAC: 1, NOT_FOUND: 1 });
  });
  it("người duyệt từ chối ⇒ TU_CHOI_NGUOI_DUYET", async () => {
    const { dep } = taoDep(async (phat) => {
      phat(canDuyet("apply_diff", { path: "client/src/lib/a.test.ts" }, "a2"));
      await new Promise((r) => setTimeout(r, 120));
      phat({ loai: "ket-qua-tool", id: "tc1", ten: "apply_diff", ok: false, ma: "BI_BAC", tomTat: "rejected" });
      phat({ loai: "xong", lyDo: "hoan-thanh" });
    }, async () => ({ quyet: "tu-choi", lyDo: "sai" }));
    expect((await driverHost(dep)(dauVao(ra))).loiCongCu).toEqual({ TU_CHOI_NGUOI_DUYET: 1 });
  });
});

describe("driverHost — TỰ CHẠY lệnh kiểm thay thẻ run_command chờ người (L2, TC-05)", () => {
  const kiemFake = (over: Partial<KetQuaKiem> = {}): KetQuaKiem => ({
    lenh: "x",
    exit: 1,
    hetGio: false,
    giay: 2,
    duoi: "FAIL a.test.ts > ca một\nAssertionError: expected 1 to be 2",
    vitest: { tep: { dat: 0, hong: 1, boQua: 0, tong: 1 }, ca: { dat: 3, hong: 1, boQua: 0, tong: 4 } },
    ...over,
  });
  it("★ run_command đúng LỆNH KIỂM ⇒ bộ chạy tự chạy, KHÔNG hỏi người, kết quả thật về model qua lý do thẻ; nhãn TU_CHAY_LENH_KIEM", async () => {
    let hoi = 0;
    const goi: Array<[string, string]> = [];
    const { dep, dd } = taoDep(
      async (phat) => {
        phat(canDuyet("run_command", { command: THE.lenhKiem }));
        await new Promise((r) => setTimeout(r, 120));
        phat({ loai: "xong", lyDo: "hoan-thanh" });
      },
      async () => {
        hoi++;
        return { quyet: "chap-nhan" };
      },
      { chayKiem: async (l, w) => (goi.push([l, w]), kiemFake({ lenh: l })) },
    );
    const kq = await driverHost(dep)(dauVao(ra));
    expect(hoi).toBe(0);
    expect(dd.duyet).toEqual([]);
    expect(goi).toEqual([[THE.lenhKiem, WT]]);
    expect(dd.bac).toHaveLength(1);
    expect(dd.bac[0]).toContain("KHÔNG PHẢI bị người từ chối");
    expect(dd.bac[0]).toContain("Tests 1 failed | 3 passed (4)");
    expect(dd.bac[0]).toContain("Test Files 1 failed | 0 passed (1)");
    expect(dd.bac[0]).toContain("AssertionError: expected 1 to be 2");
    expect(kq.duyet).toMatchObject({ soLanCho: 0, soChapNhan: 0 });
    expect(kq.ghiChu.join(" ")).toMatch(/tự chạy lệnh kiểm lần 1: exit 1/);
  });
  it("★ lệnh KHÁC lệnh kiểm vẫn tự từ chối, KHÔNG chạy gì", async () => {
    let chay = 0;
    const { dep, dd } = taoDep(
      async (phat) => {
        phat(canDuyet("run_command", { command: `${THE.lenhKiem} && echo hi` }));
        await new Promise((r) => setTimeout(r, 100));
        phat({ loai: "xong", lyDo: "hoan-thanh" });
      },
      async () => ({ quyet: "chap-nhan" }),
      { chayKiem: async (l) => (chay++, kiemFake({ lenh: l })) },
    );
    await driverHost(dep)(dauVao(ra));
    expect(chay).toBe(0);
    expect(dd.bac[0]).toContain("tự từ chối");
  });
  it("★ nhãn loiCongCu của lần tự chạy là TU_CHAY_LENH_KIEM (không lẫn TU_CHOI_BO_CHAY / lỗi công cụ thật)", async () => {
    const { dep } = taoDep(
      async (phat) => {
        phat(canDuyet("run_command", { command: THE.lenhKiem }, "rc1"));
        await new Promise((r) => setTimeout(r, 80));
        phat({ loai: "ket-qua-tool", id: "tc1", ten: "run_command", ok: false, ma: "BI_BAC", tomTat: "rejected" });
        phat({ loai: "xong", lyDo: "hoan-thanh" });
      },
      async () => ({ quyet: "chap-nhan" }),
      { chayKiem: async (l) => kiemFake({ lenh: l, exit: 0 }) },
    );
    expect((await driverHost(dep)(dauVao(ra))).loiCongCu).toEqual({ TU_CHAY_LENH_KIEM: 1 });
  });
  it("★ quá trần số lần tự chạy ⇒ từ chối, không chạy thêm", async () => {
    let chay = 0;
    const { dep, dd } = taoDep(
      async (phat) => {
        for (let i = 0; i < TRAN_TU_CHAY + 2; i++) {
          phat(canDuyet("run_command", { command: THE.lenhKiem }));
          await new Promise((r) => setTimeout(r, 40));
        }
        phat({ loai: "xong", lyDo: "hoan-thanh" });
      },
      async () => ({ quyet: "chap-nhan" }),
      { chayKiem: async (l) => (chay++, kiemFake({ lenh: l, exit: 0 })) },
    );
    await driverHost(dep)(dauVao(ra));
    expect(chay).toBe(TRAN_TU_CHAY);
    expect(dd.bac.at(-1)).toContain(`đã tự chạy lệnh kiểm ${TRAN_TU_CHAY} lần`);
  });
  it("★★★ `chayKiem` trong DauVaoDriver (do chayMotViec đặt khi --cho-phep-db) THẮNG hàm của phụ thuộc: vòng tự chạy trong lượt dùng đúng hàm có DB _test", async () => {
    const goiPhuThuoc: string[] = [];
    const goiDauVao: string[] = [];
    const { dep } = taoDep(
      async (phat) => {
        phat(canDuyet("run_command", { command: THE.lenhKiem }));
        await new Promise((r) => setTimeout(r, 120));
        phat({ loai: "xong", lyDo: "hoan-thanh" });
      },
      async () => ({ quyet: "chap-nhan" }),
      { chayKiem: async (l) => (goiPhuThuoc.push(l), kiemFake({ lenh: l })) },
    );
    await driverHost(dep)({ ...dauVao(ra), chayKiem: async (l) => (goiDauVao.push(l), kiemFake({ lenh: l })) });
    expect(goiDauVao).toEqual([THE.lenhKiem]);
    expect(goiPhuThuoc).toEqual([]);
  });
  it("★★ không có `chayKiem` trong DauVaoDriver ⇒ vẫn dùng hàm của phụ thuộc (DB chết mặc định, hành vi cũ)", async () => {
    const goiPhuThuoc: string[] = [];
    const { dep } = taoDep(
      async (phat) => {
        phat(canDuyet("run_command", { command: THE.lenhKiem }));
        await new Promise((r) => setTimeout(r, 120));
        phat({ loai: "xong", lyDo: "hoan-thanh" });
      },
      async () => ({ quyet: "chap-nhan" }),
      { chayKiem: async (l) => (goiPhuThuoc.push(l), kiemFake({ lenh: l })) },
    );
    await driverHost(dep)(dauVao(ra));
    expect(goiPhuThuoc).toEqual([THE.lenhKiem]);
  });
  it("★★★ CỜ TẮT ⇒ KHÔNG ĐỔI MỘT BYTE: tomTatKiemChoModel giữ nguyên văn đuôi đầu ra, kể cả khi đuôi có chuỗi giống URL", () => {
    const duoi = "ECONNREFUSED postgresql://u:matkhau@h:5434/db và avi_app:matkhau@h:5434";
    const k = kiemFake({ duoi, exit: 1 });
    const s = tomTatKiemChoModel(k, 1);
    expect(s).toContain(duoi);
    expect(s).not.toContain("***");
    // tái dựng đúng văn bản kỳ vọng từ các phần đã biết (không dựa vào hàm đang thử)
    expect(s).toBe(
      [
        "[pilot] KHÔNG PHẢI bị người từ chối: bộ chạy đã TỰ CHẠY lệnh kiểm này thay bạn (lần 1); đây là KẾT QUẢ THẬT. thoát mã 1.",
        "Test Files 1 failed | 0 passed (1)",
        "Tests 1 failed | 3 passed (4)",
        "--- đuôi đầu ra ---",
        duoi,
        "Đỏ ⇒ sửa tệp rồi gọi lại đúng lệnh này; xanh ⇒ báo kết quả cuối. Bộ chạy cũng tự chạy lại lệnh kiểm khi bạn kết thúc.",
      ].join("\n"),
    );
  });
  describe("chế độ `chi-so` (--cho-phep-db): model chỉ nhận CON SỐ — không đuôi, không tên ca, không văn bản lỗi", () => {
    const MK = "Mk9xPz3Qw7Ab";
    const DUOI_BI_MAT = `DUOI_KHONG_DUOC_LOT assertion: password=${MK} postgresql://u:${MK}@h/db`;
    const kiemDo = (over: Partial<KetQuaKiem> = {}) =>
      kiemFake({ duoi: DUOI_BI_MAT, tenCaDo: ["nhóm > ca một", "nhóm > ca hai"], loi: undefined, ...over });
    it("★★★ tomTatChiSoChoModel: có mã thoát, Test Files, Tests (số ca đỏ); KHÔNG đuôi và KHÔNG tên ca", () => {
      const s = tomTatChiSoChoModel(kiemDo(), 2, [MK]);
      expect(s).toContain("lần 2");
      expect(s).toContain("thoát mã 1");
      expect(s).toContain("Test Files 1 failed | 0 passed (1)");
      expect(s).toContain("Tests 1 failed | 3 passed (4)");
      expect(s).not.toContain("nhóm > ca một");
      expect(s).not.toContain("nhóm > ca hai");
      expect(s).not.toContain("DUOI_KHONG_DUOC_LOT");
      expect(s).not.toContain("assertion");
      expect(s).not.toContain(MK);
    });
    it("★★★ tên ca do model đặt mà mang mật khẩu ở mọi dạng ⇒ KHÔNG xuất hiện (tên ca không được đưa cho model)", () => {
      const buf = Buffer.from(MK);
      const ten = [`ca ${MK}`, `ca ${buf.toString("base64")}`, `ca ${buf.toString("hex")}`, `ca ${MK.split("").reverse().join("")}`, `ca ${MK.split("").join(" ")}`, `ca ${encodeURIComponent(MK)}`];
      const s = tomTatChiSoChoModel(kiemDo({ tenCaDo: ten }), 1, [MK]);
      for (const t of ten) expect(s).not.toContain(t);
      expect(s).not.toContain(MK);
      expect(s).not.toContain(buf.toString("base64"));
      expect(s).not.toContain(buf.toString("hex"));
      expect(s).not.toContain(MK.split("").reverse().join(""));
      expect(s).not.toContain(MK.split("").join(" "));
    });
    it("★★ lưới thứ hai: dòng tổng kết giả mang mật khẩu (k.vitest) vẫn không lọt vì chỉ số được in từ SỐ, không từ văn bản", () => {
      const s = tomTatChiSoChoModel(kiemDo({ duoi: `Tests ${MK}` }), 1, [MK]);
      expect(s).not.toContain(MK);
    });
    it("★★ lỗi khởi chạy / hết hạn: nói ngắn, KHÔNG chép văn bản lỗi (có thể mang bí mật)", () => {
      const s = tomTatChiSoChoModel(kiemDo({ exit: null, loi: `spawn lỗi ${MK}` }), 1, [MK]);
      expect(s).toContain("không khởi chạy được");
      expect(s).not.toContain("spawn lỗi");
      expect(tomTatChiSoChoModel(kiemDo({ exit: null, hetGio: true }), 1, [MK])).toContain("hết hạn sau 2s");
    });
    it("★★ không có dòng tổng kết vitest ⇒ nói rõ, không bịa số", () => {
      const s = tomTatChiSoChoModel(kiemDo({ vitest: { tep: null, ca: null } }), 1, [MK]);
      expect(s).toContain("Test Files: (không có dòng tổng kết)");
      expect(s).toContain("Tests: (không có dòng tổng kết)");
    });
    const chayHost = async (cheDo: boolean, ra: string) => {
      const { dep, dd } = taoDep(
        async (phat) => {
          phat(canDuyet("run_command", { command: THE.lenhKiem }));
          await new Promise((r) => setTimeout(r, 120));
          phat({ loai: "xong", lyDo: "hoan-thanh" });
        },
        async () => ({ quyet: "chap-nhan" }),
        { chayKiem: async (l) => kiemDo({ lenh: l, dauRaDayDu: `ĐẦY ĐỦ cho người duyệt ${MK}`, tenCaDo: ["nhóm > ca một", `tên mang bí mật ${MK}`] }) },
      );
      await driverHost(dep)({ ...dauVao(ra), ...(cheDo ? { cheDoKiem: "chi-so" as const, giaTriBiMat: [MK] } : {}) });
      return dd.bac[0];
    };
    it("★★★ driverHost: cheDoKiem=chi-so ⇒ lý do thẻ bác gửi model chỉ có số, không đuôi, không tên ca, không mật khẩu", async () => {
      const co = await chayHost(true, ra);
      expect(co).toContain("Tests 1 failed | 3 passed (4)");
      expect(co).not.toContain("nhóm > ca một");
      expect(co).not.toContain("tên mang bí mật");
      expect(co).not.toContain("DUOI_KHONG_DUOC_LOT");
      expect(co).not.toContain(MK);
    });
    it("★★★ driverHost: không đặt cheDoKiem ⇒ hành vi cũ (có đuôi đầu ra)", async () => {
      const khong = await chayHost(false, ra);
      expect(khong).toContain("DUOI_KHONG_DUOC_LOT");
    });
    it("★★★ chi-so: đầu ra ĐẦY ĐỦ ghi ra TỆP kết quả cho người duyệt (đúng nội dung k.dauRaDayDu), KHÔNG vào lời nhắc model; không chi-so ⇒ không tạo tệp", async () => {
      const lenhModel = await chayHost(true, ra);
      const tep = path.join(ra, `${THE.ma}.kiem-trong-luot-lan1.txt`);
      expect(fs.existsSync(tep)).toBe(true);
      expect(fs.readFileSync(tep, "utf8")).toBe(`ĐẦY ĐỦ cho người duyệt ${MK}`);
      expect(lenhModel).not.toContain("ĐẦY ĐỦ cho người duyệt");
      const ra2 = fs.mkdtempSync(path.join(os.tmpdir(), "drv2-"));
      try {
        await chayHost(false, ra2);
        expect(fs.readdirSync(ra2).filter((f) => f.includes("kiem-trong-luot"))).toEqual([]);
      } finally {
        fs.rmSync(ra2, { recursive: true, force: true });
      }
    });
    it("★★★ THỨ TỰ: lời nhắc cho model được GỬI TRƯỚC; tệp đầy đủ chỉ được ghi SAU đó, và nội dung tệp không có đường nào vào lời nhắc", async () => {
      const tep = path.join(ra, `${THE.ma}.kiem-trong-luot-lan1.txt`);
      const tonTaiLucBac: boolean[] = [];
      const loiNhac: string[] = [];
      const { dep } = taoDep(
        async (phat) => {
          phat(canDuyet("run_command", { command: THE.lenhKiem }));
          await new Promise((r) => setTimeout(r, 120));
          phat({ loai: "xong", lyDo: "hoan-thanh" });
        },
        async () => ({ quyet: "chap-nhan" }),
        {
          chayKiem: async (l) => kiemDo({ lenh: l, dauRaDayDu: "NOI_DUNG_TEP_KHONG_DUOC_VAO_LOI_NHAC" }),
          bac: async (_id, ly) => {
            tonTaiLucBac.push(fs.existsSync(tep));
            loiNhac.push(ly);
          },
        },
      );
      await driverHost(dep)({ ...dauVao(ra), cheDoKiem: "chi-so", giaTriBiMat: [MK] });
      expect(tonTaiLucBac).toEqual([false]); // lúc gửi lời nhắc, tệp CHƯA tồn tại
      expect(fs.readFileSync(tep, "utf8")).toBe("NOI_DUNG_TEP_KHONG_DUOC_VAO_LOI_NHAC"); // sau đó mới có
      expect(loiNhac.join("\n")).not.toContain("NOI_DUNG_TEP_KHONG_DUOC_VAO_LOI_NHAC");
    });
    it("★★ chi-so mà chayKiem không có dauRaDayDu ⇒ tệp ghi `duoi` (không rỗng, không ném)", async () => {
      const { dep } = taoDep(
        async (phat) => {
          phat(canDuyet("run_command", { command: THE.lenhKiem }));
          await new Promise((r) => setTimeout(r, 120));
          phat({ loai: "xong", lyDo: "hoan-thanh" });
        },
        async () => ({ quyet: "chap-nhan" }),
        { chayKiem: async (l) => kiemFake({ lenh: l, duoi: "ĐUÔI NGẮN" }) },
      );
      await driverHost(dep)({ ...dauVao(ra), cheDoKiem: "chi-so", giaTriBiMat: [] });
      expect(fs.readFileSync(path.join(ra, `${THE.ma}.kiem-trong-luot-lan1.txt`), "utf8")).toBe("ĐUÔI NGẮN");
    });
  });
  it("tomTatKiemChoModel: hết hạn / không khởi chạy được / xanh đều nói rõ", () => {
    expect(tomTatKiemChoModel(kiemFake({ hetGio: true, exit: null }), 2)).toContain("hết hạn sau 2s");
    expect(tomTatKiemChoModel(kiemFake({ loi: "spawn ENOENT", exit: null }), 1)).toContain("không khởi chạy được: spawn ENOENT");
    const xanh = tomTatKiemChoModel(kiemFake({ exit: 0, vitest: { tep: { dat: 1, hong: 0, boQua: 0, tong: 1 }, ca: { dat: 4, hong: 0, boQua: 0, tong: 4 } } }), 1);
    expect(xanh).toContain("thoát mã 0");
    expect(xanh).toContain("Tests 4 passed (4)");
  });
});

describe("driverHost — hạn chờ người không vượt TTL thẻ + dang-cho.txt (L2, TC-05 lượt 2: thẻ hết hạn 14:04:27, hạn báo 14:09:27)", () => {
  it("★ hanDuyetHieuLucMs: --han-duyet 600 s bị cắt về TTL thẻ − biên an toàn; giá trị nhỏ hơn giữ nguyên", () => {
    expect(hanDuyetHieuLucMs(600)).toBe(TTL_THE_DUYET_MS - 15_000);
    expect(hanDuyetHieuLucMs(120)).toBe(120_000);
    expect(hanDuyetHieuLucMs(0)).toBe(1000);
  });
  it("★ thẻ ghi: chính sách nhận hanMs đã cắt + hetHanLuc ≈ lúc + hanMs; ghiChu nói rõ việc cắt", async () => {
    const thay: Array<{ hanMs: number; hetHanLuc?: string; luc: string }> = [];
    const { dep } = taoDep(
      async (phat) => {
        phat(canDuyet("apply_diff", { path: "client/src/lib/a.test.ts" }));
        await new Promise((r) => setTimeout(r, 100));
        phat({ loai: "xong", lyDo: "hoan-thanh" });
      },
      async (h, ctx) => (thay.push({ hanMs: ctx.hanMs, hetHanLuc: h.hetHanLuc, luc: h.luc }), { quyet: "tu-choi", lyDo: "thử" }),
    );
    const kq = await driverHost(dep, 600)(dauVao(ra));
    expect(thay[0].hanMs).toBe(TTL_THE_DUYET_MS - 15_000);
    expect(Date.parse(thay[0].hetHanLuc!) - Date.parse(thay[0].luc)).toBeGreaterThan(TTL_THE_DUYET_MS - 20_000);
    expect(Date.parse(thay[0].hetHanLuc!) - Date.parse(thay[0].luc)).toBeLessThan(TTL_THE_DUYET_MS);
    expect(kq.ghiChu.join(" ")).toMatch(/--han-duyet 600s dài hơn TTL thẻ 300s/);
  });
  it("★ duyetQuaTep ghi dang-cho.txt (mã, id, HET HAN) ngay khi thẻ xuất hiện và xoá về '(không có thẻ chờ)' khi có quyết định", async () => {
    const h = { ma: "TC-99", id: "act-9", ten: "write_file", duong: ["a.ts"], moTa: null, lyDoModel: null, xemTruoc: null, thamSo: {}, nguonDangNgo: [], luc: new Date().toISOString(), hetHanLuc: "2026-11-08T14:04:27.000Z" };
    const p = duyetQuaTep(h, { ra, hanMs: 5000 });
    await new Promise((r) => setTimeout(r, 200));
    const dang = fs.readFileSync(tepDangCho(ra), "utf8");
    expect(dang).toContain("TC-99 write_file a.ts id=act-9 HET HAN 2026-11-08T14:04:27.000Z");
    fs.writeFileSync(path.join(ra, "TC-99.quyet.json"), JSON.stringify({ id: "act-9", quyet: "chap-nhan" }));
    expect((await p).quyet).toBe("chap-nhan");
    expect(fs.readFileSync(tepDangCho(ra), "utf8")).toMatch(/^\(không có thẻ chờ\)/);
  });
  it("hết hạn chờ ⇒ het-gio và dang-cho.txt về trống", async () => {
    const h = { ma: "TC-98", id: "act-8", ten: "write_file", duong: [], moTa: null, lyDoModel: null, xemTruoc: null, thamSo: {}, nguonDangNgo: [], luc: new Date().toISOString() };
    expect((await duyetQuaTep(h, { ra, hanMs: 600 })).quyet).toBe("het-gio");
    expect(fs.readFileSync(tepDangCho(ra), "utf8")).toMatch(/^\(không có thẻ chờ\)/);
  });
});

describe("locTruocKhiCho — tự chạy CHỈ khi khớp NGUYÊN VĂN lệnh kiểm (mọi biến thể nối thêm đi đường duyệt người / từ chối)", () => {
  const loc = (command: string) => locTruocKhiCho({ ten: "run_command", thamSo: { command } }, THE, WT);
  it("★ nối thêm &&, ;, |, xuống dòng, $(), backtick, đổi tệp, thêm cờ ⇒ KHÔNG tự chạy (tu-choi)", () => {
    const L = THE.lenhKiem;
    for (const c of [`${L} && echo x`, `${L}; echo x`, `${L} | cat`, `${L}\nrm -rf x`, `${L} $(whoami)`, `${L} \`id\``, `${L} client/src/lib/b.test.ts`, `${L} --reporter=json`, `echo x && ${L}`, `${L}x`, L.replace("a.test.ts", "b.test.ts"), `${L} > ra.txt`]) {
      expect(loc(c).loai, JSON.stringify(c)).toBe("tu-choi");
    }
  });
  it("khoảng trắng đầu/cuối được bỏ (vẫn là cùng lệnh); khác hoa/thường hay thêm dấu cách GIỮA lệnh ⇒ không khớp", () => {
    expect(loc(`  ${THE.lenhKiem}  `).loai).toBe("tu-chay");
    expect(loc(THE.lenhKiem.replace("run", "RUN")).loai).toBe("tu-choi");
    expect(loc(THE.lenhKiem.replace("vitest run", "vitest  run")).loai).toBe("tu-choi");
  });
});

describe("driverHost — CỔNG KẾ HOẠCH 11.3-C (chỉ khi env pilot bật AI_AGENT_CONG_KE_HOACH; kiem-dinh CHƯA rà ĐẠT)", () => {
  const BAM = "abc123def4567890";
  const VIEC = [{ noiDung: "đọc msaReport.ts", trangThai: "cho" }, { noiDung: "viết 12 ca", trangThai: "cho" }];
  const keHoach = (bam = BAM) => ({ loai: "ke-hoach-cho-duyet", viec: VIEC, bam });
  /** máy chủ GIẢ: chỉ nhận băm ĐÚNG băm đã nộp; ghi lại mọi lời gọi */
  const mayChu = (daNop: string) => {
    const goi: Array<{ runId: string; bam: string; quyetDinh: string }> = [];
    const duyetKeHoach: PhuThuocHost["duyetKeHoach"] = async (runId, bam, quyetDinh) => {
      goi.push({ runId, bam, quyetDinh });
      return bam === daNop ? { ok: true, note: null } : { ok: false, note: "BAM_KHONG_KHOP" };
    };
    return { goi, duyetKeHoach };
  };
  it("★ người CHẤP NHẬN ⇒ thuTucDuyetKeHoach(runId, ĐÚNG băm của sự kiện, 'duyet'); KHÔNG gọi confirmAction (duyet) cho kế hoạch; hồ sơ ten=ke_hoach id=kh-<băm>; thống kê riêng", async () => {
    const mc = mayChu(BAM);
    const hoSo: Array<{ ten: string; id: string; hetHanLuc?: string; thamSo: Record<string, unknown> }> = [];
    const { dep, dd } = taoDep(
      async (phat) => {
        phat(keHoach());
        await new Promise((r) => setTimeout(r, 150));
        phat({ loai: "xong", lyDo: "hoan-thanh" });
      },
      async (h) => (hoSo.push(h), { quyet: "chap-nhan" }),
      { duyetKeHoach: mc.duyetKeHoach },
    );
    const kq = await driverHost(dep)(dauVao(ra));
    expect(mc.goi).toEqual([{ runId: "r1", bam: BAM, quyetDinh: "duyet" }]);
    expect(dd.duyet).toEqual([]); // duyệt kế hoạch KHÔNG đi đường confirmAction
    expect(dd.bac).toEqual([]);
    expect(hoSo[0]).toMatchObject({ ten: "ke_hoach", id: idKeHoach(BAM), thamSo: { bam: BAM } });
    expect(hoSo[0].hetHanLuc).toBeTruthy();
    expect(kq.keHoach).toEqual({ soLanCho: 1, soChapNhan: 1, soTuChoi: 0 });
    expect(kq.duyet).toMatchObject({ soLanCho: 0, soChapNhan: 0 }); // không lẫn với thẻ ghi
  });
  it("★ người TỪ CHỐI / hết giờ ⇒ 'bac'; hết giờ đánh dấu hetGio", async () => {
    const a = mayChu(BAM);
    const ta = taoDep(
      async (phat) => {
        phat(keHoach());
        await new Promise((r) => setTimeout(r, 120));
        phat({ loai: "xong", lyDo: "hoan-thanh" });
      },
      async () => ({ quyet: "tu-choi", lyDo: "kế hoạch thiếu bước chạy lệnh kiểm" }),
      { duyetKeHoach: a.duyetKeHoach },
    );
    const kqa = await driverHost(ta.dep)(dauVao(ra));
    expect(a.goi.map((g) => g.quyetDinh)).toEqual(["bac"]);
    expect(kqa.keHoach).toEqual({ soLanCho: 1, soChapNhan: 0, soTuChoi: 1 });
    expect(kqa.hetGio).toBe(false);
    const b = mayChu(BAM);
    const tb = taoDep(
      async (phat) => {
        phat(keHoach());
        await new Promise((r) => setTimeout(r, 120));
        phat({ loai: "xong", lyDo: "hoan-thanh" });
      },
      async () => ({ quyet: "het-gio" }),
      { duyetKeHoach: b.duyetKeHoach },
    );
    const kqb = await driverHost(tb.dep)(dauVao(ra));
    expect(b.goi.map((g) => g.quyetDinh)).toEqual(["bac"]);
    expect(kqb.hetGio).toBe(true);
  });
  it("★ máy chủ từ chối băm (lệch) ⇒ KHÔNG coi là đã duyệt: lỗi vào loiCongCu DUYET_KE_HOACH_LOI:<note>, ghiChu nêu ok=false", async () => {
    const mc = mayChu("bam-da-nop-khac");
    const { dep } = taoDep(
      async (phat) => {
        phat(keHoach(BAM));
        await new Promise((r) => setTimeout(r, 120));
        phat({ loai: "xong", lyDo: "hoan-thanh" });
      },
      async () => ({ quyet: "chap-nhan" }),
      { duyetKeHoach: mc.duyetKeHoach },
    );
    const kq = await driverHost(dep)(dauVao(ra));
    expect(kq.loiCongCu).toEqual({ "DUYET_KE_HOACH_LOI:BAM_KHONG_KHOP": 1 });
    expect(kq.ghiChu.join(" ")).toMatch(/kế hoạch duyet .*ok=false note=BAM_KHONG_KHOP/);
  });
  it("★ hai kế hoạch (băm khác nhau): MỖI cái có hồ sơ + quyết định riêng; thẻ ghi xen giữa vẫn đi đường confirmAction", async () => {
    const mc = mayChu(BAM);
    const ids: string[] = [];
    const { dep, dd } = taoDep(
      async (phat) => {
        phat(keHoach());
        await new Promise((r) => setTimeout(r, 80));
        phat(canDuyet("apply_diff", { path: "client/src/lib/a.test.ts" }, "act-7"));
        await new Promise((r) => setTimeout(r, 80));
        phat(keHoach("bam-moi-0000000000"));
        await new Promise((r) => setTimeout(r, 150));
        phat({ loai: "xong", lyDo: "hoan-thanh" });
      },
      async (h) => (ids.push(h.id), { quyet: "chap-nhan" }),
      { duyetKeHoach: mc.duyetKeHoach },
    );
    const kq = await driverHost(dep)(dauVao(ra));
    expect(ids).toEqual([idKeHoach(BAM), "act-7", idKeHoach("bam-moi-0000000000")]);
    expect(mc.goi.map((g) => g.bam)).toEqual([BAM, "bam-moi-0000000000"]);
    expect(dd.duyet).toEqual(["act-7"]);
    expect(kq.keHoach).toMatchObject({ soLanCho: 2, soChapNhan: 2 });
  });
  it("★ quyết định của kế hoạch CŨ không duyệt kế hoạch MỚI (id kh-<băm> khác ⇒ duyetQuaTep bỏ qua ⇒ het-gio)", async () => {
    const h = (bam: string) => ({ ma: "TC-97", id: idKeHoach(bam), ten: "ke_hoach", duong: [], moTa: null, lyDoModel: null, xemTruoc: null, thamSo: {}, nguonDangNgo: [], luc: new Date().toISOString() });
    fs.mkdirSync(ra, { recursive: true });
    fs.writeFileSync(path.join(ra, "TC-97.quyet.json"), JSON.stringify({ id: idKeHoach("bam-cu"), quyet: "chap-nhan" }));
    const p = duyetQuaTep(h("bam-moi"), { ra, hanMs: 700 });
    // duyetQuaTep xoá quyết định cũ lúc bắt đầu; ghi lại một quyết định mang id CŨ trong lúc chờ
    await new Promise((r) => setTimeout(r, 150));
    fs.writeFileSync(path.join(ra, "TC-97.quyet.json"), JSON.stringify({ id: idKeHoach("bam-cu"), quyet: "chap-nhan" }));
    expect((await p).quyet).toBe("het-gio");
  });
  it("hanKeHoachHieuLucMs: trần chờ kế hoạch 15 phút (KHÁC TTL thẻ 5 phút)", () => {
    expect(hanKeHoachHieuLucMs(600)).toBe(600_000);
    expect(hanKeHoachHieuLucMs(5000)).toBe(15 * 60_000 - 15_000);
    expect(hanDuyetHieuLucMs(600)).toBe(300_000 - 15_000); // thẻ ghi vẫn 5 phút
  });
});

describe("phuThuocHostThat — nối THẬT của cổng kế hoạch (đọc nguồn: hàm này cần DB nên không chạy ở đây)", () => {
  const nguon = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "driverHost.ts"), "utf8");
  const than = (() => {
    const i = nguon.indexOf("async duyetKeHoach(runId, bam, quyetDinh) {");
    expect(i, "không tìm thấy duyetKeHoach thật").toBeGreaterThan(0);
    return nguon.slice(i, nguon.indexOf("\n    },", i));
  })();
  it("★ duyệt kế hoạch gọi thuTucDuyetKeHoach với ĐÚNG (runId, bam, quyetDinh) của sự kiện; KHÔNG gọi thuTucDuyet / thuTucBac (thẻ ghi)", () => {
    expect(than).toContain("tk.thuTucDuyetKeHoach(c.nguoi, { runId, bam, quyetDinh })");
    expect(than).not.toMatch(/thuTucDuyet\(|thuTucBac\(|tt\./);
  });
  it("★ thủ tục kế hoạch nạp từ thuTucKeHoach (không phải thuTucLuotChay)", () => {
    expect(nguon).toContain('const tk = await import("../../server/services/ai/agent/thuTucKeHoach");');
  });
});

describe("driverHost — trần lượt do thẻ (HA-3): chuyển gioiHan tới taoLuot", () => {
  it("★★★ DauVaoDriver.gioiHanLuot ⇒ taoLuot nhận đúng gioiHan; vắng ⇒ taoLuot KHÔNG có khoá gioiHan (không đổi byte)", async () => {
    const gom: Array<Record<string, unknown>> = [];
    const mk = () =>
      taoDep(
        async (phat) => {
          phat({ loai: "xong", lyDo: "hoan-thanh" });
        },
        async () => ({ quyet: "chap-nhan" }),
        {
          taoLuot: async (y) => {
            gom.push(y as Record<string, unknown>);
            return { ok: false, loi: "dừng ngay" };
          },
        },
      ).dep;
    await driverHost(mk())({ ...dauVao(ra), gioiHanLuot: { soLuotToiDa: 20, msToiDa: 600_000 } });
    await driverHost(mk())(dauVao(ra));
    expect(gom[0]).toMatchObject({ gioiHan: { soLuotToiDa: 20, msToiDa: 600_000 } });
    expect("gioiHan" in gom[1]).toBe(false);
  });
});
