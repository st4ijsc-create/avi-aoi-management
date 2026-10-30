/**
 * ★ Đợt 10.4b L2 — màn lập trình chế độ HỎI với model NGOÀI (`codingNgoai.ts`): lỗi trước SSE, CHỈ HỎI, mức lượt đầu ky-thuat / lượt 2+
 * van-hanh (428), vòng tool ĐỌC qua deny-list (đường ĐÃ GIẢI) + trần, SSE + vết cộng dồn + ngoaiCallIds. Phụ thuộc giả, không mạng.
 */
import { describe, expect, it } from "vitest";
import { chayToolDocNgoai, xuLyCodingNgoai, TOOL_DOC_NGOAI, TRAN_VONG_HOI_NGOAI, TRAN_TOOL_MOI_VONG, type PhuThuocCodingNgoai, type TrongThaiDoc } from "./codingNgoai";
import { LoiNgoai } from "../services/ai/ngoai/loi";
import { mucCuaGhep } from "../services/ai/ngoai/ghepPhan";
import type { YeuCauGoiNgoai, KetQuaGoiNgoai } from "../services/ai/ngoai/congNgoai";

function resGia() {
  const r = {
    code: 0,
    body: null as unknown,
    chunks: [] as string[],
    ended: false,
    status(c: number) {
      r.code = c;
      return r;
    },
    json(b: unknown) {
      r.body = b;
      r.ended = true;
      return r;
    },
    setHeader() {},
    flushHeaders() {},
    write(s: string) {
      r.chunks.push(s);
      return true;
    },
    end() {
      r.ended = true;
    },
    on() {
      return r;
    },
  };
  return r;
}
const suKien = (r: ReturnType<typeof resGia>) => r.chunks.filter((c) => c.startsWith("data: ")).map((c) => JSON.parse(c.slice(6)) as Record<string, unknown>);
const PHIEN = "11111111-2222-4333-8444-555555555555";
const kq = (o: Partial<KetQuaGoiNgoai> = {}): KetQuaGoiNgoai => ({ noiDung: "", toolCalls: [], khongTinCay: true, tokenVao: 100, tokenRa: 20, chiPhiUocUsd: 0.001, callId: 1, ...o });

function dep(o: Partial<PhuThuocCodingNgoai> & { traVe?: KetQuaGoiNgoai[] } = {}) {
  const goi: YeuCauGoiNgoai[] = [];
  const tool: Array<{ ten: string; thamSo: unknown }> = [];
  const co: string[] = [];
  const traVe = o.traVe ?? [kq({ noiDung: "Trả lời cuối", callId: 1 })];
  const d: PhuThuocCodingNgoai = {
    beMatMo: async () => ["luong", "kiem-dinh", "chat", "coding"],
    nhaMayCua: async () => [5],
    coTrongDanhMuc: async () => ({ nhaCungCap: "anthropic", model: "claude-x" }),
    gocDuAn: (p) => (p === "repo" ? "/w/repo" : null),
    laYDinhGhi: () => false,
    phienCuaToi: async (p) => p === PHIEN,
    datCoPhien: async (p) => void co.push(p),
    kiemTruoc: async () => ({ cfg: { tranByteDocLuot: 262_144, tranTepDocLuot: 50 } }) as never,
    goi: async (yc) => {
      goi.push(yc);
      return traVe[Math.min(goi.length - 1, traVe.length - 1)]!;
    },
    chayTool: async (ten, thamSo) => {
      tool.push({ ten, thamSo });
      return { ok: true, path: String((thamSo as { path?: string }).path ?? "."), noiDung: `<<<TEP ${String((thamSo as { path?: string }).path)}\nnội dung\n>>>` };
    },
    nhipSongMs: 5,
    ...o,
  };
  return { d, goi, tool, co };
}
const A = (context: Record<string, unknown> = {}, history: Array<{ role: "user" | "assistant"; content: string }> = []) => ({
  user: { id: 7, role: "user" },
  question: "Hàm tinhOee được gọi ở đâu?",
  history,
  chonModel: "ngoai:anthropic:claude-x",
  context: { codingMode: true, projectId: "repo", ...context },
});
const chay = async (a = A(), o: Parameters<typeof dep>[0] = {}, body: Record<string, unknown> = {}) => {
  const x = dep(o);
  const r = resGia();
  await xuLyCodingNgoai({ body } as never, r as never, a, x.d);
  return { r, ...x };
};
const LICH_SU = [
  { role: "user" as const, content: "câu trước" },
  { role: "assistant" as const, content: "trả lời trước" },
];

describe("L2 — lỗi TRƯỚC SSE", () => {
  it("bề mặt coding chưa mở ⇒ 404 modelNgoaiChuaCaiDat; ảnh ⇒ 400 NGOAI_CAM_DINH_KEM", async () => {
    expect((await chay(A(), { beMatMo: async () => ["chat"] })).r).toMatchObject({ code: 404, body: { code: "modelNgoaiChuaCaiDat" } });
    expect((await chay(A(), {}, { image: "data:x" })).r).toMatchObject({ code: 400, body: { code: "NGOAI_CAM_DINH_KEM" } });
  });
  it("★ CHỈ HỎI: tệp ghim sửa / đầu ra máy / câu có ý định GHI ⇒ 400 NGOAI_CHI_HOI, không gọi", async () => {
    for (const [ctx, o] of [
      [{ codingEditPath: "src/a.ts" }, {}],
      [{ dauRaKhongTinCay: "FAIL test x: expected 1" }, {}],
      [{}, { laYDinhGhi: () => true }],
    ] as const) {
      const k = await chay(A(ctx), o as never);
      expect(k.r).toMatchObject({ code: 400, body: { success: false, code: "NGOAI_CHI_HOI" } });
      expect(k.goi).toHaveLength(0);
    }
  });
  it("dự án lạ / phienId không phải của mình / phienId sai hình / nhiều nhà máy / ngoài danh mục ⇒ 404 NGOAI_KHONG_TON_TAI", async () => {
    for (const [ctx, o] of [
      [{ projectId: "C:/khac" }, {}],
      [{ phienId: "99999999-2222-4333-8444-555555555555" }, {}],
      [{ phienId: "khong-phai-uuid" }, {}],
      [{}, { nhaMayCua: async () => [5, 6] }],
      [{}, { coTrongDanhMuc: async () => null }],
    ] as const) {
      const k = await chay(A(ctx), o as never);
      expect(k.r, JSON.stringify(ctx)).toMatchObject({ code: 404, body: { code: "NGOAI_KHONG_TON_TAI" } });
      expect(k.goi).toHaveLength(0);
    }
  });
  it("★ mức: lượt ĐẦU (không lịch sử) = ky-thuat ⇒ KHÔNG cần xác nhận; lượt 2+ (có lịch sử) = van-hanh ⇒ 428 khi chưa xác nhận; cổng từ chối ⇒ 403", async () => {
    const dau = await chay(A());
    expect(dau.r.code).toBe(200);
    expect(mucCuaGhep(dau.goi[0]!.tinNhan)).toBe("ky-thuat");
    const sau = await chay(A({}, LICH_SU));
    expect(sau.r).toMatchObject({ code: 428, body: { code: "CAN_XAC_NHAN_VAN_HANH", muc: "van-hanh" } });
    expect(sau.goi).toHaveLength(0);
    const cong = await chay(A({ xacNhanVanHanh: true }, LICH_SU), { kiemTruoc: async () => Promise.reject(new LoiNgoai("NGOAI_DU_LIEU_VAN_HANH")) });
    expect(cong.r).toMatchObject({ code: 403, body: { code: "NGOAI_DU_LIEU_VAN_HANH" } });
  });
});

describe("L2 — vòng tool + SSE", () => {
  it("vòng 1 đòi read_file ⇒ máy chủ chạy tool ⇒ vòng 2 trả lời: sự kiện meta → tool_loop → tool → tool_loop → … → token → done{vet CỘNG DỒN, ngoaiCallIds}", async () => {
    const k = await chay(A({ phienId: PHIEN, xacNhanVanHanh: true }, LICH_SU), {
      traVe: [kq({ noiDung: "để xem tệp", toolCalls: [{ ten: "read_file", thamSo: { path: "src/oee.ts" } }], callId: 11 }), kq({ noiDung: "Gọi ở src/a.ts:12", callId: 12 })],
    });
    expect(k.co).toEqual([PHIEN]);
    const ev = suKien(k.r);
    expect(ev.map((e) => e.type)).toEqual(["meta", "tool_loop", "tool", "tool_loop", "tool_loop", "token", "done"]);
    expect(ev[2]).toMatchObject({ type: "tool", name: "read_file", ok: true, path: "src/oee.ts" });
    expect(ev.at(-1)).toMatchObject({ answer: "Gọi ở src/a.ts:12", vet: { tokenVao: 200, tokenRa: 40, chiPhiUocUsd: 0.002, callId: 12 }, ngoaiCallIds: [11, 12] });
    // MỖI vòng: yêu cầu dựng qua bộ dựng; vòng 2 mang kết quả tool; CÙNG runId; chỉ 3 tool ĐỌC được cấp; mức MAX = van-hanh (lịch sử)
    expect(k.goi).toHaveLength(2);
    for (const yc of k.goi) {
      expect(mucCuaGhep(yc.tinNhan)).toBe("van-hanh");
      expect(yc.congCu!.map((c) => c.ten)).toEqual(["read_file", "list_files", "grep_repo"]);
    }
    expect(k.goi[0]!.ngu.runId).toBeTruthy();
    expect(k.goi[1]!.ngu.runId).toBe(k.goi[0]!.ngu.runId);
    expect(JSON.stringify(k.goi[1]!.tinNhan)).toContain("<<<TEP src/oee.ts");
    expect(TOOL_DOC_NGOAI.map((t) => t.ten)).not.toContain("run_command");
  });
  it("trần CỨNG số vòng: model đòi tool mãi ⇒ đúng TRAN_VONG_HOI_NGOAI lời gọi, dừng 'tran-vong', vẫn có done", async () => {
    const k = await chay(A(), { traVe: [kq({ toolCalls: [{ ten: "list_files", thamSo: {} }] })] });
    expect(k.goi).toHaveLength(TRAN_VONG_HOI_NGOAI);
    const ev = suKien(k.r);
    expect(ev.some((e) => e.type === "tool_loop" && e.stop === "tran-vong")).toBe(true);
    expect(ev.at(-1)!.type).toBe("done");
  });
  it(`mỗi vòng tối đa ${TRAN_TOOL_MOI_VONG} tool (phần dư bỏ, có khai cho model)`, async () => {
    const nhieu = Array.from({ length: 7 }, (_, i) => ({ ten: "read_file", thamSo: { path: `f${i}.ts` } }));
    const k = await chay(A(), { traVe: [kq({ toolCalls: nhieu }), kq({ noiDung: "xong" })] });
    expect(k.tool).toHaveLength(TRAN_TOOL_MOI_VONG);
    expect(JSON.stringify(k.goi[1]!.tinNhan)).toContain("3 lời gọi công cụ bị bỏ");
  });
  it("lỗi giữa vòng (cổng: tool ngoài tập / vượt trần run) ⇒ error{code} kèm ngoaiCallIds đã có", async () => {
    let n = 0;
    const k = await chay(A(), {
      goi: async () => {
        n++;
        if (n === 1) return kq({ toolCalls: [{ ten: "grep_repo", thamSo: { pattern: "x" } }], callId: 21 });
        throw new LoiNgoai("NGOAI_TOOL_KHONG_CAP");
      },
    });
    expect(suKien(k.r).at(-1)).toMatchObject({ type: "error", code: "NGOAI_TOOL_KHONG_CAP", ngoaiCallIds: [21] });
  });
});

describe("chayToolDocNgoai — deny-list (đường ĐÃ GIẢI) + hộp cát + trần", () => {
  const GOC = "/w/repo";
  const fs = (bang: Record<string, string>) => async (p: string) => {
    if (p in bang) return bang[p]!;
    if (p === GOC) return GOC;
    throw new Error("ENOENT");
  };
  const doc = (o: Partial<TrongThaiDoc> = {}): TrongThaiDoc => ({ byte: 0, tep: 0, tranByte: 10_000, tranTep: 5, ...o });
  it("read_file: .env ⇒ DENIED_SECRET (hộp cát KHÔNG được gọi); symlink tới .env ⇒ DENIED_SECRET; tệp thường ⇒ đọc ĐÚNG đường đã giải", async () => {
    const goiHopCat: unknown[] = [];
    const thucThi = async (tool: string, args: Record<string, unknown>) => {
      goiHopCat.push([tool, args]);
      return { data: { content: "export const x = 1;" } };
    };
    const realpath = fs({ "/w/repo/src/lien-ket.ts": "/w/repo/.env", "/w/repo/src/a.ts": "/w/repo/src/that/a.ts" });
    const o = { goc: GOC, user: { id: 7 }, doc: doc() };
    expect(await chayToolDocNgoai("read_file", { path: ".env" }, o, { realpath, thucThi })).toMatchObject({ ok: false, maTuChoi: "DENIED_SECRET" });
    expect(await chayToolDocNgoai("read_file", { path: "src/lien-ket.ts" }, o, { realpath, thucThi })).toMatchObject({ ok: false, maTuChoi: "DENIED_SECRET" });
    expect(goiHopCat).toHaveLength(0);
    const r = await chayToolDocNgoai("read_file", { path: "src/a.ts" }, o, { realpath, thucThi });
    expect(r).toMatchObject({ ok: true, path: "src/that/a.ts" });
    expect(goiHopCat[0]).toEqual(["read_file", { path: "src/that/a.ts", maxBytes: 65_536 }]);
    expect(o.doc).toMatchObject({ tep: 1 });
  });
  it("trần số tệp / byte mỗi run; nội dung nhị phân ⇒ NHI_PHAN", async () => {
    const realpath = fs({ "/w/repo/a.ts": "/w/repo/a.ts", "/w/repo/b.ts": "/w/repo/b.ts" });
    const thucThi = async () => ({ data: { content: "x".repeat(600) } });
    expect(await chayToolDocNgoai("read_file", { path: "a.ts" }, { goc: GOC, user: { id: 7 }, doc: doc({ tep: 5 }) }, { realpath, thucThi })).toMatchObject({ maTuChoi: "TRAN_SO_TEP" });
    expect(await chayToolDocNgoai("read_file", { path: "a.ts" }, { goc: GOC, user: { id: 7 }, doc: doc({ byte: 9_800 }) }, { realpath, thucThi })).toMatchObject({ maTuChoi: "TRAN_BYTE_DOC" });
    expect(
      await chayToolDocNgoai("read_file", { path: "b.ts" }, { goc: GOC, user: { id: 7 }, doc: doc() }, { realpath, thucThi: async () => ({ data: { content: "MZ\u0000\u0000" } }) }),
    ).toMatchObject({ maTuChoi: "NHI_PHAN" });
  });
  it("grep_repo / list_files: kết quả lọc theo đường THẬT (dòng từ .env / uploads / symlink ra ngoài bị bỏ, có khai số mục ẩn)", async () => {
    const realpath = fs({
      "/w/repo/src/a.ts": "/w/repo/src/a.ts",
      "/w/repo/.env": "/w/repo/.env",
      "/w/repo/src/lk/u.ts": "/w/repo/uploads/u.ts",
      "/w/repo/src": "/w/repo/src",
      "/w/repo/uploads": "/w/repo/uploads",
    });
    const g = await chayToolDocNgoai("grep_repo", { pattern: "pass" }, { goc: GOC, user: { id: 7 }, doc: doc() }, {
      realpath,
      thucThi: async () => ({ data: { matches: [{ path: "src/a.ts", line: 3, text: "passLen" }, { path: ".env", line: 1, text: "DB_PASSWORD=Hunter2" }, { path: "src/lk/u.ts", line: 9, text: "pass" }] } }),
    });
    expect(g.ok).toBe(true);
    expect(g.noiDung).toContain("src/a.ts:3: passLen");
    expect(g.noiDung).not.toMatch(/Hunter2|src\/lk\/u\.ts/);
    expect(g.noiDung).toContain("2 mục bị ẩn");
    const l = await chayToolDocNgoai("list_files", {}, { goc: GOC, user: { id: 7 }, doc: doc() }, {
      realpath,
      thucThi: async () => ({ data: { entries: [{ path: "src", kind: "dir" }, { path: "uploads", kind: "dir" }, { path: "src/a.ts", kind: "file" }, { path: ".env", kind: "file" }] } }),
    });
    expect(l.noiDung).toContain("src/");
    expect(l.noiDung).toContain("src/a.ts");
    expect(l.noiDung).not.toMatch(/uploads|\.env/);
    expect(await chayToolDocNgoai("list_files", { path: "uploads" }, { goc: GOC, user: { id: 7 }, doc: doc() }, { realpath, thucThi: async () => null })).toMatchObject({ ok: false, maTuChoi: "DENIED_DIR" });
    expect(await chayToolDocNgoai("run_command", {}, { goc: GOC, user: { id: 7 }, doc: doc() }, { realpath, thucThi: async () => null })).toMatchObject({ ok: false, maTuChoi: "NGOAI_TOOL_KHONG_CAP" });
  });
});
