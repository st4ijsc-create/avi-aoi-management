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

/** Kênh "chết ngay" — `dongDoc` kết thúc KHÔNG yield gì, khớp ĐÚNG nhánh có sẵn của
 *  `chayPhienMcpNgoai` ("MCP server đóng kết nối trước khi trả lời xong", xem trên) mà mọi kiểu
 *  spawn-thất-bại khác (ENOENT không đồng bộ) đã tự nhiên rơi vào. */
async function* dongRongKhongYieldGi(): AsyncGenerator<Buffer> {
  // cố ý rỗng — kết thúc ngay ở lần `next()` đầu tiên (`done: true`).
}
function kenhChet(): KenhTienTrinhMcp {
  return { ghi: () => {}, dongDoc: dongRongKhongYieldGi(), dong: () => {} };
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
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐỢT H / TASK H4 — `spawn()` CÓ THỂ NÉM ĐỒNG BỘ, KHÔNG CHỈ BẮN SỰ KIỆN 'error'.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Đo LIVE trên Windows (nghiệm thu Task H4, `npx.cmd` — giá trị `command` NHIỀU MCP client khác
 * dùng làm mẫu Windows): `child_process.spawn("npx.cmd", ...)` KHÔNG shell:true NÉM ĐỒNG BỘ
 * `Error: spawn EINVAL` NGAY TẠI lời gọi `spawn()` — KHÁC với ENOENT (lệnh không tồn tại) vốn chỉ
 * bắn sự kiện `'error'` KHÔNG ĐỒNG BỘ (nhánh `cp.on("error", ...)` phía dưới xử lý đúng rồi). Một
 * throw đồng bộ ở đây, KHÔNG bọc try/catch, biến thành PROMISE REJECT không được bắt ở BẤT KỲ tầng
 * nào trên đường gọi thật (`mang/mcpDieuPhoi.ts#layDanhSachToolMcpNgoai`, `#goiToolMcpNgoai`,
 * `ui/mcpQuanLy.ts#chayLamMoi` — không nơi nào có try/catch quanh `goiMotPhien`/`taoTienTrinhMcpNgoai`),
 * và (khi cấu hình có NHIỀU server) làm ĐỨT NGANG vòng `for` đang duyệt các server KHÁC — một server
 * cấu hình sai làm hỏng luôn việc kiểm tra các server BẬT hợp lệ khác trong CÙNG lượt "Kết nối".
 * Vá: bọc `spawn()` trong try/catch, trả về `kenhChet()` khi ném — hành vi observable giống HỆT
 * nhánh ENOENT đã có (rơi vào "MCP server đóng kết nối trước khi trả lời xong" ở `chayPhienMcpNgoai`,
 * KHÔNG bao giờ throw ra ngoài) — không cần sửa gì ở `mcpDieuPhoi.ts`/`mcpQuanLy.ts`.
 */
export function taoTienTrinhMcpNgoai(cfg: CauHinhMcpServer): KenhTienTrinhMcp {
  // ★ TOÀN BỘ thân hàm nằm trong try (không tách `spawn()` riêng ra ngoài rồi gán vào biến `let`
  //   khai kiểu tay) — giữ NGUYÊN cách TypeScript suy luận kiểu overload hẹp
  //   `ChildProcessWithoutNullStreams` (stdin/stdout KHÔNG `null`) từ đúng object `stdio` truyền vào
  //   lời gọi trực tiếp; một `let cp: ReturnType<typeof spawn>` khai riêng sẽ rơi về overload rộng
  //   nhất (`ChildProcess`, stdin/stdout CÓ THỂ `null`) và làm `tsc` đỏ ở `cp.stdin.write`/`cp.stdout`.
  try {
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
  } catch {
    return kenhChet();
  }
}
