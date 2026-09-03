/**
 * ★★★ ĐỢT H / TASK H2 / B2+B3 — MCP CLIENT STDIO: BẮT TAY `initialize` → `tools/list`/`tools/call`.
 *
 * Tách làm hai, CÙNG khuôn `mang/dongSse.ts` (`docLuongSse` thuần đo được bằng luồng giả /
 * `moDongSse` chỉ lo I/O thật): `chayPhienMcpNgoai` nhận một KÊNH đã mở (hàm ghi + luồng đọc) nên lưới
 * dựng luồng GIẢ mà không cần spawn tiến trình thật; `taoTienTrinhMcpNgoai` là lớp I/O thật DUY NHẤT gọi
 * `child_process.spawn`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * MÔ HÌNH "SPAWN MỖI LƯỢT GỌI, GIẾT KHI XONG" — CỐ Ý, KHÔNG PHẢI THIẾU SÓT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Không giữ một tiến trình MCP sống xuyên suốt phiên chat. Mỗi lượt gọi (`tools/list` hay
 * `tools/call`) tự spawn, bắt tay `initialize`, gửi ĐÚNG MỘT yêu cầu, đọc trả lời, rồi bị giết ở
 * `finally` của nơi gọi (`mang/mcpDieuPhoi.ts`). Đổi lấy một chút chi phí khởi động (chấp nhận
 * được — tool ngoài không phải đường nóng như gõ từng ký tự), ta có: không có registry tiến trình
 * sống phải dọn khi đóng VSCode, không trạng thái xuyên-lượt-gọi có thể trôi, và trần THỜI GIAN +
 * trần KÍCH THƯỚC (B3) áp được gọn trên ĐÚNG MỘT lượt round-trip thay vì phải theo dõi một tiến
 * trình nền sống mãi.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * TRẦN KÍCH THƯỚC LÀ TRẦN STREAMING — CHẶN TRƯỚC KHI TÍCH LUỸ THÀNH CHUỖI KHỔNG LỒ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `TRAN_BYTE_DOC_MCP` được kiểm NGAY sau mỗi chunk đọc được, TRƯỚC khi ghép vào bộ đệm dòng — một
 * server ngoài treo hoặc phun rác (1 GB) bị CẮT ĐỨT giữa chừng, không đợi đọc hết mới cắt (khác
 * `loi/mcpAnToan.ts::catTheoTran`, cắt sau cùng trên CHUỖI ĐÃ ĐỌC XONG — hai trần khác tầng, xem
 * docblock ở đó).
 */
import { spawn } from "node:child_process";
import type { CauHinhMcpServer } from "../loi/mcpCauHinh";
import { tachDongJsonRpc, dungDongYeuCauJsonRpc, dungDongThongBaoJsonRpc, type TraLoiJsonRpcMcp } from "../loi/mcpKhungDong";

/** Trần THỜI GIAN cho một lượt round-trip (spawn → initialize → yêu cầu thật → trả lời). */
export const TRAN_MS_GOI_MCP = 15_000;
/** Trần BYTE STREAMING đọc từ stdout của MỘT lượt gọi — chặn SỚM, không đợi đọc hết. */
export const TRAN_BYTE_DOC_MCP = 2 * 1024 * 1024;

export const TEN_CLIENT_MCP = { name: "avi-ai-local-vscode", version: "0.1.0" } as const;
export const BAN_GIAO_THUC_MCP = "2025-06-18";

export interface KetQuaGoiMcp {
  ok: boolean;
  ketQua?: unknown;
  loi?: string;
  hetGio?: boolean;
  vuotTranKichThuoc?: boolean;
}

/**
 * ★★★ Lõi THUẦN-I/O có thể lưới bằng luồng GIẢ: nhận một kênh (`ghi` + `dongDoc`) ĐÃ MỞ, tự bắt
 * tay `initialize` → `notifications/initialized` → yêu cầu thật (`method`/`params`), trả về kết
 * quả của yêu cầu thật đó (KHÔNG phải kết quả `initialize`).
 *
 * ★ Xử lý ĐÚNG hai trần B3: hết `tranMs` ⇒ `hetGio:true`; vượt `tranByte` ⇒ `vuotTranKichThuoc:true`
 * — cả hai đường đều trả về (không ném), để nơi gọi biến chúng thành một dòng "KẾT QUẢ TỪ..." bình
 * thường trong vòng lặp, không phải một ngoại lệ làm rớt cả lượt hỏi của người dùng.
 */
export async function chayPhienMcpNgoai(dv: {
  ghi: (s: string) => void;
  dongDoc: AsyncIterable<string | Buffer>;
  method: string;
  params: Record<string, unknown>;
  tranMs?: number;
  tranByte?: number;
}): Promise<KetQuaGoiMcp> {
  const tranMs = dv.tranMs ?? TRAN_MS_GOI_MCP;
  const tranByte = dv.tranByte ?? TRAN_BYTE_DOC_MCP;
  const hetHanLuc = Date.now() + tranMs;

  const ID_INIT = 1;
  const ID_GOI = 2;
  dv.ghi(
    dungDongYeuCauJsonRpc(ID_INIT, "initialize", {
      protocolVersion: BAN_GIAO_THUC_MCP,
      capabilities: {},
      clientInfo: TEN_CLIENT_MCP,
    }),
  );

  let dem = "";
  let tongByte = 0;
  let ketQuaGoi: TraLoiJsonRpcMcp | undefined;
  const it = dv.dongDoc[Symbol.asyncIterator]();

  for (;;) {
    const conLaiMs = hetHanLuc - Date.now();
    if (conLaiMs <= 0) return { ok: false, loi: "hết thời gian chờ MCP server trả lời", hetGio: true };

    // Đua giữa "đọc được chunk kế tiếp" và "hết thời gian còn lại" — `for await` trần không cắt
    // được giữa chừng khi bên kia không bao giờ đóng luồng (server treo, không lỗi, không đóng).
    const KET_QUA_TIMEOUT = Symbol("timeout");
    const buoc = await Promise.race([
      it.next(),
      new Promise<typeof KET_QUA_TIMEOUT>((r) => setTimeout(() => r(KET_QUA_TIMEOUT), conLaiMs)),
    ]);
    if (buoc === KET_QUA_TIMEOUT) return { ok: false, loi: "hết thời gian chờ MCP server trả lời", hetGio: true };
    if (buoc.done) return { ok: false, loi: "MCP server đóng kết nối trước khi trả lời xong" };

    const chunkStr = typeof buoc.value === "string" ? buoc.value : buoc.value.toString("utf8");
    tongByte += Buffer.byteLength(chunkStr, "utf8");
    if (tongByte > tranByte) {
      return {
        ok: false,
        loi: `MCP server trả về vượt trần kích thước (${tranByte} byte) — đã huỷ đọc`,
        vuotTranKichThuoc: true,
      };
    }

    const r = tachDongJsonRpc(dem, chunkStr);
    dem = r.du;
    for (const td of r.thongDiep) {
      if (td.id === ID_INIT) {
        if (td.error) return { ok: false, loi: `initialize thất bại: ${td.error.message}` };
        // Bắt tay xong ⇒ báo đã sẵn sàng rồi gửi NGAY yêu cầu thật — đúng thứ tự chuẩn MCP.
        dv.ghi(dungDongThongBaoJsonRpc("notifications/initialized"));
        dv.ghi(dungDongYeuCauJsonRpc(ID_GOI, dv.method, dv.params));
      } else if (td.id === ID_GOI) {
        ketQuaGoi = td;
      }
    }
    if (ketQuaGoi) break;
    // Dòng rác/JSON hỏng (`r.dongRac`) bị BỎ QUA lặng lẽ ở tầng này — đúng bài học B2: một dòng lạ
    // không được làm sập phiên; vòng lặp tiếp tục chờ dòng hợp lệ tới trong trần thời gian còn lại.
  }

  if (ketQuaGoi.error) return { ok: false, loi: ketQuaGoi.error.message };
  return { ok: true, ketQua: ketQuaGoi.result };
}

export interface KenhTienTrinhMcp {
  ghi: (s: string) => void;
  dongDoc: AsyncIterable<Buffer>;
  dong: () => void;
}

/**
 * ★★★ LỚP I/O THẬT DUY NHẤT gọi `child_process.spawn` cho MCP client. Không unit-test trực tiếp
 * (cùng lý do `moDongSse` không lưới `fetch` thật) — `chayPhienMcpNgoai` ở trên mang hết logic đáng đo.
 *
 * ⚠ `windowsHide: true` — máy dev Windows không cần một cửa sổ console nháy lên cho mỗi lượt gọi.
 * ⚠ `stderr` bị BỎ (không pipe ra đâu) — đây là kênh LỜI KỂ của tiến trình con (như `ke()` phía
 *   `mcpServer.ts`), không phải giao thức; không đọc nó vẫn an toàn (không rò gì thêm), chỉ mất
 *   thông tin gỡ lỗi. Không được đọc nó rồi TRỘN vào kết quả tool — đó sẽ là đường lẫn lộn giao
 *   thức với lời kể, đúng bài học "stdout LÀ ĐƯỜNG ỐNG GIAO THỨC" của `mcpServer.ts`.
 */
export function taoTienTrinhMcpNgoai(cfg: CauHinhMcpServer): KenhTienTrinhMcp {
  const cp = spawn(cfg.lenh, cfg.doi, {
    cwd: cfg.thuMuc,
    env: { ...process.env, ...cfg.moi },
    stdio: ["pipe", "pipe", "ignore"],
    windowsHide: true,
  });
  cp.on("error", () => {
    // Tiến trình không spawn được (lệnh không tồn tại…) — `chayPhienMcpNgoai` tự phát hiện qua đóng
    // luồng/timeout, không cần xử lý gì thêm ở đây ngoài việc KHÔNG để lỗi này thoát thành một
    // "unhandled error event" làm sập extension host.
  });
  return {
    ghi: (s: string) => {
      try {
        cp.stdin.write(s);
      } catch {
        // Tiến trình có thể đã chết giữa chừng — `chayPhienMcpNgoai` sẽ tự phát hiện qua đóng luồng đọc.
      }
    },
    dongDoc: cp.stdout,
    dong: () => {
      try {
        cp.kill();
      } catch {
        // đã chết sẵn — vô hại
      }
    },
  };
}
