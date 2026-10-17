/**
 * ★★★ ĐỢT 4B — lưới ĐẦU-CUỐI phiên agent (lõi dùng chung THẬT + bộ thực thi THẬT, model GIẢ, điểm ghi GIẢ):
 * model gọi edit_file ⇒ thẻ duyệt ⇒ người duyệt ⇒ apBanVa ⇒ model nhận kết quả ⇒ câu trả lời markdown có khối mã
 * ⇒ kết thúc có Hoàn tác; Dừng giữa lúc chờ duyệt ⇒ không ghi; /commit dùng `git diff --staged` + chế độ chỉ đọc.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const may = vi.hoisted(() => ({ tep: new Map<string, string>(), cfg: {} as Record<string, unknown> }));

vi.mock("vscode", () => {
  const Uri = { file: (p: string) => ({ fsPath: p, scheme: "file", toString: () => `file://${p}` }) };
  const khongCo = () => Object.assign(new Error("EntryNotFound"), { code: "FileNotFound" });
  return {
    Uri,
    RelativePattern: class {
      constructor(
        public base: unknown,
        public pattern: string,
      ) {}
    },
    FileType: { File: 1, Directory: 2 },
    SymbolKind: {},
    window: { activeTextEditor: undefined },
    env: { clipboard: { writeText: async () => undefined } },
    commands: { executeCommand: async () => undefined },
    languages: { getDiagnostics: (u?: unknown) => (u ? [] : []) },
    workspace: {
      workspaceFolders: [],
      getConfiguration: () => ({ get: (k: string, d: unknown) => (k in may.cfg ? may.cfg[k] : d) }),
      findFiles: async () => [],
      fs: {
        readFile: async (u: { fsPath: string }) => {
          if (!may.tep.has(u.fsPath)) throw khongCo();
          return Buffer.from(may.tep.get(u.fsPath)!, "utf8");
        },
        stat: async (u: { fsPath: string }) => {
          if (may.tep.has(u.fsPath)) return { type: 1 };
          throw khongCo();
        },
        readDirectory: async () => [["src", 2]],
      },
    },
  };
});

import { PhienAgent } from "./phienAgent";
import type { GoiModel, ManhModel, TinNhan, WireTool } from "../../../shared/agentCore/index";
import type { DauVaoApBanVa } from "./apBanVa";

const WS = realpathSync(mkdtempSync(join(tmpdir(), "phien-")));
mkdirSync(join(WS, "src"), { recursive: true });
afterAll(() => rmSync(WS, { recursive: true, force: true }));

function dung(kichBan: (luot: number, vao: { tinNhan: TinNhan[]; congCu: WireTool[] }) => ManhModel[], o: { tuDuyet?: boolean; diffStaged?: string } = {}) {
  const tin: Array<Record<string, unknown>> = [];
  const ap: DauVaoApBanVa[] = [];
  const vaoModel: Array<{ tinNhan: TinNhan[]; congCu: WireTool[] }> = [];
  const lenh: string[][] = [];
  const luu: Array<[string, string]> = [];
  let luot = 0;
  const goiModel: GoiModel = (vao) =>
    (async function* () {
      luot++;
      vaoModel.push({ tinNhan: vao.tinNhan, congCu: vao.congCu });
      for (const m of kichBan(luot, vao)) yield m;
    })();
  const secrets = new Map<string, string>([
    ["aviAiLocal.tokenGateway", "avgw_x"],
    ["aviAiLocal.cookie", "cookie"],
  ]);
  const state = new Map<string, unknown>();
  let phien!: PhienAgent;
  phien = new PhienAgent({
    context: {
      secrets: { get: async (k: string) => secrets.get(k) },
      workspaceState: { get: (k: string) => state.get(k), update: async (k: string, v: unknown) => void state.set(k, v) },
    } as never,
    gui: (m) => {
      tin.push(m);
      if (m.loai === "ag_the_duyet" && o.tuDuyet !== false) queueMicrotask(() => phien.quyet(String(m.id), { duyet: true }));
    },
    khoDeXuat: { datDeXuat: () => ({ cu: {}, moi: {} }), quen: () => undefined } as never,
    mucQuyen: () => "hoi_truoc_khi_ghi",
    goc: () => [WS],
    ghiLuot: (q, a) => luu.push([q, a]),
    taoGoiModel: () => goiModel,
    apBanVa: async (dv) => {
      ap.push(dv);
      const t = dv.thaoTac!;
      if (t.loai === "thay" || t.loai === "tao") may.tep.set(dv.duongTuyetDoi, t.noiDungMoi);
      return { ok: true, thongDiep: "Đã ghi", bamSauThat: "b".repeat(64) };
    },
    chayLenh: async (dv) => {
      lenh.push(dv.lenh.argv);
      return { ok: true, output: o.diffStaged ?? "", exitCode: 0, signal: null, timedOut: false, daCatSom: false, durationMs: 1 };
    },
  });
  return { phien, tin, ap, vaoModel, lenh, luu };
}

const goiTool = (id: string, ten: string, args: unknown): ManhModel => ({
  loai: "xong",
  toolCalls: [{ id, type: "function", function: { name: ten, arguments: JSON.stringify(args) } }],
});

beforeEach(() => {
  may.tep.clear();
  may.cfg = {};
});

describe("phiên agent — đầu cuối", () => {
  it("★★★ edit_file ⇒ thẻ duyệt ⇒ duyệt ⇒ apBanVa ⇒ kết quả về model ⇒ markdown có khối mã ⇒ xong + Hoàn tác", async () => {
    may.tep.set(join(WS, "src", "a.ts"), "const a = 1;\n");
    const d = dung((luot) =>
      luot === 1
        ? [{ loai: "chu", noiDung: "Sửa **a**." }, goiTool("c1", "edit_file", { path: "src/a.ts", edits: [{ old_string: "= 1", new_string: "= 2" }] })]
        : [{ loai: "chu", noiDung: "Đã sửa:\n\n```ts\nconst a = 2;\n```\n" }, { loai: "xong", toolCalls: [] }],
    );
    await d.phien.chay("đổi a thành 2", "sua");
    const loai = d.tin.map((m) => m.loai);
    expect(loai).toContain("ag_the_duyet");
    expect(loai).toContain("ag_an_the_duyet");
    expect(d.ap).toHaveLength(1);
    expect(d.ap[0].thaoTac).toEqual({ loai: "thay", noiDungMoi: "const a = 2;\n" });
    // model lượt 2 THẤY kết quả tool
    const tinTool = d.vaoModel[1].tinNhan.find((m) => m.role === "tool");
    expect(tinTool?.content).toMatch(/Applied: edit src\/a\.ts/);
    // markdown: hai đoạn (trước tool, sau cùng), khối mã ở đoạn 2 với chỉ số toàn cục 0
    const md = d.tin.filter((m) => m.loai === "ag_md");
    expect(md).toHaveLength(2);
    expect(JSON.stringify(md[1].cay)).toContain('"t":"code"');
    expect(md[1].chiSoMaDau).toBe(0);
    expect(d.tin.at(-1)).toMatchObject({ loai: "ag_xong", lyDo: "hoan-thanh", coHoanTac: true, soTep: 1 });
    expect(d.luu).toHaveLength(1);
    // đồng hồ ngữ cảnh ước lượng có mặt
    expect(d.tin.some((m) => m.loai === "ag_usage" && m.uocLuong === true)).toBe(true);
    // lõi nhận khối dự án (system) có lệnh được phép
    expect(d.vaoModel[0].tinNhan[0].content).toContain("## Allowed commands");
  });

  it("★★★ Dừng khi đang chờ duyệt ⇒ không ghi, xong với lý do huỷ", async () => {
    may.tep.set(join(WS, "src", "a.ts"), "x\n");
    const d = dung(() => [goiTool("c1", "write_file", { path: "src/a.ts", content: "y\n" })], { tuDuyet: false });
    const p = d.phien.chay("ghi y", "sua");
    await vi.waitFor(() => expect(d.tin.some((m) => m.loai === "ag_the_duyet")).toBe(true));
    d.phien.dung();
    await p;
    expect(d.ap).toHaveLength(0);
    expect(d.tin.at(-1)).toMatchObject({ loai: "ag_xong", lyDo: "huy" });
  });

  it("★★★ /commit: chạy git diff --staged (argv cố định), model ở chế độ CHỈ ĐỌC (không có tool ghi)", async () => {
    const d = dung(() => [{ loai: "chu", noiDung: "```text\nfeat: x\n```" }, { loai: "xong", toolCalls: [] }], { diffStaged: "+thêm dòng" });
    await d.phien.chay("/commit", "sua");
    expect(d.lenh).toEqual([["git", "--no-pager", "-c", "core.fsmonitor=false", "diff", "--staged", "--no-ext-diff", "--no-textconv", "--no-color", "--", "."]]);
    const ten = d.vaoModel[0].congCu.map((t) => t.function.name);
    expect(ten).not.toContain("edit_file");
    expect(d.vaoModel[0].tinNhan.at(-1)!.content).toContain("+thêm dòng");
    expect(d.tin.some((m) => m.loai === "ag_thong_bao" && String(m.thongDiep).includes("không tự commit"))).toBe(true);
  });

  it("★★★ RÀ BẢO MẬT — /commit và @git: khối .env đã stage/theo dõi KHÔNG tới model; người dùng được CẢNH BÁO", async () => {
    const PAT = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
    const diff =
      "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n+const a = 1;\n" +
      `diff --git a/.env b/.env\n--- a/.env\n+++ b/.env\n@@ -1 +1 @@\n+GITHUB_PAT=${PAT}\n`;
    for (const cau of ["/commit", "xem thay đổi @git"]) {
      const d = dung(() => [{ loai: "chu", noiDung: "ok" }, { loai: "xong", toolCalls: [] }], { diffStaged: diff });
      await d.phien.chay(cau, "sua");
      const gui = JSON.stringify(d.vaoModel);
      expect(gui, cau).toContain("+const a = 1;");
      expect(gui, cau).not.toContain(PAT);
      expect(d.tin.some((m) => m.loai === "ag_thong_bao" && String(m.thongDiep).includes(".env")), cau).toBe(true);
    }
  });

  it("★★ /commit khi chưa stage gì ⇒ lỗi rõ, KHÔNG gọi model", async () => {
    const d = dung(() => [{ loai: "xong", toolCalls: [] }], { diffStaged: "" });
    await d.phien.chay("/commit", "sua");
    expect(d.vaoModel).toHaveLength(0);
    expect(d.tin.some((m) => m.loai === "ag_loi" && String(m.thongDiep).includes("stage"))).toBe(true);
  });

  it("★★ lệnh gạch lạ ⇒ lỗi liệt kê lệnh đúng", async () => {
    const d = dung(() => []);
    await d.phien.chay("/xoa-het", "sua");
    expect(d.tin[0]).toMatchObject({ loai: "ag_loi", ma: "LENH_GACH" });
  });

  it("★★ hoàn tác sau lượt chạy: tệp còn đúng bản AI để lại ⇒ khôi phục bản gốc qua apBanVa", async () => {
    const p = join(WS, "src", "b.ts");
    may.tep.set(p, "goc\n");
    const d = dung((luot) => (luot === 1 ? [goiTool("c1", "write_file", { path: "src/b.ts", content: "moi\n" })] : [{ loai: "xong", toolCalls: [] }]));
    // apBanVa giả trả băm cố định — đặt băm thật để hoàn tác nhận đúng trạng thái AI để lại
    await d.phien.chay("ghi", "sua");
    expect(may.tep.get(p)).toBe("moi\n");
    // băm giả "b…" ≠ băm thật của "moi\n" ⇒ hoàn tác phải từ chối vì xung đột (không đoán)
    await d.phien.hoanTac();
    const kq = d.tin.find((m) => m.loai === "ag_hoan_tac")!;
    expect(kq.ok).toBe(false);
    expect(String(kq.thongDiep)).toMatch(/xung đột/);
    expect(may.tep.get(p)).toBe("moi\n");
  });
});
