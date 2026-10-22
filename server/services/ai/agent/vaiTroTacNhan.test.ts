/**
 * ★ Đợt 9 — tác nhân theo VAI TRÒ (thiết kế 2026-10-22 §2–3, lưới i–iii ở mức hàm thuần; lưới iv + đầu–cuối ở
 * `quanLyLuotChay.vaiTro.test.ts`).
 */
import { describe, it, expect, vi } from "vitest";
import type { GoiModel, ManhModel } from "@shared/agentCore";
import { VAI_TRO_GOC } from "../../../../shared/aiRoles";
import { LicenseGateError, QuotaExceededError, RateLimitError, SafetyBlockedError, type GatewayPlan } from "../../aiGateway";
import type { AnhSoModel, GanTrongAnh } from "../soModel/anhSoModel";
import {
  UOC_LUONG_TOKEN_LUOT_CHAY_MAC_DINH,
  boDemLuotModel,
  chonVaiTroTacNhan,
  chuanBiLuotChayTheoVaiTro,
  tacNhanTheoVaiTroBat,
  uocLuongTokenLuotChay,
  type PhuThuocVaiTro,
} from "./vaiTroTacNhan";

const M35 = "Qwen3.6-35B-A3B-UD-Q4_K_XL";
const M27 = "Qwen3.6-27B-UD-Q4_K_XL";
const ENV = { GGUF_CODE_MODEL: `${M35}.gguf`, GGUF_DEFAULT_MODEL: `${M35}.gguf`, LLAMA_SERVER_MODEL: `${M35}.gguf` } as NodeJS.ProcessEnv;

const P = (artifactFile: string) => ({ artifactFile, slotClass: "nang" as const, artifactStatus: "available", license: "apache-2.0", enabled: true });
const G = (g: Partial<GanTrongAnh>): GanTrongAnh => ({
  roleId: "code.plc", scopeKind: "global", scopeId: null, profileId: null, envKey: null, fallback: [], mode: "active", ...g,
});
function anh(gan: GanTrongAnh[]): AnhSoModel {
  return {
    taiLuc: 1,
    vaiTro: new Map(VAI_TRO_GOC.map((v) => [v.id, { envKey: v.envKey, taskKind: v.taskKind }])),
    profile: new Map([
      ["p27", P(`${M27}.gguf`)],
      ["p35", P(`${M35}.gguf`)],
    ]),
    gan,
  };
}
/** Như sổ dev 2026-10-22: code.plc → 27B (dự phòng 35B); code.software theo env. */
const ANH_DEV = anh([G({ profileId: "p27", fallback: ["p35"] }), G({ roleId: "code.software", envKey: "GGUF_CODE_MODEL" })]);

const planGia = (): GatewayPlan =>
  ({ decision: {}, abVariant: null, record: vi.fn(), recordPhu: vi.fn(), safeText: "", safetyFlags: {}, sanitizeOutput: (t: string) => t }) as never;

function phu(o: Partial<PhuThuocVaiTro> = {}): PhuThuocVaiTro & { planInference: ReturnType<typeof vi.fn> } {
  return {
    planInference: vi.fn(async () => planGia()),
    layAnh: () => ANH_DEV,
    nguCanhKhe: () => ({ kheBiKhoa: false, kheDangGiu: M35 }),
    laDuAnPlc: () => false,
    env: ENV,
    ...o,
  } as never;
}
const Y = { cauHoi: "thêm hàm tính tổng", gocDuAn: "/x", projectId: "duan", user: { id: 7, role: "engineer" } };

describe("cờ + ước lượng", () => {
  it("★★★ cờ: VẮNG ⇒ BẬT (mặc định, dieu-phoi 2026-10-23); false/off/0/no ⇒ TẮT; 1/true/on ⇒ bật", () => {
    expect(tacNhanTheoVaiTroBat({})).toBe(true);
    expect(tacNhanTheoVaiTroBat({ AI_AGENT_THEO_VAI_TRO: "" })).toBe(true);
    for (const v of ["false", "OFF", "0", "no", " false "]) expect(tacNhanTheoVaiTroBat({ AI_AGENT_THEO_VAI_TRO: v })).toBe(false);
    for (const v of ["1", "true", "ON"]) expect(tacNhanTheoVaiTroBat({ AI_AGENT_THEO_VAI_TRO: v })).toBe(true);
  });
  it("ước lượng token lượt chạy = 64k (trung vị đo ~31k × 2), env ghi đè, rác ⇒ mặc định", () => {
    expect(UOC_LUONG_TOKEN_LUOT_CHAY_MAC_DINH).toBe(64_000);
    expect(uocLuongTokenLuotChay({})).toBe(64_000);
    expect(uocLuongTokenLuotChay({ AI_AGENT_UOC_LUONG_TOKEN: "20000" })).toBe(20_000);
    expect(uocLuongTokenLuotChay({ AI_AGENT_UOC_LUONG_TOKEN: "-5" })).toBe(64_000);
  });
});

describe("(i) chọn vai trò", () => {
  it("dự án PLC ⇒ code.plc; câu hỏi viết mã PLC ⇒ code.plc; còn lại ⇒ code.software", () => {
    expect(chonVaiTroTacNhan({ laDuAnPlc: true, cauHoi: "thêm hàm" }).vaiTro).toBe("code.plc");
    expect(chonVaiTroTacNhan({ laDuAnPlc: false, cauHoi: "viết FB TON trễ 5 s cho PLC" }).vaiTro).toBe("code.plc");
    expect(chonVaiTroTacNhan({ laDuAnPlc: false, cauHoi: "sửa endpoint express trả 404" }).vaiTro).toBe("code.software");
    expect(chonVaiTroTacNhan({ laDuAnPlc: false, cauHoi: "IEC 61131-3 gồm những ngôn ngữ lập trình nào?" }).vaiTro).toBe("code.software");
  });

  it("dự án PLC ⇒ model 27B (gán code.plc); dự án TS ⇒ 35B (env) — thông tin cho bat-dau", async () => {
    const plc = await chuanBiLuotChayTheoVaiTro(Y, phu({ laDuAnPlc: () => true }));
    expect(plc).toMatchObject({ ok: true, modelId: M27, thongTin: { vaiTro: "code.plc", model: M27, nguon: "gan-profile" } });
    if (plc.ok) expect(plc.thongTin.bangChung).toContain("dự án PLC");
    const ts = await chuanBiLuotChayTheoVaiTro(Y, phu());
    expect(ts).toMatchObject({ ok: true, modelId: M35, thongTin: { vaiTro: "code.software", model: M35, nguon: "gan-env" } });
  });

  it("gán theo DỰ ÁN thắng global (đi đúng dinhTuyenVaiTro)", async () => {
    const a = anh([G({ profileId: "p27" }), G({ roleId: "code.software", scopeKind: "project", scopeId: "duan", profileId: "p27" })]);
    const kq = await chuanBiLuotChayTheoVaiTro(Y, phu({ layAnh: () => a, nguCanhKhe: () => ({ kheBiKhoa: false, kheDangGiu: M27 }) }));
    expect(kq).toMatchObject({ ok: true, modelId: M27, thongTin: { vaiTro: "code.software", nguon: "gan-profile" } });
  });
});

describe("(ii) khoá khe giữ model khác", () => {
  it("★★★ khoá giữ 27B + tác nhân code.software (env 35B, KHÔNG dự phòng) ⇒ từ chối NÓI THẬT, không gọi planInference", async () => {
    const p = phu({ nguCanhKhe: () => ({ kheBiKhoa: true, kheDangGiu: M27 }) });
    const kq = await chuanBiLuotChayTheoVaiTro(Y, p);
    expect(kq).toMatchObject({ ok: false, ma: "AI_KHONG_CO_MODEL" });
    if (!kq.ok) expect(kq.thongDiep).toMatch(/bị khoá.*Qwen3\.6-27B.*code\.software.*Qwen3\.6-35B/s);
    expect(p.planInference).not.toHaveBeenCalled();
  });

  it("★★★ chỉnh 2: khai dự phòng code.software → hồ sơ khe đang giữ (27B) ⇒ CHẠY trên 27B (du-phong), không từ chối", async () => {
    const a = anh([G({ roleId: "code.software", profileId: "p35", fallback: ["p27"] })]);
    const kq = await chuanBiLuotChayTheoVaiTro(Y, phu({ layAnh: () => a, nguCanhKhe: () => ({ kheBiKhoa: true, kheDangGiu: M27 }) }));
    expect(kq).toMatchObject({ ok: true, modelId: M27, thongTin: { model: M27, nguon: "du-phong" } });
  });

  it("★★★ (2026-10-23, đo trên :3013) làm mới khe TRƯỚC khi đọc: khe vừa đổi NGOÀI tiến trình 35B→27B + khoá ⇒ 27B du-phong, không từ chối oan", async () => {
    const a = anh([G({ roleId: "code.software", profileId: "p35", fallback: ["p27"] })]);
    let dangGiu = M35; // giá trị CŨ trong bộ lập lịch
    const thuTu: string[] = [];
    const kq = await chuanBiLuotChayTheoVaiTro(
      Y,
      phu({
        layAnh: () => a,
        lamMoiKhe: async () => {
          thuTu.push("lam-moi");
          dangGiu = M27; // /props thật nói 27B
        },
        nguCanhKhe: () => {
          thuTu.push("doc");
          return { kheBiKhoa: true, kheDangGiu: dangGiu };
        },
      }),
    );
    expect(thuTu).toEqual(["lam-moi", "doc"]);
    expect(kq).toMatchObject({ ok: true, modelId: M27, thongTin: { nguon: "du-phong" } });
  });

  it("khoá giữ 27B + dự án PLC (code.plc → 27B) ⇒ chạy, không đổi khe", async () => {
    const kq = await chuanBiLuotChayTheoVaiTro(Y, phu({ laDuAnPlc: () => true, nguCanhKhe: () => ({ kheBiKhoa: true, kheDangGiu: M27 }) }));
    expect(kq).toMatchObject({ ok: true, modelId: M27 });
  });

  it("KHÔNG khoá: code.plc → 27B trong khi khe giữ 35B ⇒ chạy (đổi khe theo chính sách, không phải việc của tác nhân)", async () => {
    const kq = await chuanBiLuotChayTheoVaiTro(Y, phu({ laDuAnPlc: () => true }));
    expect(kq).toMatchObject({ ok: true, modelId: M27 });
  });
});

describe("(iii) gating aiGateway — MỘT planInference, đổi lỗi ra mã", () => {
  it("planInference nhận task code + câu hỏi + người + ước lượng token", async () => {
    const p = phu();
    await chuanBiLuotChayTheoVaiTro(Y, p);
    expect(p.planInference).toHaveBeenCalledTimes(1);
    expect(p.planInference.mock.calls[0]![0]).toMatchObject({
      task: "code",
      text: Y.cauHoi,
      userId: 7,
      role: "engineer",
      auditTask: "agent_run",
      uocLuongToken: 64_000,
    });
  });

  it.each([
    [new RateLimitError("rl", 1000, 2), "AI_GIOI_HAN_TAN_SUAT"],
    [new QuotaExceededError("q", 10, 5), "AI_HET_HAN_MUC"],
    [new SafetyBlockedError("s", ["x"]), "AI_CHAN_AN_TOAN"],
    [new LicenseGateError("l"), "AI_CHUA_CAP_PHEP"],
  ])("%s ⇒ %s", async (loi, ma) => {
    const kq = await chuanBiLuotChayTheoVaiTro(Y, phu({ planInference: vi.fn(async () => Promise.reject(loi)) }));
    expect(kq).toMatchObject({ ok: false, ma });
  });

  it("lỗi lạ (lập trình) ⇒ NÉM tiếp, không nuốt thành mã", async () => {
    await expect(chuanBiLuotChayTheoVaiTro(Y, phu({ planInference: vi.fn(async () => Promise.reject(new TypeError("x"))) }))).rejects.toThrow(TypeError);
  });
});

describe("boDemLuotModel", () => {
  it("báo MỖI lượt có `xong` (usage + ms), chuyển nguyên mảnh; lượt ném ⇒ không báo; bộ báo ném ⇒ lượt vẫn chạy", async () => {
    let t = 0;
    const goc: GoiModel = async function* (): AsyncGenerator<ManhModel> {
      t += 100;
      yield { loai: "chu", noiDung: "a" };
      t += 250;
      yield { loai: "xong", toolCalls: [], usage: { vao: 10, ra: 3, nghi: 1 } };
    };
    const bao: unknown[] = [];
    const g = boDemLuotModel(goc, (l) => bao.push(l), () => t);
    const vao = { tinNhan: [], congCu: [], signal: new AbortController().signal };
    const manh: ManhModel[] = [];
    for await (const m of g(vao)) manh.push(m);
    expect(manh.map((m) => m.loai)).toEqual(["chu", "xong"]);
    expect(bao).toEqual([{ vao: 10, ra: 3, nghi: 1, ms: 350 }]);

    const hong: GoiModel = async function* (): AsyncGenerator<ManhModel> {
      yield { loai: "chu", noiDung: "a" };
      throw new Error("đứt");
    };
    await expect((async () => { for await (const _ of boDemLuotModel(hong, (l) => bao.push(l))(vao)) void _; })()).rejects.toThrow("đứt");
    expect(bao).toHaveLength(1);

    const ra: ManhModel[] = [];
    for await (const m of boDemLuotModel(goc, () => { throw new Error("bộ báo hỏng"); })(vao)) ra.push(m);
    expect(ra).toHaveLength(2);
  });
});
