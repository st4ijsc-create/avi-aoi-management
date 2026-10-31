/**
 * ★ Đợt 12 H4.2 — bộ GHI lượt model (bản thô cho phát lại không GPU). Đo: chuyển NGUYÊN mảnh, ghi đúng thứ tự, một dòng đầu / run,
 * lỗi giữa luồng ghi rồi ném lại, sai tham số / ghi hỏng ⇒ không ảnh hưởng lượt; `goiModelMayChu` chỉ bọc khi CÓ AI_GHI_LUOT_DIR + runId;
 * census: chỉ `goiModelMayChu.ts` đọc biến môi trường.
 * ĐỘT BIẾN PHẢI BẮT: bỏ mảnh / đổi thứ tự · ghi dòng đầu mỗi lượt · nuốt lỗi giữa luồng · bọc khi thiếu runId / env · ghi hỏng làm hỏng lượt.
 */
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bocGhiLuot, _datLaiGhiLuot } from "./ghiLuotModel";
import { taoGoiModelMayChu } from "./goiModelMayChu";
import type { GgufChatOptions, GgufStreamChunk } from "../../aiGgufEngine";

const RUN = "12345678-1234-4234-8234-123456789abc";
const MANH: GgufStreamChunk[] = [
  { type: "reasoning", token: "nghĩ" },
  { type: "token", token: "chào" },
  { type: "done", fullText: "chào", tokensPrompt: 14, tokensGenerated: 3, cacheN: 12, promptN: 2, toolCalls: [] },
];
const gocGia = (ds: GgufStreamChunk[], nemSau?: number) =>
  async function* (_o: GgufChatOptions) {
    for (let i = 0; i < ds.length; i++) {
      if (nemSau !== undefined && i === nemSau) throw new Error("đứt giữa luồng");
      yield ds[i]!;
    }
  };
const OPT: GgufChatOptions = { messages: [{ role: "user", content: "hỏi" }], maxTokens: 10 };
const thuMuc = () => fs.mkdtempSync(path.join(os.tmpdir(), "ghi-luot-"));
const docDong = (tep: string) => fs.readFileSync(tep, "utf8").trim().split("\n").map((d) => JSON.parse(d) as Record<string, unknown>);
async function gom(it: AsyncIterable<GgufStreamChunk>) {
  const ra: GgufStreamChunk[] = [];
  for await (const c of it) ra.push(c);
  return ra;
}

afterEach(() => {
  _datLaiGhiLuot();
  delete process.env.AI_GHI_LUOT_DIR;
});

describe("bocGhiLuot", () => {
  it("★ chuyển nguyên mảnh đúng thứ tự; tệp có MỘT dòng đầu rồi mỗi lượt một dòng (n tăng), mảnh + options nguyên văn", async () => {
    const d = thuMuc();
    const boc = bocGhiLuot(gocGia(MANH), { thuMuc: d, runId: RUN });
    expect(await gom(boc(OPT, "m1"))).toEqual(MANH);
    expect(await gom(boc(OPT, "m1"))).toEqual(MANH);
    const dong = docDong(path.join(d, `${RUN}.jsonl`));
    expect(dong.map((x) => [x.loai, x.n ?? null])).toEqual([["dau", null], ["luot", 1], ["luot", 2]]);
    expect(dong[0]).toMatchObject({ phienBan: 1, runId: RUN, node: process.version });
    expect(dong[1]).toMatchObject({ modelId: "m1", options: OPT, manh: MANH });
    expect(dong[1]).not.toHaveProperty("loi");
  });

  it("lỗi giữa luồng ⇒ ném lại NGUYÊN lỗi cho người gọi; dòng lượt ghi phần mảnh đã có + loi", async () => {
    const d = thuMuc();
    const boc = bocGhiLuot(gocGia(MANH, 2), { thuMuc: d, runId: RUN });
    const ra: GgufStreamChunk[] = [];
    await expect((async () => {
      for await (const c of boc(OPT)) ra.push(c);
    })()).rejects.toThrow("đứt giữa luồng");
    expect(ra).toEqual(MANH.slice(0, 2));
    const luot = docDong(path.join(d, `${RUN}.jsonl`)).find((x) => x.loai === "luot")!;
    expect(luot).toMatchObject({ manh: MANH.slice(0, 2), loi: "đứt giữa luồng" });
  });

  it("(rà kiem-dinh) thư mục ghi nằm TRONG thư mục làm việc (gốc repo) ⇒ trả hàm gốc, không ghi; ngoài ⇒ hợp lệ", async () => {
    const { thuMucGhiHopLe } = await import("./ghiLuotModel");
    const g = gocGia(MANH);
    expect(bocGhiLuot(g, { thuMuc: path.join(process.cwd(), "tmp", "ghi-luot"), runId: RUN })).toBe(g);
    expect(bocGhiLuot(g, { thuMuc: process.cwd(), runId: RUN })).toBe(g);
    expect(thuMucGhiHopLe(path.join(os.tmpdir(), "x"), "D:/SOURCES/du-an")).toBe(true);
    expect(thuMucGhiHopLe("D:/SOURCES/du-an/tmp", "D:/SOURCES/du-an")).toBe(false);
    expect(thuMucGhiHopLe("D:/SOURCES/du-an-khac", "D:/SOURCES/du-an")).toBe(true);
  });

  it("(rà an toàn dieu-phoi) TRONG bất kỳ gốc dự án đã khai ⇒ từ chối; junction / symlink trỏ vào gốc cấm ⇒ vẫn từ chối (so realpath)", async () => {
    const { thuMucGhiHopLe } = await import("./ghiLuotModel");
    const goc = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ghi-goc-du-an-")));
    const ngoai = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ghi-ngoai-")));
    expect(thuMucGhiHopLe(path.join(goc, "con", "chua-co"), "Z:/khac", [goc])).toBe(false);
    expect(thuMucGhiHopLe(goc, "Z:/khac", [goc])).toBe(false);
    expect(thuMucGhiHopLe(path.join(ngoai, "ghi"), "Z:/khac", [goc])).toBe(true);
    // lối tắt (junction trên Windows, symlink nơi khác) nằm NGOÀI nhưng trỏ VÀO gốc dự án
    const loiTat = path.join(ngoai, "loi-tat");
    fs.symlinkSync(goc, loiTat, process.platform === "win32" ? "junction" : "dir");
    expect(thuMucGhiHopLe(path.join(loiTat, "ghi"), "Z:/khac", [goc])).toBe(false);
  });

  it.skipIf(process.platform === "win32")("(rà an toàn dieu-phoi) POSIX: thư mục 0700, tệp thô 0600 (Windows: quyền = ACL thư mục — bỏ qua)", async () => {
    const d = path.join(thuMuc(), "moi");
    const boc = bocGhiLuot(gocGia(MANH), { thuMuc: d, runId: RUN });
    await gom(boc(OPT));
    expect(fs.statSync(d).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(d, `${RUN}.jsonl`)).mode & 0o777).toBe(0o600);
  });

  it("(rà an toàn dieu-phoi) bocGhiLuot đọc gốc dự án đã khai (AI_REPO_SANDBOX_ROOTS) ⇒ thư mục trong dự án bị bỏ qua", () => {
    const goc = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ghi-env-du-an-")));
    const cu = process.env.AI_REPO_SANDBOX_ROOTS;
    process.env.AI_REPO_SANDBOX_ROOTS = `ghienv=Ghi env|${goc}`;
    try {
      const g = gocGia(MANH);
      expect(bocGhiLuot(g, { thuMuc: path.join(goc, "ghi-luot"), runId: RUN })).toBe(g);
    } finally {
      if (cu === undefined) delete process.env.AI_REPO_SANDBOX_ROOTS;
      else process.env.AI_REPO_SANDBOX_ROOTS = cu;
    }
  });

  it("runId không phải UUID / thư mục tương đối ⇒ trả lại đúng hàm gốc (không ghi)", () => {
    const g = gocGia(MANH);
    expect(bocGhiLuot(g, { thuMuc: thuMuc(), runId: "../../etc" })).toBe(g);
    expect(bocGhiLuot(g, { thuMuc: "tmp/ghi", runId: RUN })).toBe(g);
  });

  it("ghi hỏng (thư mục là một TỆP) ⇒ lượt model vẫn trọn vẹn", async () => {
    const d = thuMuc();
    const laTep = path.join(d, "khong-phai-thu-muc");
    fs.writeFileSync(laTep, "x");
    const boc = bocGhiLuot(gocGia(MANH), { thuMuc: laTep, runId: RUN });
    expect(await gom(boc(OPT))).toEqual(MANH);
  });
});

describe("goiModelMayChu — chỉ ghi khi CÓ AI_GHI_LUOT_DIR và runId", () => {
  const chay = async (cauHinh: { runId?: string }) => {
    const goi = taoGoiModelMayChu({ khongGhiDauVet: true, chatStream: gocGia(MANH), ...cauHinh });
    for await (const _ of goi({ tinNhan: [{ role: "user", content: "hỏi" }], congCu: [], signal: new AbortController().signal })) void _;
  };
  it("có cả hai ⇒ tệp <runId>.jsonl có lượt, messages đúng thứ gửi engine", async () => {
    const d = thuMuc();
    process.env.AI_GHI_LUOT_DIR = d;
    await chay({ runId: RUN });
    const dong = docDong(path.join(d, `${RUN}.jsonl`));
    expect(dong.filter((x) => x.loai === "luot")).toHaveLength(1);
    expect((dong[1]!.options as GgufChatOptions).messages.at(-1)).toMatchObject({ role: "user", content: "hỏi" });
  });
  it("thiếu env hoặc thiếu runId ⇒ không tệp nào", async () => {
    const d = thuMuc();
    await chay({ runId: RUN });
    process.env.AI_GHI_LUOT_DIR = d;
    await chay({});
    expect(fs.readdirSync(d)).toEqual([]);
  });
});

describe("census — AI_GHI_LUOT_DIR", () => {
  it("chỉ goiModelMayChu.ts đọc biến (ngoài chú thích), trong server/ + shared/", () => {
    const GOC = path.join(__dirname, "../../../..");
    const thay: string[] = [];
    const duyet = (dd: string) => {
      for (const ten of fs.readdirSync(dd)) {
        const p = path.join(dd, ten);
        if (fs.statSync(p).isDirectory()) {
          if (ten !== "node_modules") duyet(p);
        } else if (/\.(ts|tsx|mjs|js)$/.test(ten) && !/\.test\./.test(ten)) {
          const s = fs.readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
          if (s.includes("AI_GHI_LUOT_DIR")) thay.push(path.relative(GOC, p).replace(/\\/g, "/"));
        }
      }
    };
    duyet(path.join(GOC, "server"));
    duyet(path.join(GOC, "shared"));
    expect(thay).toEqual(["server/services/ai/agent/goiModelMayChu.ts"]);
  });
});
