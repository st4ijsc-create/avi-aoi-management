/**
 * ★ Đợt 12 H4.2 — vòng ĐẦU–CUỐI không GPU: GHI một lượt agent `tu-dong` (engine giả qua `vi.mock`, bộ ghi THẬT `AI_GHI_LUOT_DIR`) ⇒
 * ĐÓNG GÓI (thay đường, kiểm mẫu cấm) ⇒ PHÁT LẠI trên một bản sao dự án ở ĐƯỜNG KHÁC với lõi + công cụ + sổ THẬT.
 * Kỳ vọng: không lệch, rút hết lượt, sự kiện chuẩn hoá trùng, cây tệp trùng. Đổi một tệp dự án trước khi phát ⇒ LỆCH đúng ở lượt đọc nó.
 * ĐỘT BIẾN PHẢI BẮT: so bỏ qua nội dung tin tool · không thay đường gốc · không đếm lượt thừa · đóng gói bỏ qua mẫu cấm.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { eq } from "drizzle-orm";

vi.hoisted(() => {
  process.env.SECRET_ENCRYPTION_KEY ??= "khoa-thu-phat-lai-0123456789"; // checkpoint ký manifest (không phải khoá thật)
});

/** Kịch bản engine lúc GHI: đọc a.ts → ghi b.ts → trả lời. */
const KICH_BAN = [
  { tool: { id: "c1", name: "read_file", arguments: JSON.stringify({ path: "src/a.ts" }) } },
  { tool: { id: "c2", name: "write_file", arguments: JSON.stringify({ path: "src/b.ts", content: "export const nhan = (a: number, b: number) => a * b;\n" }) } },
  { chu: "Đã thêm src/b.ts." },
];
const dem = vi.hoisted(() => ({ k: 0 }));
vi.mock("../services/aiGgufEngine", async (io) => ({
  ...(await io<typeof import("../services/aiGgufEngine")>()),
  chatCompletionStream: async function* () {
    const b = KICH_BAN[Math.min(dem.k++, KICH_BAN.length - 1)]!;
    yield { type: "reasoning", token: "nghĩ một chút" };
    if ("chu" in b) {
      yield { type: "token", token: b.chu };
      yield { type: "done", fullText: b.chu, tokensPrompt: 100, tokensGenerated: 10, cacheN: 90, promptN: 10, toolCalls: [], finishReason: "stop" };
    } else {
      yield { type: "done", fullText: "", tokensPrompt: 100, tokensGenerated: 10, cacheN: 90, promptN: 10, toolCalls: [{ id: b.tool.id, type: "function", function: { name: b.tool.name, arguments: b.tool.arguments } }], finishReason: "tool_calls" };
    }
  },
}));

import { taoQuanLyLuotChay } from "../services/ai/agent/quanLyLuotChay";
import { taoGoiModelMayChu } from "../services/ai/agent/goiModelMayChu";
import { getDb } from "../db/connection";
import { aiAgentRuns } from "../../drizzle/schema";
import { taoNguoiDungTest } from "./nguoiDungTest";
import { chuanHoaSuKien, dongGoi, kiemMauCam, taoStreamPhatLai, type FixturePhatLai } from "./phatLaiLuot";

const CAU = "thêm hàm nhân vào src/b.ts";
const ENV0 = { ...process.env };
let uid = 0;
let GHI = "";
let fx: FixturePhatLai;
let cayGhi: Record<string, string> = {};

function taoRepo(): string {
  const r = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "phat-lai-repo-")));
  const git = (...a: string[]) => execFileSync("git", ["-C", r, ...a], { encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  git("config", "core.autocrlf", "false");
  fs.mkdirSync(path.join(r, "src"));
  fs.writeFileSync(path.join(r, "src/a.ts"), "export const cong = (a: number, b: number) => a + b;\n");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  return r;
}
const docCay = (r: string) =>
  Object.fromEntries(fs.readdirSync(path.join(r, "src")).sort().map((t) => [t, fs.readFileSync(path.join(r, "src", t), "utf8")]));

async function chay(goc: string, duAn: string, goiModel?: ReturnType<typeof taoGoiModelMayChu>) {
  process.env.AI_REPO_SANDBOX_ROOTS = `${duAn}=Phat lai|${goc}`;
  const ql = taoQuanLyLuotChay(goiModel ? { goiModel } : {});
  const kq = await ql.taoLuotChay({ user: { id: uid, role: "admin" }, cauHoi: CAU, projectId: duAn, cheDo: "tu-dong" });
  if (!kq.ok) throw new Error(`${kq.ma} ${kq.thongDiep ?? ""}`);
  await kq.luot.xong;
  const ct = await ql.chiTiet(kq.luot.id, uid);
  return { id: kq.luot.id, suKien: ct!.suKien, lyDo: kq.luot.lyDoDung };
}

beforeAll(async () => {
  process.env.AI_AGENT_THEO_VAI_TRO = "0";
  process.env.AI_CODING_TU_TRI_GHI = "1";
  uid = (await taoNguoiDungTest("phatlai", "admin")).id;
  // ── GHI
  GHI = fs.mkdtempSync(path.join(os.tmpdir(), "phat-lai-tho-"));
  process.env.AI_GHI_LUOT_DIR = GHI;
  const goc = taoRepo();
  const r = await chay(goc, "phatlaighi");
  delete process.env.AI_GHI_LUOT_DIR;
  cayGhi = docCay(goc);
  const tho = fs.readFileSync(path.join(GHI, `${r.id}.jsonl`), "utf8").trim().split("\n").map((d) => JSON.parse(d) as Record<string, unknown>);
  fx = dongGoi(tho, { goc, duAnTuongDoi: ".", cauHoi: CAU, cheDo: "tu-dong", suKien: r.suKien, lyDo: r.lyDo });
}, 120_000);

afterAll(async () => {
  for (const k of ["AI_AGENT_THEO_VAI_TRO", "AI_CODING_TU_TRI_GHI", "AI_GHI_LUOT_DIR", "AI_REPO_SANDBOX_ROOTS"]) {
    if (ENV0[k] === undefined) delete process.env[k];
    else process.env[k] = ENV0[k];
  }
  const db = await getDb();
  if (db && uid) await db.delete(aiAgentRuns).where(eq(aiAgentRuns.userId, uid));
}, 60_000);

describe("H4.2 — ghi ⇒ đóng gói ⇒ phát lại", () => {
  it("bản ghi thật có đủ 3 lượt; fixture không còn đường gốc / mẫu cấm; ghi đã tạo src/b.ts", () => {
    expect(fx.luot.map((l) => l.n)).toEqual([1, 2, 3]);
    // phiên bản 2: lượt sau chỉ mang phần MỚI của lịch sử (chỉ-nối-thêm) ⇒ tinChung tăng, tinMoi ngắn
    expect(fx.phienBan).toBe(2);
    expect(fx.luot.map((l) => l.yeuCau.tinChung)).toEqual([0, 1, 3]);
    expect(fx.luot.map((l) => l.yeuCau.tinMoi.map((m) => m.role))).toEqual([["user"], ["assistant", "tool"], ["assistant", "tool"]]);
    expect(kiemMauCam(JSON.stringify(fx))).toEqual([]);
    expect(JSON.stringify(fx)).not.toContain(os.tmpdir());
    expect(Object.keys(cayGhi)).toEqual(["a.ts", "b.ts"]);
    expect(fx.ky.lyDo).toBe("hoan-thanh");
  });

  it("★★★ phát lại ở ĐƯỜNG KHÁC: không lệch, rút hết lượt, sự kiện chuẩn hoá trùng, cây tệp trùng — không gọi engine", async () => {
    const goc2 = taoRepo();
    const p = taoStreamPhatLai(fx, { goc: goc2 });
    const k0 = dem.k;
    const r = await chay(goc2, "phatlaiphat", taoGoiModelMayChu({ chatStream: p.stream, khongGhiDauVet: true }));
    expect(p.lech).toEqual([]);
    expect(p.conLai()).toBe(0);
    expect(dem.k).toBe(k0); // engine giả KHÔNG được gọi khi phát lại
    expect(r.lyDo).toBe("hoan-thanh");
    const { taoBoThay } = await import("./phatLaiLuot");
    expect(chuanHoaSuKien(r.suKien, taoBoThay(goc2))).toEqual(fx.ky.suKien);
    expect(docCay(goc2)).toEqual(cayGhi);
  }, 120_000);

  it("dự án đổi trước khi phát (a.ts khác) ⇒ LỆCH ở lượt 2 (tin kết quả read_file), lượt dừng lỗi", async () => {
    const goc3 = taoRepo();
    fs.writeFileSync(path.join(goc3, "src/a.ts"), "export const cong = (a: number, b: number) => b + a;\n");
    const p = taoStreamPhatLai(fx, { goc: goc3 });
    const r = await chay(goc3, "phatlailech", taoGoiModelMayChu({ chatStream: p.stream, khongGhiDauVet: true }));
    expect(p.lech[0]).toMatchObject({ n: 2 });
    expect(p.lech[0]!.truong).toMatch(/^tin\[\d+\]$/);
    expect(r.lyDo).not.toBe("hoan-thanh");
  }, 120_000);

  it("đóng gói NÉM khi còn mẫu cấm (đường ổ đĩa ngoài gốc / khoá)", () => {
    const tho = [{ loai: "dau" }, { loai: "luot", n: 1, options: { messages: [{ role: "user", content: "xem C:\\Khac\\bi-mat.txt" }] }, manh: [] }];
    expect(() => dongGoi(tho, { goc: "D:/goc", duAnTuongDoi: ".", cauHoi: "q", cheDo: "hoi", suKien: [], lyDo: null })).toThrow(/duong-o-dia/);
    const khoa = [{ loai: "luot", n: 1, options: { messages: [{ role: "user", content: `khoá sk-ant-${"a".repeat(30)}` }] }, manh: [] }];
    expect(() => dongGoi(khoa, { goc: "D:/goc", duAnTuongDoi: ".", cauHoi: "q", cheDo: "hoi", suKien: [], lyDo: null })).toThrow(/khoa-anthropic/);
  });
});

describe("H4.2 — đơn vị (thay đường, lượt thừa, cờ nghĩ, đổi token về đường phát)", async () => {
  const { taoBoThay, soYeuCau, TOKEN_GOC, TOKEN_NGUOI, LoiLechPhatLai } = await import("./phatLaiLuot");
  it("taoBoThay: mọi biến thể đường gốc (/ \\, hoa/thường ổ đĩa) ⇒ token; thư mục + tên người dùng ⇒ token", () => {
    const t = taoBoThay("D:\\Du An\\goc", { home: "C:\\Users\\anh", ten: "anh" });
    expect(t("D:/Du An/goc/src/a.ts")).toBe(`${TOKEN_GOC}/src/a.ts`);
    expect(t("d:\\Du An\\goc\\src")).toBe(`${TOKEN_GOC}\\src`);
    expect(t("C:\\Users\\anh\\AppData")).toBe(`${TOKEN_NGUOI}\\AppData`);
    expect(t("người dùng anh")).toBe(`người dùng ${TOKEN_NGUOI}`);
  });
  it("soYeuCau: cờ nghĩ khác ⇒ lệch 'co'", () => {
    const y = { heThong: "x", congCu: { ten: [], bam: "b" }, co: { disableThinking: false, preserveThinking: true }, tin: [] };
    expect(soYeuCau(y, { ...y, co: { disableThinking: false, preserveThinking: false } })).toMatchObject({ truong: "co" });
    expect(soYeuCau(y, y)).toBeNull();
  });
  it("stream: lượt THỪA ⇒ LoiLechPhatLai thua-luot; token gốc trong mảnh ⇒ đường của lần phát", async () => {
    const fx1 = {
      phienBan: 1,
      dau: { ngay: "", node: "", nguon: "t" },
      lenh: { cauHoi: "q", cheDo: "hoi", duAnTuongDoi: "." },
      luot: [{ n: 1, yeuCau: { heThong: "", congCu: { ten: [], bam: "" }, co: { disableThinking: false, preserveThinking: false }, tinChung: 0, tinMoi: [{ role: "user", content: "q" }] }, manh: [{ type: "token", token: `mở ${TOKEN_GOC}/a.ts` }] }],
      ky: { suKien: [], lyDo: null },
    } as never;
    const p = taoStreamPhatLai(fx1, { goc: "E:/phat" });
    const o = { messages: [{ role: "user" as const, content: "q" }] };
    const ra: unknown[] = [];
    for await (const c of p.stream(o)) ra.push(c);
    expect(ra).toEqual([{ type: "token", token: "mở E:/phat/a.ts" }]);
    await expect((async () => {
      for await (const _ of p.stream(o)) void _;
    })()).rejects.toBeInstanceOf(LoiLechPhatLai);
    expect(p.lech).toEqual([{ n: 2, truong: "thua-luot", ghi: 1, thuc: 2 }]);
  });
});
