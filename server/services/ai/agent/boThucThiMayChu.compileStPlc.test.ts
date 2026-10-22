/**
 * ★ Đợt 9 (2026-10-22, dieu-phoi — ablation tác nhân 36 lượt đạt cổng đăng ký trước) — `compile_st` BẬT MẶC ĐỊNH cho tác nhân
 * CHỈ ở dự án PLC (`AI_KIEM_BIEN_DICH_ST` không đặt ⇒ `agent-plc`), + trần `AI_COMPILE_ST_TRAN_MOI_LUOT` (mặc định 6) mỗi lượt chạy.
 *
 * ĐỘT BIẾN PHẢI BẮT: dự án KHÔNG PLC cũng lộ tool / đổi lời nhắc · `.xml` thường bị coi là PLC · đặt rõ `off` mà vẫn bật ·
 * mặc định bật cả /v1 · trần không áp / trần ném · thư mục tmp/node_modules làm dự án thành PLC.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { congCuTheoCheDo, dungLoiNhacHeThong } from "@shared/agentCore";
import { taoBoThucThiMayChu, toolTuyChonBat, tranCompileStMoiLuot } from "./boThucThiMayChu";
import { NS_PLCOPEN_TC6, _xoaNhoDuAnPlc, quetDuAnPlc } from "./nhanDienDuAnPlc";
import { cheDoCompileStTacNhan, kiemBienDichBat } from "../st/kiemBienDichSt";

const goc: Record<string, string> = {};
function duAn(ten: string, tep: Record<string, string>): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `plc-${ten}-`));
  for (const [rel, nd] of Object.entries(tep)) {
    fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true });
    fs.writeFileSync(path.join(d, rel), nd);
  }
  return d;
}
beforeAll(() => {
  goc.st = duAn("st", { "src/Motor.st": "FUNCTION_BLOCK Motor END_FUNCTION_BLOCK" });
  goc.scl = duAn("scl", { "Main.scl": 'FUNCTION_BLOCK "M" BEGIN END_FUNCTION_BLOCK' });
  goc.xmlPlc = duAn("xmlplc", { "proj/plc.xml": `<?xml version="1.0"?><project xmlns="${NS_PLCOPEN_TC6}0201"></project>` });
  goc.xmlThuong = duAn("xml", { "pom.xml": '<?xml version="1.0"?><project xmlns="http://maven.apache.org/POM/4.0.0"/>', "src/a.ts": "x" });
  goc.ts = duAn("ts", { "src/index.ts": "export const a = 1;", "package.json": "{}" });
  goc.sau = duAn("sau", { "a/b/c/deep.st": "x" }); // tầng 3 ⇒ KHÔNG tính
  goc.tmp = duAn("tmp", { "tmp/x.st": "x", "node_modules/p/y.st": "x", "src/a.ts": "x" });
});
afterAll(() => {
  for (const d of Object.values(goc)) fs.rmSync(d, { recursive: true, force: true });
});
afterEach(() => {
  vi.unstubAllEnvs();
  _xoaNhoDuAnPlc();
});

describe("nhận diện dự án PLC (cây 2 tầng)", () => {
  it(".st / .scl / PLCopen tc6 ⇒ PLC; xml thường, TS, tầng 3, tmp/node_modules ⇒ KHÔNG", () => {
    expect(quetDuAnPlc(goc.st)).toBe(true);
    expect(quetDuAnPlc(goc.scl)).toBe(true);
    expect(quetDuAnPlc(goc.xmlPlc)).toBe(true);
    expect(quetDuAnPlc(goc.xmlThuong)).toBe(false);
    expect(quetDuAnPlc(goc.ts)).toBe(false);
    expect(quetDuAnPlc(goc.sau)).toBe(false);
    expect(quetDuAnPlc(goc.tmp)).toBe(false);
    expect(quetDuAnPlc(path.join(os.tmpdir(), "khong-ton-tai-plc-xyz"))).toBe(false);
  });
});

describe("cờ: mặc định agent-plc; đặt rõ ⇒ theo env", () => {
  it("biến KHÔNG đặt ⇒ plc; /v1, tro-ly, cmdk vẫn TẮT", () => {
    expect(cheDoCompileStTacNhan({})).toBe("plc");
    for (const b of ["v1", "tro-ly", "cmdk"] as const) expect(kiemBienDichBat(b, {})).toBe(false);
  });
  it("đặt rõ: off ⇒ tắt · v1 ⇒ tắt cho tác nhân · agent/all ⇒ mọi dự án · agent-plc ⇒ plc", () => {
    expect(cheDoCompileStTacNhan({ AI_KIEM_BIEN_DICH_ST: "off" })).toBe("tat");
    expect(cheDoCompileStTacNhan({ AI_KIEM_BIEN_DICH_ST: "v1" })).toBe("tat");
    expect(cheDoCompileStTacNhan({ AI_KIEM_BIEN_DICH_ST: "agent" })).toBe("moi-du-an");
    expect(cheDoCompileStTacNhan({ AI_KIEM_BIEN_DICH_ST: "v1,all" })).toBe("moi-du-an");
    expect(cheDoCompileStTacNhan({ AI_KIEM_BIEN_DICH_ST: "v1, agent-plc" })).toBe("plc");
  });
  it("toolTuyChonBat theo (env, gốc)", () => {
    expect(toolTuyChonBat("compile_st", {}, goc.st)).toBe(true);
    expect(toolTuyChonBat("compile_st", {}, goc.ts)).toBe(false);
    expect(toolTuyChonBat("compile_st", {}, undefined)).toBe(false);
    expect(toolTuyChonBat("compile_st", { AI_KIEM_BIEN_DICH_ST: "off" }, goc.st)).toBe(false);
    expect(toolTuyChonBat("compile_st", { AI_KIEM_BIEN_DICH_ST: "agent" }, goc.ts)).toBe(true);
  });
});

function taoBo(g: string) {
  const nguoi = { id: 1, role: "engineer", name: "Ky su" };
  const goi: unknown[] = [];
  const bo = taoBoThucThiMayChu({
    execCtx: { user: nguoi, lang: "vi", projectRoot: g },
    gocDuAn: g,
    user: nguoi,
    coQuyenThucThi: false,
    checkpoint: null,
    phuThuoc: {
      chiMucMa: null,
      executeDecision: (async (d: unknown) => (goi.push(d), { result: { type: "action_result", title: "t", data: { ok: true, phuongNgu: "st", soLoi: 0, chanDoan: [] }, textSummary: "ok" } })) as never,
      kiemKillSwitch: async () => false,
    },
  });
  return { bo, goi };
}
const ten = (ds: { function: { name: string } }[]) => ds.map((t) => t.function.name);
const ctx = () => ({ cheDo: "sua" as const, runId: "r", luot: 1, signal: new AbortController().signal, phat: () => undefined });

describe("bộ thực thi: lộ tool + lời nhắc theo dự án (biến KHÔNG đặt)", () => {
  it("★ dự án PLC ⇒ có compile_st; dự án TS ⇒ KHÔNG, và lời nhắc GIỐNG TỪNG BYTE bản không có tool tuỳ chọn", () => {
    vi.stubEnv("AI_KIEM_BIEN_DICH_ST", undefined as never);
    delete process.env.AI_KIEM_BIEN_DICH_ST;
    expect(ten(taoBo(goc.st).bo.congCu("sua"))).toContain("compile_st");
    const tsCongCu = ten(taoBo(goc.ts).bo.congCu("sua"));
    expect(tsCongCu).not.toContain("compile_st");
    expect(tsCongCu).toEqual(ten(congCuTheoCheDo("sua")));
    expect(dungLoiNhacHeThong({ cheDo: "sua", ngonNgu: "vi", congCu: tsCongCu })).toBe(dungLoiNhacHeThong({ cheDo: "sua", ngonNgu: "vi" }));
  });
  it("dự án TS gọi bừa compile_st ⇒ CONG_CU_BI_AN, không chạm tool", async () => {
    delete process.env.AI_KIEM_BIEN_DICH_ST;
    const { bo, goi } = taoBo(goc.ts);
    const kq = await bo.chay({ id: "x", ten: "compile_st", thamSo: { path: "src/index.ts" } }, ctx());
    expect(kq.ma).toBe("CONG_CU_BI_AN");
    expect(goi).toEqual([]);
  });
});

describe("trần compile_st mỗi lượt chạy", () => {
  it("mặc định 6, ghi đè được, rác ⇒ 6", () => {
    expect(tranCompileStMoiLuot({})).toBe(6);
    expect(tranCompileStMoiLuot({ AI_COMPILE_ST_TRAN_MOI_LUOT: "3" })).toBe(3);
    expect(tranCompileStMoiLuot({ AI_COMPILE_ST_TRAN_MOI_LUOT: "x" })).toBe(6);
  });
  it("★ lần thứ N+1 ⇒ ok:false CHAM_TRAN_COMPILE_ST (KHÔNG ném, không chạm tool), câu bảo dừng sửa + báo người dùng", async () => {
    delete process.env.AI_KIEM_BIEN_DICH_ST;
    vi.stubEnv("AI_COMPILE_ST_TRAN_MOI_LUOT", "2");
    const { bo, goi } = taoBo(goc.st);
    for (let i = 0; i < 2; i++) expect((await bo.chay({ id: `c${i}`, ten: "compile_st", thamSo: { path: "src/Motor.st" } }, ctx())).ok).toBe(true);
    const kq = await bo.chay({ id: "c3", ten: "compile_st", thamSo: { path: "src/Motor.st" } }, ctx());
    expect(kq).toMatchObject({ ok: false, ma: "CHAM_TRAN_COMPILE_ST" });
    expect(kq.choModel).toMatch(/Compile limit reached \(2 compiles/);
    expect(kq.choModel).toMatch(/tell the user/);
    expect(kq.dangNgo).toBeUndefined();
    expect(goi).toHaveLength(2);
  });
});
