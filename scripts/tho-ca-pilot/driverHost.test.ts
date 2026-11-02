import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { driverHost, locTruocKhiCho, duongCuaDeXuat, duyetQuaTep, tepChoDuyet, type PhuThuocHost, type ChinhSachDuyet } from "./driverHost";
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
    expect(loc("run_command", { command: THE.lenhKiem })).toMatchObject({ loai: "cho" });
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
