/**
 * ★★★ Pha 3 Task 4 (§6) — NHẬN NUÔI GIẤY PHÉP MỒ CÔI + DỌN HÀNG CỦA TIẾN TRÌNH ĐÃ CHẾT.
 * **Module LÁ: chỉ `import type`, không I/O, thuần và đồng bộ.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * BA DÂN SỐ, VÀ CHÚNG LÀ **CÙNG MỘT BÀI TOÁN**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   1. **Hàng MA** — `kill -9` một tiến trình để lại hàng của nó trong `vram_leases` **vĩnh viễn**
 *      (nợ Task 2). Anh em trừ dư địa cho một khối byte KHÔNG TỒN TẠI, mãi mãi.
 *   2. **Hàng `vram:baseline` của tiến trình đã chết** — nằm lại tới 180 s (`sharedBaselineTtlMs`)
 *      trước khi ai đó giành được vai người chụp (nợ Task 3). Cùng cơ chế, dọn sớm hơn.
 *   3. **Sidecar sống sót qua một lượt khởi động lại** (§6, hộ 7,8 GB) — *sổ mất, thực tế còn*.
 *      Đây là chiều NGƯỢC của (1): tiến trình chết mà **byte vẫn ở trên card**, nên câu trả lời
 *      KHÔNG phải "xoá hàng" mà là **dựng lại giấy phép**.
 *
 * Cả ba đều hỏi đúng một câu: **"tiến trình đứng tên khối byte này còn sống không?"** — nên chúng
 * dùng đúng MỘT vị từ (`trangThaiTienTrinh`), không phải ba bản sao (ràng buộc 12).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ `bootMs` LÀ **ĐIỀU KIỆN**, KHÔNG PHẢI TRANG TRÍ — VÌ HĐH **CẤP LẠI PID**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Một `worker` chết rồi một tiến trình khác nhận đúng PID đó sẽ **NUỐT HÀNG của người đã chết**:
 * hàng MA trở thành "hàng của một tiến trình đang sống" và không bao giờ bị dọn; tệ hơn, một
 * giấy phép nhận nuôi sẽ được gán cho `notepad.exe`. Task 2 đã trả giá đúng chỗ này: hai đột biến
 * (lọc bằng **role**, và lọc bằng **pid** BỎ `bootMs`) **cùng sống sót 590/590**.
 *
 * BẰNG CHỨNG DÙNG ĐỂ PHÂN BIỆT LÀ `Win32_Process.CreationDate` — **đúng bằng chứng Pha 2B đã dựng**
 * (`ProcTableRow.ctime`, xem `vramGpuHolders.pruneUnprovenParentLinks`), không dựng đường thứ hai:
 *
 *     tiến trình mang PID `p` HÔM NAY là NGƯỜI ĐÃ VIẾT hàng  ⇔  ctime(p) ≤ bootMs
 *
 * Vì sao vế phải là một **bằng chứng đầy đủ** chứ không phải một phỏng đoán:
 *   • CHIỀU THUẬN — nếu vẫn là chính nó thì nó được sinh ra TRƯỚC khi nó đóng dấu `bootMs`
 *     (`bootMs = Date.now()` lúc nạp module, luôn SAU lúc tiến trình sinh) ⇒ luôn thoả. Không có
 *     âm tính giả.
 *   • CHIỀU NGHỊCH — nếu PID đã được cấp lại thì tiến trình mới sinh ra **sau khi người cũ chết**,
 *     mà người cũ chết **sau** khi đóng dấu `bootMs` ⇒ `ctime > bootMs` ⇒ bị bắt. Không có dương
 *     tính giả.
 *
 * ⚠ `ctime === 0` (không đủ quyền đọc `CreationDate`) ⇒ **KHÔNG CÓ BẰNG CHỨNG** ⇒ `"khong-biet"`,
 * và người gọi phải đối xử với nó như *"còn sống"* cho MỌI hành động phá huỷ. Đây là chiều AN
 * TOÀN theo ràng buộc 8: xoá nhầm một hàng còn sống làm anh em tính **THIẾU** byte ⇒ **NỚI** dư
 * địa; để lại một hàng ma thì chỉ CHẶT hơn, và nhịp sau thử lại.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ VÌ SAO VỊ TỪ NÀY **KHÔNG** ĐƯỢC DÙNG CHO HỘ CÓ `proc` (bài học Task 1, và là chỗ nguy hiểm
 * nhất của cả Pha 3)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Task 1 đo được: mã thoát đóng dấu ~**16 ms**, `nvidia-smi` về nền **≤33 ms**, nhưng Node phát
 * `"exit"` ở ~**560 ms** — **lệch 543 ms**, và bản chứng loại trừ libuv (tiến trình con KHÔNG GPU
 * chỉ lệch 3,4-4,1 ms). Nguyên nhân là ngữ nghĩa `TerminateProcess`.
 * ⇒ Task 4 đẻ ra **NGƯỜI ĐỌC THỨ HAI** của vị từ *"còn sống"*, và hai người đọc lệch nhau 543 ms
 * trên chính hộ 7,8 GB. Ranh giới **BẮT BUỘC**:
 *   • hộ **CÓ `proc`** (sidecar do CHÍNH tiến trình này sinh ra) — dùng `MocCaiChet` của
 *     `llamaVisionSidecar`. **Module này KHÔNG được chạm vào chúng**: giấy phép của chúng nằm
 *     trong sổ CỤC BỘ với `owner` KHÔNG mang dấu nhận nuôi, nên `pidTuOwnerNhanNuoi()` trả `null`
 *     và chúng rơi ra ngoài mọi phép quét ở đây theo CẤU TRÚC.
 *   • hộ **MỒ CÔI THẬT** (không có `proc` vì tiến trình sinh ra nó đã chết) — chỉ chúng mới đi
 *     qua phép dò PID dưới đây.
 */
import type { GpuHolder, ProcTableRow } from "./vramGpuHolders";
import type { SharedLeaseRow } from "./vramSharedLedger";
import { SHARED_BASELINE_KEY } from "./vramSharedLedger";

/**
 * ⚠ BA giá trị, KHÔNG PHẢI `boolean`. `"khong-biet"` là một câu trả lời KHÁC HẲN `"song"`: nó
 * nói *"ta không có bằng chứng"*, và mọi hành động phá huỷ phải dừng ở đó. Ép về `boolean` là
 * đúng lớp lỗi *"`null` bị đọc thành 0"* mà cả module VRAM tồn tại để diệt.
 */
export type TrangThaiTienTrinh = "song" | "chet" | "khong-biet";

/** FILETIME UTC (100 ns kể từ 1601-01-01) → Unix ms. `0`/rác ⇒ `null` = KHÔNG CÓ BẰNG CHỨNG. */
export function ctimeSangUnixMs(ctime: number): number | null {
  if (!Number.isFinite(ctime) || ctime <= 0) return null;
  const ms = ctime / 10_000 - 11_644_473_600_000;
  return Number.isFinite(ms) ? ms : null;
}

/**
 * ★ Pha 10 Task 1 — **BẢN TÁCH `processKey` DUY NHẤT.** Trước đây phép tách nằm CHÌM trong
 * `trangThaiTienTrinh()`; nay kênh phụ (`vramProcessPresence`) cũng cần đúng con số `pid` ấy, và
 * hai bản tách viết tay ở hai chỗ là đúng thứ ràng buộc 12 cấm.
 *
 * ⚠ ĐÒI ĐỦ BA PHẦN `${role}:${pid}:${bootMs}` — một `processKey` thiếu `bootMs` (dạng cũ, hoặc
 * test tự đặt) KHÔNG được rơi xuống phép so bằng pid: đó đúng là đột biến đã sống sót 590/590 ở
 * Pha 3 Task 2.
 */
export function tachProcessKey(processKey: string): { readonly pid: number; readonly bootMs: number } | null {
  const phan = String(processKey).split(":");
  if (phan.length < 3) return null;
  const pid = Number(phan[1]);
  const bootMs = Number(phan[2]);
  if (!Number.isFinite(pid) || !Number.isFinite(bootMs)) return null;
  return { pid, bootMs };
}

/**
 * ★★★ VỊ TỪ DÙNG CHUNG của cả ba dân số. Thuần, đồng bộ.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ Pha 10 Task 1 — **HAI NGUỒN BẰNG CHỨNG, XẾP HẠNG, KHÔNG PHẢI HAI VỊ TỪ.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `procs` (bảng tiến trình) là nguồn **ĐẦY ĐỦ**: nó trả lời được cả *"vắng mặt"* lẫn *"PID đã cấp
 * lại"* (nhờ `CreationDate`). Khi có nó, **không gì khác được hỏi** — hàm chạy y như trước Pha 10.
 *
 * `pidVangMat` là nguồn **MỘT NỬA**, chỉ dùng khi nguồn đầy đủ **CÂM** (`procs === null`). Nó chỉ
 * khẳng định được *"PID này không tồn tại"* ⇒ chỉ đẻ ra được `"chet"` hoặc `"khong-biet"`, **không
 * bao giờ** `"song"`. Vì sao điều đó là an toàn theo CẤU TRÚC: một PID còn sống luôn vắng mặt khỏi
 * tập ấy (xem `vramProcessPresence.quetPidVangMat` — tập chỉ chứa `ESRCH`), nên không có đường nào
 * để một hàng còn sống bị tuyên bố là ma.
 *
 * ⚠⚠ CHIỀU CHẶT KHÔNG ĐỔI: `procs === null` **và** không có kênh phụ ⇒ vẫn `"khong-biet"`. Bản vá
 * này KHÔNG nới lỏng vị từ — nó chỉ cho vị từ một cái tai thứ hai khi cái tai thứ nhất điếc.
 * ⚠⚠ NGƯỜI GỌI CÒN MỘT NGHĨA VỤ NỮA khi kết luận đến từ kênh phụ: **hàng rào TUỔI**
 * (`tuoiToiThieuKenhPhuMs`) — xem docstring `lapKeHoachNhanNuoi`. Hàm này cố ý KHÔNG tự lo việc
 * đó: nó không nhìn thấy `updatedAtMs` của hàng, và đọc đồng hồ trong một hàm thuần là thứ bị cấm.
 *
 * @param processKey `${role}:${pid}:${bootMs}` — đúng dạng `vramSharedLedger.sharedLedgerSelfKey()`.
 * @param procs bảng tiến trình; `null` = **KHÔNG ĐỌC ĐƯỢC** (khác hẳn "bảng rỗng").
 * @param pidVangMat PID **chứng minh được là VẮNG MẶT** qua kênh phụ; `null` = không có kênh phụ.
 */
export function trangThaiTienTrinh(
  processKey: string,
  procs: readonly ProcTableRow[] | null,
  pidVangMat: ReadonlySet<number> | null = null,
): TrangThaiTienTrinh {
  const khoa = tachProcessKey(processKey);
  if (khoa === null) return "khong-biet";
  if (procs === null) {
    // Nguồn đầy đủ CÂM ⇒ hỏi kênh phụ. Nó chỉ nói được "vắng mặt"; im lặng KHÔNG phải "còn sống".
    if (pidVangMat === null) return "khong-biet";
    return pidVangMat.has(khoa.pid) ? "chet" : "khong-biet";
  }
  const row = procs.find((p) => p.pid === khoa.pid);
  if (row === undefined) return "chet";
  const sinhLuc = ctimeSangUnixMs(row.ctime);
  // Không đọc được mốc tạo ⇒ không có bằng chứng ⇒ KHÔNG kết luận (chiều an toàn).
  if (sinhLuc === null) return "khong-biet";
  // Sinh SAU khi hàng được đóng dấu ⇒ PID đã được CẤP LẠI ⇒ người viết hàng đã chết.
  return sinhLuc > khoa.bootMs ? "chet" : "song";
}

/**
 * ★★★ DẤU NHẬN NUÔI trong cột `owner` — **BẢN DỊCH DUY NHẤT**, một người ghi, một người đọc.
 *
 * ⚠⚠ VÌ SAO PHẢI ĐI QUA `owner` CHỨ KHÔNG PHẢI MỘT CỘT MỚI: thêm cột là một lượt **DDL**, và
 * migration 0312 đã áp lên cả hai DB (cùng lý lẽ với `rowFromBaseline()` của Task 3). Và vì sao
 * nó BẮT BUỘC phải có mặt trong SỔ CHUNG chứ không chỉ trong bộ nhớ: một tiến trình anh em nhìn
 * thấy đúng hộ mồ côi đó trong `census.orphans` của **nó**, và câu hỏi *"byte của hộ này đã được
 * tính chưa"* chỉ trả lời được nếu người nhận nuôi **đứng tên công khai** theo PID.
 *
 * ⚠ `owner` là `varchar(160)` và `rowFromLease()` cắt tại đó — chuỗi này dài ~30 ký tự, an toàn.
 */
export function ownerNhanNuoi(pid: number): string {
  return `sidecar:vision#nhan-nuoi-pid=${Math.trunc(pid)}`;
}

/** Chiều ngược lại. `null` ⇔ `owner` này KHÔNG phải một giấy phép nhận nuôi. */
export function pidTuOwnerNhanNuoi(owner: string): number | null {
  const m = /#nhan-nuoi-pid=(\d+)$/.exec(String(owner));
  if (m === null) return null;
  const pid = Number(m[1]);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

/**
 * MÔ TẢ HỘ MỒ CÔI MÀ HỆ NÀY BIẾT CÁCH NHẬN NUÔI. `null` ⇔ chưa cấu hình ⇒ **không nhận nuôi ai**.
 *
 * ⚠⚠ HÔM NAY CHỈ CÓ **MỘT** HỘ, và đó là một giới hạn CÓ CHỦ Ý phải khai: sidecar thị giác
 * (`llama-server`) là hộ duy nhất trong repo vừa **lớn** (7,8 GB — hộ lớn nhất hệ) vừa có **cổng
 * cố định đã khai** để nhận dạng. Trainer/finetune/plugin sidecar chạy lệnh TUỲ Ý theo cấu hình,
 * không có cổng, và ước lượng byte của chúng không có nguồn — nhận nuôi bằng một con số bịa là
 * đúng thứ ràng buộc "KHÔNG ĐOÁN BYTE" cấm. Chúng ở lại `orphans` và vẫn (đúng) hạ cờ nền.
 *
 * ⚠ ĐỌC `.env` MỖI LƯỢT (không đóng băng lúc nạp module) — cùng khuôn `syncTimeoutMs()`.
 * ⚠ `8081` ở đây là **BẢN SAO** mặc định của `llamaVisionSidecar.VISION_PORT`, và bản sao đó có
 * **LƯỚI ĐỐI CHIẾU** (ca `C-8`): nó so thẳng với `getVisionSidecarConfig().port`. Không nhập
 * `llamaVisionSidecar` vào đây vì module đó kéo theo `aiGgufEngine` + `fs` — một module LÁ không
 * được có cửa đó.
 */
export interface MoTaSidecarNhanNuoi {
  /** Đường dẫn ảnh thực thi đã khai (`LLAMA_SERVER_BIN`). */
  readonly binPath: string;
  /** Cổng bind — nửa còn lại của bằng chứng "cổng + PID đã biết" (§6). */
  readonly port: number;
  /** Byte sẽ ghi vào giấy phép nhận nuôi. Cùng nguồn với `visionSidecarVramRequest()`. */
  readonly bytes: number;
}

export function moTaSidecarNhanNuoi(): MoTaSidecarNhanNuoi | null {
  const bin = process.env.LLAMA_SERVER_BIN;
  if (!bin || bin.trim().length === 0) return null;
  const rawPort = Number.parseInt(process.env.LLAMA_VISION_PORT || "8081", 10);
  const port = Number.isFinite(rawPort) && rawPort > 0 ? rawPort : 8081;
  const rawMb = Number(process.env.VRAM_SIDECAR_ESTIMATE_MB ?? 7825);
  const mb = Number.isFinite(rawMb) && rawMb > 0 ? rawMb : 7825;
  return { binPath: bin.trim(), port, bytes: Math.trunc(mb) * 1024 * 1024 };
}

export interface HangMaCanXoa {
  readonly leaseKey: string;
  readonly processKey: string;
  readonly bytes: number;
}

export interface HoCanNhanNuoi {
  readonly pid: number;
  readonly name: string;
  readonly bytes: number;
}

export interface KeHoachNhanNuoi {
  /** Hàng của tiến trình **CHỨNG MINH ĐƯỢC LÀ ĐÃ CHẾT** ⇒ xoá khỏi sổ chung. */
  readonly xoaHangMa: readonly HangMaCanXoa[];
  /** Hộ mồ côi CÒN SỐNG, khớp mô tả, **chưa ai đứng tên** ⇒ dựng lại giấy phép. */
  readonly nhanNuoi: readonly HoCanNhanNuoi[];
  /**
   * ★★★ DÂN SỐ 3 — PID của hộ trong `orphans` mà **byte đã được tính** (ta hoặc một tiến trình anh
   * em CÒN SỐNG đứng tên). Người tiêu thụ DUY NHẤT: `lyDoNenKhongTin()` — xem chú thích ở đó để
   * biết vì sao một hộ như thế KHÔNG được coi là "tàn dư" nữa.
   */
  readonly pidTanDuDaCoChu: ReadonlySet<number>;
}

export interface DauVaoNhanNuoi {
  readonly selfKey: string;
  /** Hàng sổ chung KHÔNG thuộc tiến trình này + hàng nền (nếu có chủ khác). */
  readonly rows: readonly SharedLeaseRow[];
  readonly procs: readonly ProcTableRow[] | null;
  readonly orphans: readonly GpuHolder[];
  /** PID mà CHÍNH TA đã nhận nuôi (giấy phép còn sống trong sổ cục bộ). */
  readonly pidDaNhanNuoi: readonly number[];
  readonly sidecar: MoTaSidecarNhanNuoi | null;
  /**
   * ★ Pha 10 Task 1 — KÊNH BẰNG CHỨNG PHỤ. `null`/vắng ⇒ **không có kênh phụ** ⇒ hành vi y hệt
   * trước Pha 10. Chỉ được đọc khi `procs === null`.
   */
  readonly pidVangMat?: ReadonlySet<number> | null;
  /** Đồng hồ của người gọi — hàm này THUẦN nên không tự đọc. Bắt buộc khi có `pidVangMat`. */
  readonly nowMs?: number;
  /**
   * ★★ HÀNG RÀO TUỔI cho kết luận đến từ **kênh phụ** (ms). Xem docstring `lapKeHoachNhanNuoi`.
   * Vắng ⇒ dùng `TUOI_TOI_THIEU_KENH_PHU_MS`.
   */
  readonly tuoiToiThieuKenhPhuMs?: number;
}

/**
 * ★★★ Pha 10 Task 1 — **HÀNG RÀO TUỔI CHO KÊNH PHỤ. 300.000 ms = 5 PHÚT, VÀ CON SỐ CÓ NGUỒN.**
 *
 * Cửa sổ nguy hiểm của `kill(pid,0)` đã được ĐO ở Pha 3 Task 1: `ESRCH` về ở **10,9–16,6 ms**
 * trong khi byte của một tiến trình CUDA 7,8 GB chỉ thật sự rời card sau **~500 ms**. Xoá một hàng
 * trong cửa sổ ấy là **NỚI** dư địa đúng bằng byte của hàng — chiều bị cấm (ràng buộc 8).
 *
 * 5 phút = **≈600 lần** cửa sổ đó, và **5 lần** chu kỳ đối chiếu 60 s. Vì sao mốc ấy KHÔNG bỏ sót
 * hàng ma nào đáng kể: mọi tiến trình CÒN SỐNG **ghi lại toàn bộ giấy phép của mình ở MỌI lượt
 * đồng bộ 60 s** (`vramSharedLedgerStore.dungLaiTuSoCucBo`), nên một hàng đứng im 5 phút là hàng
 * mà chủ của nó đã **lỡ 5 nhịp liên tiếp**. Hàng ma thật thì đứng im **vĩnh viễn** (đo được:
 * 2 NGÀY), nên chúng vượt mốc này ngay lượt quét đầu tiên.
 *
 * ⚠ Hàng rào này CHỈ áp cho kết luận của **kênh phụ**. Bảng tiến trình đọc được thì `CreationDate`
 * là bằng chứng đầy đủ và tức thời — bắt nó chờ 5 phút là làm chậm một cơ chế vốn đã đúng.
 */
export const TUOI_TOI_THIEU_KENH_PHU_MS = 300_000;

/** So khớp đường dẫn Windows — cùng phép chuẩn hoá với `vramGpuHolders.norm()`. */
function chuan(p: string): string {
  return String(p).trim().toLowerCase().replace(/\//g, "\\");
}

/**
 * ★★★ MỘT LƯỢT LẬP KẾ HOẠCH. **THUẦN** — không I/O, không tác dụng phụ, không đọc đồng hồ.
 * Tất cả bằng chứng đi vào bằng tham số, nên một ca test dựng đúng bảng tiến trình là dựng đúng
 * thế giới mà mã sản xuất thấy.
 */
export function lapKeHoachNhanNuoi(input: DauVaoNhanNuoi): KeHoachNhanNuoi {
  const { selfKey, rows, procs, orphans, pidDaNhanNuoi, sidecar } = input;
  const pidVangMat = input.pidVangMat ?? null;
  const tuoiToiThieu = input.tuoiToiThieuKenhPhuMs ?? TUOI_TOI_THIEU_KENH_PHU_MS;

  const trangThai = new Map<string, TrangThaiTienTrinh>();
  const traTrangThai = (key: string): TrangThaiTienTrinh => {
    let t = trangThai.get(key);
    if (t === undefined) {
      t = trangThaiTienTrinh(key, procs, pidVangMat);
      trangThai.set(key, t);
    }
    return t;
  };

  /**
   * ★★★ Pha 10 Task 1 — HÀNG RÀO TUỔI, và nó CHỈ chắn kết luận của **kênh phụ**.
   *
   * ⚠⚠ `nowMs` không hữu hạn (người gọi quên truyền) ⇒ **KHÔNG XOÁ**. Đây là chỗ dễ đẻ ra một
   * `?? Date.now()` "cho tiện", và cái `??` đó sẽ biến một hàm THUẦN thành một hàm đọc đồng hồ —
   * đúng thứ docstring của hàm này cấm, và cũng đúng lớp lỗi *"`?? mặc_định` nuốt một câu trả lời
   * đã có"*. Thà không dọn còn hơn dọn theo một cái đồng hồ không ai kiểm được.
   */
  const duCuChoKenhPhu = (r: SharedLeaseRow): boolean => {
    if (procs !== null) return true; // bằng chứng ĐẦY ĐỦ ⇒ không phải chờ ai
    const now = input.nowMs;
    if (typeof now !== "number" || !Number.isFinite(now)) return false;
    if (!Number.isFinite(r.updatedAtMs)) return false;
    return now - r.updatedAtMs >= tuoiToiThieu;
  };

  const xoaHangMa: HangMaCanXoa[] = [];
  const pidTanDuDaCoChu = new Set<number>(pidDaNhanNuoi);
  for (const r of rows) {
    // ⚠ HÀNG CỦA CHÍNH TA KHÔNG BAO GIỜ ĐI QUA ĐÂY. Sổ CỤC BỘ là chủ về giấy phép của tiến trình
    // này (xem `vramSharedLedger`, khối "bằng chứng đã nhả"); một lượt tự xoá dựa trên bảng tiến
    // trình là dựng người đọc thứ hai của chính vị từ mà `release()` đã trả lời dứt khoát.
    if (r.processKey === selfKey) continue;
    const t = traTrangThai(r.processKey);
    if (t === "chet" && duCuChoKenhPhu(r)) {
      xoaHangMa.push({ leaseKey: r.leaseKey, processKey: r.processKey, bytes: r.bytes });
      continue;
    }
    // Chủ CÒN SỐNG (hoặc chưa chứng minh được là đã chết, hoặc CHƯA ĐỦ CŨ để tin kênh phụ) ⇒ hộ mà
    // hàng này đứng tên ĐÃ CÓ CHỦ.
    // ⚠ Hàng nền (`vram:baseline`) không bao giờ mang dấu nhận nuôi ⇒ `null` ⇒ rơi ra ngoài.
    const pid = pidTuOwnerNhanNuoi(r.owner);
    if (pid !== null) pidTanDuDaCoChu.add(pid);
  }

  const nhanNuoi: HoCanNhanNuoi[] = [];
  if (sidecar !== null && procs !== null) {
    const bin = chuan(sidecar.binPath);
    const dauCong = `--port ${sidecar.port}`;
    for (const h of orphans) {
      if (pidTanDuDaCoChu.has(h.pid)) continue;
      const row = procs.find((p) => p.pid === h.pid);
      // Hộ không còn trong bảng tiến trình ⇒ nó vừa chết ⇒ không có gì để nhận nuôi.
      if (row === undefined) continue;
      const cmd = chuan(row.cmdline ?? "");
      // ⚠ HAI VẾ, ĐỦ CẢ HAI (§6: *"cổng + PID đã biết"*). Chỉ khớp ảnh thực thi là chưa đủ: một
      // `llama-server` do người khác chạy trên máy này cũng khớp, và nhận nuôi nó là khai một
      // khối byte của người lạ thành của ta.
      const khopAnh = chuan(h.name) === bin || cmd.startsWith(bin) || cmd.startsWith(`"${bin}"`);
      if (!khopAnh || !cmd.includes(chuan(dauCong))) continue;
      nhanNuoi.push({ pid: h.pid, name: h.name, bytes: sidecar.bytes });
    }
  }

  return { xoaHangMa, nhanNuoi, pidTanDuDaCoChu };
}

/**
 * Hàng NỀN của một tiến trình khác, quy về hình dạng `SharedLeaseRow` **chỉ với những ô mà
 * `lapKeHoachNhanNuoi()` đọc**. Bản sao đọc (`SharedLedgerReplica`) đã TÁCH hàng nền khỏi
 * `foreignLeases` (Task 3), nên không có hàm này thì dân số 2 **không có đường vào kế hoạch**.
 *
 * ⚠ MỘT bản dựng duy nhất, đặt cạnh người đọc: `vramReconciler` không được tự viết một object
 * `SharedLeaseRow` bằng tay (ràng buộc 12).
 */
export function hangNenChoKeHoach(processKey: string, bytes: number): SharedLeaseRow {
  return {
    leaseKey: SHARED_BASELINE_KEY,
    processKey,
    pid: 0,
    role: "all",
    leaseId: "smi",
    owner: "reconciler:baseline",
    leaseKind: "external-process",
    priority: "background",
    bytes,
    measured: false,
    refCount: 1,
    reclaimer: null,
    acquiredAtMs: 0,
    updatedAtMs: 0,
    /**
     * ★ Pha 7 Task 5 (B) — `[]`, **KHÔNG** `null`, và đây là một lời khẳng định chứ không phải một
     * ô cho đủ kiểu: hàng này **dựng tại chỗ** từ `processKey` + `bytes` do người gọi đưa, nó
     * **không đi qua `catO()`** và mọi ô chuỗi của nó là **hằng ngắn** (`"reconciler:baseline"`,
     * `"external-process"`, `"all"`, `"smi"`) ⇒ **không thể** bị cắt. `null` ở đây sẽ là tự khai
     * *"không biết"* về một hàng mà ta biết rõ.
     */
    identityTruncated: [],
  };
}
