/**
 * ★★★ ĐỢT H / TASK H2 / B5 — GIAO DIỆN QUẢN LÝ MCP SERVER NGOÀI.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * QUYẾT ĐỊNH PHẠM VI: LỆNH + QuickPick, KHÔNG PHẢI WEBVIEW MỚI — GHI RÕ LÝ DO
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Kế hoạch B5 gợi ý "icon SVG nội tuyến" — đúng khuôn G1/G2 đã chốt cho `ui/htmlBang.ts` (webview
 * CSP không có `font-src`, không nạp được font codicon). Tệp NÀY cố ý ĐI ĐƯỜNG KHÁC: một lệnh
 * Command Palette dùng `vscode.window.showQuickPick` — cùng khuôn `moLichSu()`/`thucHienDangNhap()`
 * đã có trong `bangChat.ts`. Ba lý do đo được, không phải ngại việc:
 *   1. `ui/htmlBang.ts` (651 dòng) là bề mặt CSP + nonce ĐÃ ĐƯỢC REVIEW KỸ và có lưới riêng
 *      (`htmlBang.unit.test.ts`) khẳng định từng chi tiết markup tĩnh — chèn thêm một khối UI liệt
 *      kê/bật-tắt/xem-tool vào ĐÓ là rủi ro hồi quy trên một tệp vốn đã dày đặc.
 *   2. QuickPick là UI NGƯỜI DÙNG VSCode CÓ SẴN cho "chọn/bật/tắt" — codicon `$(...)` chạy được
 *      TRỰC TIẾP (không phải webview, không bị CSP chặn font), không cần SVG nội tuyến.
 *   3. B5 không nằm trên đường NÓNG (gõ từng câu hỏi) — một lệnh riêng, giống hệt cách "Lịch sử"
 *      hoạt động, không mất tính năng nào kế hoạch đòi (liệt kê/bật-tắt/xem tool).
 * Nếu chủ dự án muốn hợp nhất vào khung chat sau này, mọi HÀM LÕI (`layDanhSachToolMcpNgoai`,
 * `datBatTatMcpNgoai`, `xinPhepNeuCan`) đã tách sẵn ở `mang/mcpDieuPhoi.ts` — chỉ cần viết một lớp
 * vẽ mới, không phải viết lại logic.
 */
import * as vscode from "vscode";
import {
  phuThuocThat,
  layDanhSachToolMcpNgoai,
  datBatTatMcpNgoai,
  datDsToolMcpDangCoSan,
  dsToolMcpDangCoSan,
  type PhuThuocDieuPhoiMcp,
} from "../mang/mcpDieuPhoi";
import { biTat, daDuocDuyet } from "../loi/mcpDuyet";
import type { CauHinhMcpServer } from "../loi/mcpCauHinh";

function nhanTrangThai(pt: PhuThuocDieuPhoiMcp, cfg: CauHinhMcpServer): string {
  const kho = pt.docTrangThai();
  if (biTat(kho, cfg.ten)) return "TẮT";
  return daDuocDuyet(kho, cfg) ? "đã duyệt" : "chưa từng kết nối";
}

async function chayLamMoi(pt: PhuThuocDieuPhoiMcp): Promise<void> {
  const ds = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "AI Local: đang kết nối MCP server ngoài…" },
    () => layDanhSachToolMcpNgoai(pt),
  );
  datDsToolMcpDangCoSan(ds);
  const soLoi = ds.filter((t) => t.loi).length;
  const soTool = ds.length - soLoi;
  const chiTietLoi = ds
    .filter((t) => t.loi)
    .map((t) => `${t.server}: ${t.loi}`)
    .join("\n");
  const chonSauKhiBao = await vscode.window.showInformationMessage(
    `AI Local: đã làm mới — ${soTool} tool sẵn sàng cho vòng tác nhân` +
      (soLoi > 0 ? `, ${soLoi} server lỗi.` : "."),
    ...(soLoi > 0 ? (["Xem lỗi"] as const) : []),
  );
  if (chonSauKhiBao === "Xem lỗi") void vscode.window.showErrorMessage(chiTietLoi);
}

async function chayBatTat(pt: PhuThuocDieuPhoiMcp, cfg: CauHinhMcpServer): Promise<void> {
  const dangTat = biTat(pt.docTrangThai(), cfg.ten);
  await datBatTatMcpNgoai(pt, cfg.ten, !dangTat);
  void vscode.window.showInformationMessage(`AI Local: server "${cfg.ten}" đã ${dangTat ? "BẬT" : "TẮT"}.`);
}

/**
 * ★★★ LỐI VÀO DUY NHẤT của B5 — đăng ký ở `extension.ts` dưới lệnh `aviAiLocal.mcpServers`.
 */
export async function chayQuanLyMcpNgoai(context: vscode.ExtensionContext): Promise<void> {
  const pt = phuThuocThat(context);
  const cauHinh = pt.docCauHinh();
  if (cauHinh.length === 0) {
    void vscode.window.showInformationMessage(
      "AI Local: chưa có MCP server ngoài nào trong cấu hình máy — thêm vào " +
        '"aviAiLocal.mcpServers" (User Settings, phạm vi Máy) theo khuôn mcpServers quen thuộc: ' +
        '{ "tên-server": { "command": "npx", "args": ["-y", "..."] } }.',
    );
    return;
  }

  interface MucChon extends vscode.QuickPickItem {
    hanhDong: "lam_moi" | "chon_server";
    cfg?: CauHinhMcpServer;
  }

  const dsTool = dsToolMcpDangCoSan();
  const items: MucChon[] = [
    {
      label: "$(sync) Kết nối / làm mới danh sách tool",
      detail: "Chạy tools/list cho mọi server đang BẬT — có thể hiện hộp thoại duyệt cho server chưa từng kết nối.",
      hanhDong: "lam_moi",
    },
    ...cauHinh.map((cfg) => {
      const soTool = dsTool.filter((t) => t.server === cfg.ten).length;
      return {
        label: `$(plug) ${cfg.ten}`,
        description: `${nhanTrangThai(pt, cfg)}${soTool > 0 ? ` · ${soTool} tool` : ""}`,
        detail: `${cfg.lenh} ${cfg.doi.join(" ")}`,
        hanhDong: "chon_server" as const,
        cfg,
      };
    }),
  ];

  const chon = await vscode.window.showQuickPick(items, {
    placeHolder: "AI Local — MCP server ngoài: chọn một server để bật/tắt, hoặc làm mới danh sách tool",
  });
  if (!chon) return;

  if (chon.hanhDong === "lam_moi") {
    await chayLamMoi(pt);
    return;
  }

  const cfg = chon.cfg!;
  const dangTat = biTat(pt.docTrangThai(), cfg.ten);
  const dsToolCuaServer = dsTool.filter((t) => t.server === cfg.ten);
  const hanhDong = await vscode.window.showQuickPick(
    [
      { label: dangTat ? "$(check) Bật" : "$(circle-slash) Tắt", muc: "bat_tat" as const },
      ...(dsToolCuaServer.length > 0
        ? [{ label: `$(list-unordered) Xem ${dsToolCuaServer.length} tool đang có`, muc: "xem_tool" as const }]
        : []),
    ],
    { placeHolder: `Server "${cfg.ten}"` },
  );
  if (!hanhDong) return;
  if (hanhDong.muc === "bat_tat") {
    await chayBatTat(pt, cfg);
  } else {
    void vscode.window.showQuickPick(
      dsToolCuaServer.map((t) => ({ label: t.tool, detail: t.moTa })),
      { placeHolder: `Tool của server "${cfg.ten}" — chỉ xem, không chạy` },
    );
  }
}
