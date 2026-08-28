/**
 * Bảng trò chuyện AI Local. ĐỢT A: chỉ đọc — gom ngữ cảnh từ editor đang mở, gửi câu hỏi, đổ chữ
 * về. KHÔNG có bất kỳ đường ghi tệp nào ở đây.
 */
import * as vscode from "vscode";
import { dungHtmlBang } from "./htmlBang";
import { dungNguCanh } from "../loi/nguCanh";
import { dungYeuCauStream, type CheDoDuAn, type LuotChat } from "../loi/yeuCau";
import { moDongSse } from "../mang/dongSse";
import { KHOA_COOKIE } from "../loi/dangNhap";

function chuoiNgauNhien(): string {
  let s = "";
  const bang = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) s += bang[Math.floor(Math.random() * bang.length)];
  return s;
}

export class BangChat {
  private static hienTai: BangChat | undefined;
  private lichSu: LuotChat[] = [];
  private huy: AbortController | undefined;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
  ) {
    this.panel.webview.html = dungHtmlBang({ nonce: chuoiNgauNhien() });
    this.panel.onDidDispose(() => {
      this.huy?.abort();
      BangChat.hienTai = undefined;
    });
    this.panel.webview.onDidReceiveMessage((m: { loai: string; cauHoi?: string }) => {
      if (m.loai === "hoi" && m.cauHoi) void this.hoi(m.cauHoi);
    });
  }

  static moHoacHien(context: vscode.ExtensionContext): void {
    if (BangChat.hienTai) {
      BangChat.hienTai.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "aviAiLocalChat",
      "AI Local",
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    BangChat.hienTai = new BangChat(panel, context);
  }

  private thuThapNguCanh(): string {
    const cfg = vscode.workspace.getConfiguration("aviAiLocal");
    const nganSach = cfg.get<number>("nganSachNguCanh", 24000);
    const ed = vscode.window.activeTextEditor;
    if (!ed) return dungNguCanh({ nganSach });

    const duong = vscode.workspace.asRelativePath(ed.document.uri);
    const chon = ed.selection.isEmpty
      ? undefined
      : {
          duong,
          dongDau: ed.selection.start.line + 1,
          dongCuoi: ed.selection.end.line + 1,
          noiDung: ed.document.getText(ed.selection),
        };
    return dungNguCanh({
      nganSach,
      doanChon: chon,
      tepDangMo: { duong, noiDung: ed.document.getText() },
    });
  }

  private async hoi(cauHoi: string): Promise<void> {
    const cookie = await this.context.secrets.get(KHOA_COOKIE);
    if (!cookie) {
      void this.panel.webview.postMessage({
        loai: "loi",
        thongDiep: "Chưa đăng nhập — chạy lệnh 'AI Local: Đăng nhập'.",
      });
      return;
    }
    const cfg = vscode.workspace.getConfiguration("aviAiLocal");
    const cheDo: CheDoDuAn = {
      loai: "local",
      nhan: vscode.workspace.workspaceFolders?.[0]?.name ?? "workspace",
    };
    const than = dungYeuCauStream({
      cauHoi,
      nguCanh: this.thuThapNguCanh(),
      lichSu: this.lichSu,
      ngonNgu: cfg.get<string>("uiLanguage", "vi"),
      vaiTro: "engineer",
      cheDo,
    });

    this.huy?.abort();
    this.huy = new AbortController();
    let traLoi = "";
    try {
      await moDongSse({
        serverUrl: cfg.get<string>("serverUrl", "http://localhost:3000"),
        cookie,
        than,
        tinHieu: this.huy.signal,
        nhan: (sk) => {
          // Tên trường ĐÃ ĐO trên mã máy chủ: `send({ type:"token", token: evt.token })`
          // (server/routes/aiLocalKnowledgeApi.ts:595) — KHÔNG phải `text`.
          if (sk.type === "token" && typeof sk.token === "string") {
            traLoi += sk.token;
            void this.panel.webview.postMessage({ loai: "token", chu: sk.token });
          } else if (sk.type === "error") {
            void this.panel.webview.postMessage({
              loai: "loi",
              thongDiep: typeof sk.message === "string" ? sk.message : "Máy chủ báo lỗi.",
            });
          }
        },
      });
      this.lichSu.push({ role: "user", content: cauHoi }, { role: "assistant", content: traLoi });
    } catch (e) {
      void this.panel.webview.postMessage({ loai: "loi", thongDiep: (e as Error).message });
    }
  }
}
