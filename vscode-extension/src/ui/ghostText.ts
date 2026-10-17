/**
 * ★★★ ĐỢT 4C — GHOST-TEXT (gợi ý chữ mờ kiểu Copilot): `InlineCompletionItemProvider` gọi `POST /v1/completions`
 * (FIM, model logic `fim`) bằng token cá nhân `avgw_…`.
 *
 * Chuỗi: VSCode gọi provider mỗi lần gõ ⇒ bỏ qua tệp cấm (`lyDoBoQua`) ⇒ gỡ dội + huỷ lượt cũ (`DieuPhoiGoDoi`) ⇒ cắt
 * ngữ cảnh có trần + che bí mật (`catNguCanh`, `dungThanYeuCauFim`) ⇒ gọi mạng (`goiFim`, không bao giờ ném) ⇒ cắt gợi
 * ý (`catGoiY`) ⇒ trả MỘT `InlineCompletionItem` chèn tại con trỏ.
 *
 * ⚠⚠ KHÔNG HỘP THOẠI. Ghost-text chạy mỗi phím gõ — lỗi chỉ vào kênh "AI Local — Ghost text" + thanh trạng thái, và
 *    lớp `TrangThaiLoiGhost` cho nghỉ (lỗi mạng 30 s; 401/403 tới khi token/cấu hình đổi) để không dội máy chủ.
 * ⚠ Không phải đường ghi: chữ mờ chỉ vào bộ đệm khi NGƯỜI DÙNG bấm Tab — VSCode tự chèn (hoàn tác bằng Ctrl+Z), không
 *   có byte nào xuống đĩa từ đây. Census ghi đĩa (`loi/census.unit.test.ts`) vẫn canh tệp này như mọi tệp khác.
 */
import * as vscode from "vscode";
import { catGoiY, catNguCanh, dungThanYeuCauFim, laCheDoMotDong, lyDoBoQua } from "../loi/ghostText";
import { DieuPhoiGoDoi, TrangThaiLoiGhost } from "../loi/ghostTextDieuPhoi";
import { duongTuongDoiTrongWorkspace } from "../loi/chanGhi";
import { KHOA_TOKEN_GATEWAY } from "../loi/thietBi";
import { goiFim as goiFimThat, type DauVaoGoiFim, type KetQuaFim } from "../mang/goiFim";

export const LENH_BAT_TAT_GHOST_TEXT = "aviAiLocal.batTatGhostText";
/** Khoá cấu hình (dưới `aviAiLocal.`). */
export const KHOA_BAT_GHOST_TEXT = "ghostText.enabled";
export const KHOA_DO_TRE_GHOST_TEXT = "ghostText.doTreMs";
export const DO_TRE_MAC_DINH_MS = 250;

export type LoaiTrangThaiGhost = "tat" | "san-sang" | "dang-goi" | "loi" | "chua-dang-nhap";

export interface PhuThuocGhostText {
  layToken(): Promise<string | undefined>;
  cauHinh(): { batTat: boolean; serverUrl: string; doTreMs: number };
  thuMucWorkspace(): string[];
  ghiNhatKy(dong: string): void;
  khiTrangThai(tt: { loai: LoaiTrangThaiGhost; chiTiet?: string }): void;
  goiFim?: (dv: DauVaoGoiFim) => Promise<KetQuaFim>;
  bayGio?: () => number;
}

export class GhostTextProvider implements vscode.InlineCompletionItemProvider {
  private readonly dieuPhoi = new DieuPhoiGoDoi(DO_TRE_MAC_DINH_MS);
  private readonly loi = new TrangThaiLoiGhost();

  constructor(private readonly pt: PhuThuocGhostText) {}

  /** Đăng nhập lại / đổi cấu hình ⇒ thử lại ngay (bỏ trạng thái nghỉ sau lỗi). */
  datLaiLoi(): void {
    this.loi.datLai();
  }

  huyDangCho(): void {
    this.dieuPhoi.huyTatCa();
  }

  async provideInlineCompletionItems(
    doc: vscode.TextDocument,
    viTri: vscode.Position,
    ngu: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    const ch = this.pt.cauHinh();
    if (!ch.batTat) return undefined;
    // Khung IntelliSense đang mở ⇒ nhường (hai gợi ý chồng nhau làm Tab mơ hồ).
    if (ngu.selectedCompletionInfo) return undefined;
    const vanBan = doc.getText();
    const lyDo = lyDoBoQua({
      duong: doc.uri.fsPath,
      scheme: doc.uri.scheme,
      trongWorkspace: !!duongTuongDoiTrongWorkspace(doc.uri.fsPath, this.pt.thuMucWorkspace()),
      soKyTu: vanBan.length,
    });
    if (lyDo) return undefined;
    const bayGio = this.pt.bayGio ?? Date.now;
    if (this.loi.dangNghi(bayGio())) return undefined;

    const goiTay = ngu.triggerKind === vscode.InlineCompletionTriggerKind.Invoke;
    const signal = await this.dieuPhoi.cho(token, goiTay ? 0 : ch.doTreMs);
    if (!signal) return undefined;

    const tok = await this.pt.layToken();
    if (!tok) {
      this.pt.khiTrangThai({ loai: "chua-dang-nhap", chiTiet: 'Chạy "AI Local: Đăng nhập AI Local (device flow)" để bật ghost-text.' });
      return undefined;
    }
    const { tienTo, hauTo } = catNguCanh(vanBan, doc.offsetAt(viTri));
    const motDong = laCheDoMotDong(tienTo, hauTo);
    const than = dungThanYeuCauFim({ tienTo, hauTo, motDong });

    this.pt.khiTrangThai({ loai: "dang-goi" });
    const kq = await (this.pt.goiFim ?? goiFimThat)({ serverUrl: ch.serverUrl, token: tok, than, signal });
    if (!kq.ok) {
      if (kq.loai === "huy") return undefined;
      // ⚠ IM LẶNG: nhật ký + thanh trạng thái, KHÔNG show*Message.
      this.pt.ghiNhatKy(`ghost-text lỗi (${kq.loai}${kq.status ? ` ${kq.status}` : ""}) sau ${kq.ms} ms: ${kq.thongDiep}`);
      if (kq.loai === "tu-choi" || kq.loai === "chua-dang-nhap") {
        this.loi.ghiLoi("tu-choi", bayGio());
        this.pt.khiTrangThai({ loai: "chua-dang-nhap", chiTiet: kq.thongDiep });
      } else {
        this.loi.ghiLoi(kq.loai === "http" ? "http" : "mang", bayGio());
        this.pt.khiTrangThai({ loai: "loi", chiTiet: kq.thongDiep });
      }
      return undefined;
    }
    this.loi.ghiThanhCong();
    this.pt.khiTrangThai({ loai: "san-sang" });
    const goiY = catGoiY(kq.text, { tienTo, hauTo, motDong });
    // Chỉ số đo — KHÔNG ghi mã nguồn hay gợi ý vào nhật ký.
    this.pt.ghiNhatKy(
      `ghost-text ${kq.ms} ms · ${motDong ? "1 dòng" : "khối"} · thô ${kq.text.length} ký tự → gợi ý ${goiY.length} ký tự`,
    );
    if (!goiY || signal.aborted) return undefined;
    const chen = doc.eol === vscode.EndOfLine.CRLF ? goiY.replace(/\n/g, "\r\n") : goiY;
    return [new vscode.InlineCompletionItem(chen, new vscode.Range(viTri, viTri))];
  }
}

function hienThanhTrangThai(
  item: vscode.StatusBarItem,
  batTat: boolean,
  tt?: { loai: LoaiTrangThaiGhost; chiTiet?: string },
): void {
  if (!batTat) {
    item.text = "$(circle-slash) AI gợi ý: tắt";
    item.tooltip = "AI Local ghost-text đang TẮT — bấm để bật (aviAiLocal.ghostText.enabled).";
    return;
  }
  const loai = tt?.loai ?? "san-sang";
  item.text =
    loai === "loi" ? "$(warning) AI gợi ý" : loai === "chua-dang-nhap" ? "$(key) AI gợi ý" : loai === "dang-goi" ? "$(sync~spin) AI gợi ý" : "$(sparkle) AI gợi ý";
  item.tooltip =
    (loai === "loi"
      ? `AI Local ghost-text: lỗi gần nhất — ${tt?.chiTiet ?? ""} (chi tiết: kênh Output "AI Local — Ghost text"). `
      : loai === "chua-dang-nhap"
        ? `AI Local ghost-text: chưa có token /v1 hợp lệ — ${tt?.chiTiet ?? ""} `
        : "AI Local ghost-text đang BẬT. ") + "Bấm để tắt.";
}

/** Đăng ký provider + lệnh bật/tắt + nút thanh trạng thái + kênh nhật ký. Mọi thứ đẩy vào `context.subscriptions`. */
export function dangKyGhostText(context: vscode.ExtensionContext): GhostTextProvider {
  const cfg = () => vscode.workspace.getConfiguration("aviAiLocal");
  const kenh = vscode.window.createOutputChannel("AI Local — Ghost text");
  const thanh = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  thanh.command = LENH_BAT_TAT_GHOST_TEXT;
  const batTat = () => cfg().get<boolean>(KHOA_BAT_GHOST_TEXT, false) === true;
  hienThanhTrangThai(thanh, batTat());
  thanh.show();

  const provider = new GhostTextProvider({
    layToken: async () => (await context.secrets.get(KHOA_TOKEN_GATEWAY)) || undefined,
    cauHinh: () => ({
      batTat: batTat(),
      serverUrl: cfg().get<string>("serverUrl", "http://localhost:3000"),
      doTreMs: Math.min(2_000, Math.max(50, Number(cfg().get<number>(KHOA_DO_TRE_GHOST_TEXT, DO_TRE_MAC_DINH_MS)) || DO_TRE_MAC_DINH_MS)),
    }),
    thuMucWorkspace: () => (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
    ghiNhatKy: (d) => kenh.appendLine(`[${new Date().toISOString().slice(11, 19)}] ${d}`),
    khiTrangThai: (tt) => hienThanhTrangThai(thanh, batTat(), tt),
  });

  context.subscriptions.push(
    kenh,
    thanh,
    vscode.languages.registerInlineCompletionItemProvider({ scheme: "file", pattern: "**" }, provider),
    vscode.commands.registerCommand(LENH_BAT_TAT_GHOST_TEXT, async () => {
      const moi = !batTat();
      await cfg().update(KHOA_BAT_GHOST_TEXT, moi, vscode.ConfigurationTarget.Global);
      provider.datLaiLoi();
      if (!moi) provider.huyDangCho();
      hienThanhTrangThai(thanh, moi);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration("aviAiLocal")) return;
      provider.datLaiLoi();
      hienThanhTrangThai(thanh, batTat());
    }),
    context.secrets.onDidChange((e) => {
      if (e.key !== KHOA_TOKEN_GATEWAY) return;
      provider.datLaiLoi();
      hienThanhTrangThai(thanh, batTat());
    }),
  );
  return provider;
}
