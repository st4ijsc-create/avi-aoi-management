/**
 * ★★★ ĐỢT 4C — lưới tầng VSCode của ghost-text (`InlineCompletionItemProvider`), vscode GIẢ.
 *
 * Đo chuỗi người dùng thật đi qua: gõ ⇒ VSCode gọi provider ⇒ gỡ dội ⇒ gọi /v1/completions ⇒ cắt ⇒ chữ mờ.
 * ⚠ Bất biến quan trọng nhất của lưới này: lỗi mạng/máy chủ IM LẶNG — ghost-text chạy mỗi lần gõ phím, một hộp
 *   thoại lỗi mỗi phím là phá trình soạn thảo. Mọi `show*Message` của bản giả đều bị ĐẾM.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const may = vi.hoisted(() => ({
  thongBao: [] as string[],
  cauHinh: { "ghostText.enabled": true, "ghostText.doTreMs": 250, serverUrl: "http://may:3000" } as Record<string, unknown>,
  capNhatCauHinh: [] as Array<{ khoa: string; giaTri: unknown }>,
  thuMucWs: ["D:\\ws"] as string[],
  dangKyProvider: [] as Array<{ selector: unknown; provider: unknown }>,
  lenh: new Map<string, () => unknown>(),
  thanhTrangThai: undefined as undefined | { text: string; tooltip: string; command: string; shown: boolean },
  nhatKy: [] as string[],
}));

vi.mock("vscode", () => {
  class Position {
    constructor(
      public line: number,
      public character: number,
    ) {}
  }
  class Range {
    constructor(
      public start: Position,
      public end: Position,
    ) {}
  }
  class InlineCompletionItem {
    constructor(
      public insertText: string,
      public range?: Range,
    ) {}
  }
  const bao = (s: string) => {
    may.thongBao.push(s);
    return Promise.resolve(undefined);
  };
  return {
    Position,
    Range,
    InlineCompletionItem,
    InlineCompletionTriggerKind: { Invoke: 0, Automatic: 1 },
    EndOfLine: { LF: 1, CRLF: 2 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ConfigurationTarget: { Global: 1 },
    window: {
      showErrorMessage: bao,
      showWarningMessage: bao,
      showInformationMessage: bao,
      createOutputChannel: () => ({ appendLine: (s: string) => may.nhatKy.push(s), dispose: () => undefined }),
      createStatusBarItem: () => {
        const it = { text: "", tooltip: "", command: "", shown: false, show: () => (it.shown = true), hide: () => (it.shown = false), dispose: () => undefined };
        may.thanhTrangThai = it as never;
        return it;
      },
    },
    workspace: {
      get workspaceFolders() {
        return may.thuMucWs.map((p) => ({ uri: { fsPath: p } }));
      },
      getConfiguration: () => ({
        get: <T>(k: string, mm: T) => (k in may.cauHinh ? (may.cauHinh[k] as T) : mm),
        update: async (k: string, v: unknown) => {
          may.capNhatCauHinh.push({ khoa: k, giaTri: v });
          may.cauHinh[k] = v;
        },
      }),
      onDidChangeConfiguration: () => ({ dispose: () => undefined }),
    },
    languages: {
      registerInlineCompletionItemProvider: (selector: unknown, provider: unknown) => {
        may.dangKyProvider.push({ selector, provider });
        return { dispose: () => undefined };
      },
    },
    commands: {
      registerCommand: (id: string, h: () => unknown) => {
        may.lenh.set(id, h);
        return { dispose: () => undefined };
      },
    },
  };
});

import { GhostTextProvider, dangKyGhostText, LENH_BAT_TAT_GHOST_TEXT } from "./ghostText";
import type { DauVaoGoiFim, KetQuaFim } from "../mang/goiFim";

function taiLieu(vanBan: string, duong = "D:\\ws\\src\\a.ts", eol = 1) {
  return {
    uri: { fsPath: duong, scheme: "file" },
    eol,
    getText: () => vanBan,
    offsetAt: (p: { line: number; character: number }) => {
      const dong = vanBan.split("\n");
      let o = 0;
      for (let i = 0; i < p.line; i++) o += dong[i].length + 1;
      return o + p.character;
    },
  };
}
const ngu = (triggerKind = 1) => ({ triggerKind, selectedCompletionInfo: undefined });
const tokenSong = () => ({ isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => undefined }) });

function dung(goiFim: (dv: DauVaoGoiFim) => Promise<KetQuaFim>, token: string | null = "avgw_x") {
  const goi: DauVaoGoiFim[] = [];
  const trangThai: string[] = [];
  const nhatKy: string[] = [];
  const p = new GhostTextProvider({
    layToken: async () => token ?? undefined,
    cauHinh: () => ({
      batTat: may.cauHinh["ghostText.enabled"] as boolean,
      serverUrl: String(may.cauHinh.serverUrl),
      doTreMs: Number(may.cauHinh["ghostText.doTreMs"]),
    }),
    thuMucWorkspace: () => may.thuMucWs,
    ghiNhatKy: (s) => nhatKy.push(s),
    khiTrangThai: (t) => trangThai.push(t.loai),
    goiFim: async (dv) => {
      goi.push(dv);
      return goiFim(dv);
    },
  });
  return { p, goi, trangThai, nhatKy };
}

beforeEach(() => {
  vi.useFakeTimers();
  may.thongBao = [];
  may.cauHinh = { "ghostText.enabled": true, "ghostText.doTreMs": 250, serverUrl: "http://may:3000" };
  may.capNhatCauHinh = [];
  may.thuMucWs = ["D:\\ws"];
  may.dangKyProvider = [];
  may.lenh = new Map();
  may.thanhTrangThai = undefined;
  may.nhatKy = [];
});
afterEach(() => vi.useRealTimers());

async function chay<T>(p: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(1000);
  return p;
}

describe("GhostTextProvider", () => {
  it("★★★ đường chính: gợi ý đã cắt, chèn tại con trỏ, nhật ký ghi độ trễ (không ghi mã)", async () => {
    const { p, goi, nhatKy } = dung(async () => ({ ok: true, text: "1;\nconst b = 2;", ms: 87 }));
    const doc = taiLieu("function f() {\n  const a = \n}\n");
    const kq = (await chay(p.provideInlineCompletionItems(doc as never, { line: 1, character: 12 } as never, ngu() as never, tokenSong() as never))) as Array<{ insertText: string }>;
    expect(kq).toHaveLength(1);
    expect(kq[0].insertText).toBe("1;");
    expect(goi[0].than).toMatchObject({ model: "fim", prompt: "function f() {\n  const a = ", suffix: "\n}\n" });
    expect(goi[0].token).toBe("avgw_x");
    expect(nhatKy.join("\n")).toMatch(/87 ms/);
    expect(nhatKy.join("\n")).not.toContain("const a");
  });

  it("★★★ LỖI MẠNG ⇒ IM LẶNG: không hộp thoại nào, chỉ nhật ký + thanh trạng thái; lượt sau nghỉ (không dội máy chủ)", async () => {
    const { p, goi, trangThai, nhatKy } = dung(async () => ({ ok: false, loai: "mang", thongDiep: "fetch failed", ms: 3 }));
    const doc = taiLieu("const a = \n");
    for (let i = 0; i < 5; i++) {
      const kq = await chay(p.provideInlineCompletionItems(doc as never, { line: 0, character: 10 } as never, ngu() as never, tokenSong() as never));
      expect(kq).toBeUndefined();
    }
    expect(may.thongBao).toEqual([]);
    expect(goi).toHaveLength(1);
    expect(trangThai).toContain("loi");
    expect(nhatKy.join("\n")).toMatch(/fetch failed/);
  });

  it("★★★ 401 ⇒ im lặng, thanh trạng thái báo chưa đăng nhập, không gọi lại tới khi đặt lại", async () => {
    const { p, goi, trangThai } = dung(async () => ({ ok: false, loai: "tu-choi", status: 401, thongDiep: "expired", ms: 3 }));
    const doc = taiLieu("const a = \n");
    await chay(p.provideInlineCompletionItems(doc as never, { line: 0, character: 10 } as never, ngu() as never, tokenSong() as never));
    await chay(p.provideInlineCompletionItems(doc as never, { line: 0, character: 10 } as never, ngu() as never, tokenSong() as never));
    expect(goi).toHaveLength(1);
    expect(trangThai).toContain("chua-dang-nhap");
    expect(may.thongBao).toEqual([]);
    p.datLaiLoi();
    await chay(p.provideInlineCompletionItems(doc as never, { line: 0, character: 10 } as never, ngu() as never, tokenSong() as never));
    expect(goi).toHaveLength(2);
  });

  it("★★★ chưa có token ⇒ không gọi mạng, không hộp thoại", async () => {
    const { p, goi, trangThai } = dung(async () => ({ ok: true, text: "x", ms: 1 }), null);
    const kq = await chay(p.provideInlineCompletionItems(taiLieu("a\n") as never, { line: 0, character: 1 } as never, ngu() as never, tokenSong() as never));
    expect(kq).toBeUndefined();
    expect(goi).toHaveLength(0);
    expect(trangThai).toContain("chua-dang-nhap");
    expect(may.thongBao).toEqual([]);
  });

  it("★★★ tệp cấm (.env) / ngoài workspace ⇒ KHÔNG gửi byte nào", async () => {
    const { p, goi } = dung(async () => ({ ok: true, text: "x", ms: 1 }));
    for (const duong of ["D:\\ws\\.env", "D:\\khac\\a.ts", "D:\\ws\\.git\\config", "D:\\ws\\k\\id_rsa"]) {
      const kq = await chay(p.provideInlineCompletionItems(taiLieu("SECRET=abc\n", duong) as never, { line: 0, character: 7 } as never, ngu() as never, tokenSong() as never));
      expect(kq, duong).toBeUndefined();
    }
    expect(goi).toHaveLength(0);
  });

  it("★★★ bí mật bị che TRƯỚC khi rời máy", async () => {
    const { p, goi } = dung(async () => ({ ok: true, text: "x", ms: 1 }));
    const doc = taiLieu('const k = "sk-abcdefghijklmnopqrstuvwxyz";\nconst y = \n');
    await chay(p.provideInlineCompletionItems(doc as never, { line: 1, character: 10 } as never, ngu() as never, tokenSong() as never));
    expect(JSON.stringify(goi[0].than)).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
  });

  it("★★★ gõ liên tục ⇒ chỉ MỘT yêu cầu (gỡ dội); lượt cũ trả undefined", async () => {
    const { p, goi } = dung(async () => ({ ok: true, text: "x", ms: 1 }));
    const doc = taiLieu("const a = \n");
    const ps = [0, 1, 2].map(() => p.provideInlineCompletionItems(doc as never, { line: 0, character: 10 } as never, ngu() as never, tokenSong() as never));
    await vi.advanceTimersByTimeAsync(1000);
    const kq = await Promise.all(ps);
    expect(goi).toHaveLength(1);
    expect(kq[0]).toBeUndefined();
    expect(kq[1]).toBeUndefined();
    expect(kq[2]).toHaveLength(1);
  });

  it("★★★ gõ tiếp khi đang gọi mạng ⇒ signal của lượt cũ bị huỷ", async () => {
    let giai: ((k: KetQuaFim) => void) | undefined;
    const { p, goi } = dung(() => new Promise<KetQuaFim>((r) => (giai = r)));
    const doc = taiLieu("const a = \n");
    const p1 = p.provideInlineCompletionItems(doc as never, { line: 0, character: 10 } as never, ngu() as never, tokenSong() as never);
    await vi.advanceTimersByTimeAsync(300);
    expect(goi).toHaveLength(1);
    void p.provideInlineCompletionItems(doc as never, { line: 0, character: 10 } as never, ngu() as never, tokenSong() as never);
    expect(goi[0].signal.aborted).toBe(true);
    giai!({ ok: true, text: "x", ms: 1 });
    expect(await p1).toBeUndefined();
  });

  it("★★ tắt cấu hình ⇒ không làm gì", async () => {
    may.cauHinh["ghostText.enabled"] = false;
    const { p, goi } = dung(async () => ({ ok: true, text: "x", ms: 1 }));
    const kq = await chay(p.provideInlineCompletionItems(taiLieu("a\n") as never, { line: 0, character: 1 } as never, ngu() as never, tokenSong() as never));
    expect(kq).toBeUndefined();
    expect(goi).toHaveLength(0);
  });

  it("★★ khung gợi ý (IntelliSense) đang mở ⇒ nhường, không gọi", async () => {
    const { p, goi } = dung(async () => ({ ok: true, text: "x", ms: 1 }));
    const ctx = { triggerKind: 1, selectedCompletionInfo: { text: "abc" } };
    await chay(p.provideInlineCompletionItems(taiLieu("a\n") as never, { line: 0, character: 1 } as never, ctx as never, tokenSong() as never));
    expect(goi).toHaveLength(0);
  });

  it("★★ tài liệu CRLF ⇒ gợi ý nhiều dòng mang CRLF", async () => {
    const { p } = dung(async () => ({ ok: true, text: "a();\n  b();", ms: 1 }));
    const doc = taiLieu("{\n  \n}\n", "D:\\ws\\x.ts", 2);
    const kq = (await chay(p.provideInlineCompletionItems(doc as never, { line: 1, character: 2 } as never, ngu() as never, tokenSong() as never))) as Array<{ insertText: string }>;
    expect(kq[0].insertText).toBe("a();\r\n  b();");
  });
});

describe("dangKyGhostText", () => {
  function ngCanh() {
    return {
      subscriptions: [] as unknown[],
      secrets: { get: async () => "avgw_x", onDidChange: () => ({ dispose: () => undefined }) },
    };
  }

  it("★★★ đăng ký provider cho tệp đĩa + lệnh bật/tắt + nút thanh trạng thái", () => {
    dangKyGhostText(ngCanh() as never);
    expect(may.dangKyProvider).toHaveLength(1);
    expect(JSON.stringify(may.dangKyProvider[0].selector)).toContain("file");
    expect(may.lenh.has(LENH_BAT_TAT_GHOST_TEXT)).toBe(true);
    expect(may.thanhTrangThai?.command).toBe(LENH_BAT_TAT_GHOST_TEXT);
    expect(may.thanhTrangThai?.shown).toBe(true);
  });

  it("★★★ nút bật/tắt lật cấu hình aviAiLocal.ghostText.enabled (phạm vi Global)", async () => {
    dangKyGhostText(ngCanh() as never);
    await may.lenh.get(LENH_BAT_TAT_GHOST_TEXT)!();
    expect(may.capNhatCauHinh).toEqual([{ khoa: "ghostText.enabled", giaTri: false }]);
    expect(may.thanhTrangThai?.text).toMatch(/tắt|circle-slash/i);
  });
});
