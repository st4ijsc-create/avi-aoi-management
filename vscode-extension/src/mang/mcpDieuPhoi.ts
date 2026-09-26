/**
 * ★★★ ĐỢT H / TASK H2 — ĐIỀU PHỐI MCP CLIENT: HÀNG RÀO DUYỆT + GỌI + ĐỊNH DẠNG, ĐÚNG MỘT CỬA.
 *
 * `xinPhepNeuCan` là CỬA DUY NHẤT trước khi bất kỳ tiến trình MCP nào được spawn — cả
 * `layDanhSachToolMcpNgoai` (B5: lấy danh sách tool để hiển thị/dạy) lẫn `goiToolMcpNgoai` (vòng tác nhân:
 * model yêu cầu gọi một tool) đều đi qua ĐÚNG một hàm này, không có cổng thứ hai. NHÁNH KIA
 * (kế hoạch đòi rõ): người dùng bấm "Từ chối" ⇒ `xinPhepNeuCan` trả `{ok:false}` NGAY, và
 * `goiMotPhien` (nơi DUY NHẤT chạm `taoTienTrinhMcpNgoai`/`child_process.spawn`) KHÔNG BAO GIỜ được gọi
 * trên nhánh đó — lưới `mcpDieuPhoi.unit.test.ts` đếm số lần `goiMotPhien` (bản giả) được gọi để
 * khẳng định đúng con số 0 ở nhánh từ chối.
 *
 * ★★★ TIÊM PHỤ THUỘC (`PhuThuocDieuPhoiMcp`) thay vì `import "vscode"` TRỰC TIẾP trong logic hàng
 * rào: cho phép lưới đo đúng CỐT LÕI an toàn (duyệt/từ chối/bật-tắt/định dạng) bằng bản GIẢ, không
 * cần mock cả module `vscode`. `phuThuocThat` ở cuối tệp là RANH GIỚI DUY NHẤT nơi `vscode` chạm
 * vào — nó không tự thêm logic, chỉ bọc `vscode.workspace.getConfiguration`/`globalState`/
 * `showWarningMessage`/`mang/mcpClient.ts` thành đúng hình dạng phụ thuộc.
 *
 * ★★★ NHỚ QUYẾT ĐỊNH THEO MÁY: `phuThuocThat` ghi vào `context.globalState` (KHÔNG
 * `workspaceState`, không bật `setKeysForSync`) — xem lý lẽ ở `loi/mcpDuyet.ts`.
 */
import * as vscode from "vscode";
import { docCauHinhMcpServers, type CauHinhMcpServer } from "../loi/mcpCauHinh";
import { chuanHoaKhoTrangThaiMcpNgoai, daDuocDuyet, biTat, ghiDaDuyet, datTat, type KhoTrangThaiMcp } from "../loi/mcpDuyet";
import { dinhDangKetQuaMcpNgoai } from "../loi/mcpAnToan";
import type { YeuCauMcp } from "../loi/yeuCauMcp";
import type { MoTaToolMcp } from "../loi/dayMcpDoc";
import { chayPhienMcpNgoai, taoTienTrinhMcpNgoai, TRAN_MS_GOI_MCP, TRAN_BYTE_DOC_MCP, type KetQuaGoiMcp } from "./mcpClient";

export const KHOA_TRANG_THAI_MCP = "aviAiLocal.mcpTrangThai";

export interface PhuThuocDieuPhoiMcp {
  docCauHinh(): CauHinhMcpServer[];
  docTrangThai(): KhoTrangThaiMcp;
  ghiTrangThai(kho: KhoTrangThaiMcp): Promise<void>;
  /** Hỏi người dùng "Cho phép"/"Từ chối" spawn tiến trình của server này lần đầu. `true` = Cho phép. */
  hoiDuyet(cfg: CauHinhMcpServer): Promise<boolean>;
  /** Nơi DUY NHẤT được phép spawn (qua `mang/mcpClient.ts`) — chỉ gọi SAU khi `xinPhepNeuCan` ok. */
  goiMotPhien(cfg: CauHinhMcpServer, method: string, params: Record<string, unknown>): Promise<KetQuaGoiMcp>;
}

export async function xinPhepNeuCan(
  pt: PhuThuocDieuPhoiMcp,
  cfg: CauHinhMcpServer,
): Promise<{ ok: true } | { ok: false; lyDo: string }> {
  const kho = pt.docTrangThai();
  if (biTat(kho, cfg.ten)) {
    return { ok: false, lyDo: `server "${cfg.ten}" đang TẮT — bật lại ở lệnh "AI Local: Quản lý MCP server ngoài"` };
  }
  if (daDuocDuyet(kho, cfg)) return { ok: true };

  const choPhep = await pt.hoiDuyet(cfg);
  if (!choPhep) {
    return {
      ok: false,
      lyDo: `người dùng TỪ CHỐI cho phép chạy server MCP "${cfg.ten}" — KHÔNG có tiến trình nào được khởi động`,
    };
  }
  await pt.ghiTrangThai(ghiDaDuyet(kho, cfg));
  return { ok: true };
}

/** B5 — danh sách tool của MỌI server đã cấu hình + BẬT (server tắt bị bỏ qua lặng lẽ, không phải lỗi). */
export async function layDanhSachToolMcpNgoai(pt: PhuThuocDieuPhoiMcp): Promise<Array<MoTaToolMcp & { loi?: string }>> {
  const ra: Array<MoTaToolMcp & { loi?: string }> = [];
  for (const cfg of pt.docCauHinh()) {
    if (biTat(pt.docTrangThai(), cfg.ten)) continue;
    const phep = await xinPhepNeuCan(pt, cfg);
    if (!phep.ok) {
      ra.push({ server: cfg.ten, tool: "", moTa: "", loi: phep.lyDo });
      continue;
    }
    const kq = await pt.goiMotPhien(cfg, "tools/list", {});
    if (!kq.ok) {
      ra.push({ server: cfg.ten, tool: "", moTa: "", loi: kq.loi ?? "không lấy được danh sách tool" });
      continue;
    }
    const tools = (kq.ketQua as { tools?: Array<{ name?: unknown; description?: unknown }> } | undefined)?.tools ?? [];
    for (const t of tools) {
      if (typeof t.name === "string") {
        ra.push({ server: cfg.ten, tool: t.name, moTa: typeof t.description === "string" ? t.description : "" });
      }
    }
  }
  return ra;
}

/**
 * Vòng tác nhân gọi hàm này khi model phát một khối `mcp_goi`. TRẢ VỀ CHUỖI ĐÃ ĐỊNH DẠNG QUA
 * `dinhDangKetQuaMcpNgoai` (B3+B4: che bí mật, vô hiệu hoá avi-tool giả mạo, cắt theo trần) — KHÔNG BAO
 * GIỜ trả nguyên văn kết quả tool.
 */
export async function goiToolMcpNgoai(pt: PhuThuocDieuPhoiMcp, yc: YeuCauMcp): Promise<string> {
  const cfg = pt.docCauHinh().find((c) => c.ten === yc.server);
  if (!cfg) {
    return dinhDangKetQuaMcpNgoai({
      server: yc.server,
      tool: yc.tool,
      loi: true,
      vanBanTho: `không có server MCP tên "${yc.server}" trong cấu hình máy (aviAiLocal.mcpServers)`,
    });
  }

  const phep = await xinPhepNeuCan(pt, cfg);
  if (!phep.ok) return dinhDangKetQuaMcpNgoai({ server: yc.server, tool: yc.tool, loi: true, vanBanTho: phep.lyDo });

  const kq = await pt.goiMotPhien(cfg, "tools/call", { name: yc.tool, arguments: yc.dauVao });
  if (!kq.ok) {
    return dinhDangKetQuaMcpNgoai({ server: yc.server, tool: yc.tool, loi: true, vanBanTho: kq.loi ?? "lỗi không rõ" });
  }

  const noiDung = kq.ketQua as { content?: Array<{ type?: unknown; text?: unknown }>; isError?: unknown } | undefined;
  const vanBan = (noiDung?.content ?? [])
    .filter((c): c is { type: string; text: string } => !!c && c.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n");
  return dinhDangKetQuaMcpNgoai({
    server: yc.server,
    tool: yc.tool,
    loi: noiDung?.isError === true,
    vanBanTho: vanBan.length > 0 ? vanBan : "(tool không trả nội dung văn bản)",
  });
}

/** B5 — bật/tắt một server, KHÔNG đụng cờ đã-duyệt (xem `loi/mcpDuyet.ts::datTat`). */
export async function datBatTatMcpNgoai(pt: PhuThuocDieuPhoiMcp, ten: string, tat: boolean): Promise<void> {
  await pt.ghiTrangThai(datTat(pt.docTrangThai(), ten, tat));
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// BỘ NHỚ ĐỆM "ĐÃ KẾT NỐI" — nguồn cho văn bản dạy giao thức (`bangChat.ts#hoi`).
// ══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ KHÔNG tự động nạp khi mở khung chat — chỉ B5 ("AI Local: Quản lý MCP server ngoài", nơi
// người dùng CHỦ Ý bấm "Kết nối/làm mới") mới gọi `datDsToolMcpDangCoSan`. Xem lý do ở docblock
// `loi/dayMcpDoc.ts`: nạp ngầm mỗi câu hỏi sẽ vừa chậm (spawn tiến trình) vừa có thể bất ngờ bật
// hộp thoại duyệt giữa một câu hỏi không liên quan tới MCP.
let dsToolDaKetNoi: MoTaToolMcp[] = [];

export function dsToolMcpDangCoSan(): readonly MoTaToolMcp[] {
  return dsToolDaKetNoi;
}

export function datDsToolMcpDangCoSan(ds: ReadonlyArray<MoTaToolMcp & { loi?: string }>): void {
  dsToolDaKetNoi = ds.filter((t): t is MoTaToolMcp => t.loi === undefined && t.tool !== "");
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// RANH GIỚI DUY NHẤT NƠI `vscode` CHẠM VÀO MODULE NÀY.
// ══════════════════════════════════════════════════════════════════════════════════════════════
export function phuThuocThat(context: vscode.ExtensionContext): PhuThuocDieuPhoiMcp {
  return {
    docCauHinh: () =>
      docCauHinhMcpServers(vscode.workspace.getConfiguration("aviAiLocal").get<unknown>("mcpServers", {})).danhSach,
    docTrangThai: () => chuanHoaKhoTrangThaiMcpNgoai(context.globalState.get<unknown>(KHOA_TRANG_THAI_MCP)),
    ghiTrangThai: async (kho) => {
      await context.globalState.update(KHOA_TRANG_THAI_MCP, kho);
    },
    hoiDuyet: async (cfg) => {
      const chon = await vscode.window.showWarningMessage(
        `AI Local muốn chạy tiến trình MCP server ngoài "${cfg.ten}": ${cfg.lenh} ${cfg.doi.join(" ")}` +
          `${cfg.thuMuc ? ` (thư mục: ${cfg.thuMuc})` : ""}. Đây là mã KHÔNG do ST4I kiểm soát — chỉ ` +
          `đồng ý nếu bạn tin nguồn cấu hình này (aviAiLocal.mcpServers). Quyết định được nhớ theo MÁY này.`,
        { modal: true },
        "Cho phép",
        "Từ chối",
      );
      return chon === "Cho phép";
    },
    goiMotPhien: async (cfg, method, params) => {
      const kenh = taoTienTrinhMcpNgoai(cfg);
      try {
        return await chayPhienMcpNgoai({
          ghi: kenh.ghi,
          dongDoc: kenh.dongDoc,
          method,
          params,
          tranMs: TRAN_MS_GOI_MCP,
          tranByte: TRAN_BYTE_DOC_MCP,
        });
      } finally {
        kenh.dong();
      }
    },
  };
}
