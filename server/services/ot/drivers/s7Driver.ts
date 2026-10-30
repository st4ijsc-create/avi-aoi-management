/**
 * Sprint F1.3 — Siemens S7 driver THẬT (package `nodes7`, nạp qua loadPackage()).
 *
 * NodeS7 API là callback-based + "translation" tag→address:
 *   - new NodeS7(); initiateConnection({port,host,rack,slot,timeout}, cb(err))
 *   - setTranslationCB(tag => address); addItems([...]); readAllItems(cb(anythingBad, values))
 *   - dropConnection(cb)
 * Ta promisify các callback đó. Mỗi readTags: setTranslationCB ánh xạ tagKey→địa chỉ
 * S7 (đã validate bằng parseS7Address), addItems(tagKeys), readAllItems → values{tagKey}.
 *
 * - connect: initiateConnection race timeout; thiếu lib → throw "nodes7 not installed".
 * - readTags: đọc theo địa chỉ, coerceS7Value, áp scale/offset Ở DRIVER, OtSample.
 *   NodeS7 trả giá trị BAD (null) cho item lỗi → quality:"bad" (không sập batch).
 * - subscribe: POLL setInterval gọi readTags; timer.unref(); close()=clearInterval.
 * - writeTags (F4b/G2.1): GHI THẬT qua NodeS7.writeItems(keys[],values[],cb(anyBad)).
 *   setTranslationCB như readTags; inverse scale/offset + coerce theo dataType;
 *   địa chỉ read-only (I/E/PI) → ok:false; writeItems trả 1 (busy) → ok:false
 *   "S7 write busy"; anyBadQualities → ok:false "bad write quality". ⚠️ chỉ
 *   commandDispatcher được gọi (xem comment writeTags).
 * - disconnect: dropConnection.
 * - readProgramChecksum (doc 81 Đợt 9 task T1): checksum of the user program (OB/DB/FC/FB block infos) read through the
 *   documented S7comm block functions on a SEPARATE, bounded connection — see s7BlockChecksum.ts (sources, formula,
 *   status "not verified on a real device").
 *
 * Giữ extends NotImplementedDriver, override method, tái dùng loadPackage()/packageName.
 */
import type {
  OtProtocol,
  OtDriver,
  OtConnectionConfig,
  OtTagAddress,
  OtSample,
  OtSubscriptionHandle,
  OtCommandResult,
  OtWrite,
  OtHealth,
  OnOtSample,
  ProgramChecksumResult,
  TuyChonVongPoll,
} from "../otDriver";
import { NotImplementedDriver } from "./notImplementedDriver";
import {
  parseS7Address,
  coerceS7Value,
  laLoiS7BitNgoaiDai,
  kiemDiaChiS7,
  loiItemNodes7,
  LoiS7KhongKiemDuoc,
  lopNodes7That,
  lyDoCauHinhDiaChiS7,
  MA_S7_BIT_NGOAI_DAI,
  MA_S7_DIA_CHI_THU_VIEN_BO,
  MA_S7_THU_VIEN_KHONG_KIEM_DUOC,
} from "./s7Address";
import { inverseScale, scaleXuoi } from "./otScale";
import { boolChoGhi } from "./boolNghiem";
import { DeviceUnreachableError } from "../../../_core/deviceErrors";
import { withDeadline } from "./boundedClose";
import { HAN_DU_PHONG_GHI_DRIVER_MS, LoiQuaHanYeuCauDriver, SoYeuCauDangBay, ketCucKhongRoCua, laLoiMatLienKetKhiDangGui, laLoiQuaHanYeuCauDriver } from "./dangBay";
import { taoVongPoll } from "../vongPoll";
import { hanLenhOtMacDinhMs } from "../hanLenhOt";
import { chatLuongLoiChung, chatLuongV2Bat, laMauBadThuVien, MAU_GIA_TRI_HONG } from "../chatLuong";
import { readS7ProgramChecksum, clampS7Deadline, S7_CHECKSUM_SOURCE, type S7ChecksumTarget } from "./s7BlockChecksum";

/** Ép raw (đã inverse scale) sang kiểu NodeS7 chấp nhận theo dataType. */
function coerceS7Write(raw: unknown, dataType: string, dungGhim?: boolean): number | boolean | string {
  // R1b-2b-1 T2 — MỘT luật bool (`boolChoGhi`): "false" / "0" ⇒ FALSE; ngoài tập hợp lệ ⇒ ném (write đó ok:false); STOP đã xác minh ⇒ không chặn.
  switch (dataType) {
    case "bool":
      return boolChoGhi(raw, dungGhim);
    case "int":
      return Math.round(Number(raw));
    case "float":
      return Number(raw);
    case "string":
    case "json":
    default:
      return String(raw);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms),
    ),
  ]);
}

/**
 * SCADA R1b-2b-2a T3 (mục 66, phần 2) — chuỗi errCode NGUYÊN VĂN mà nodes7 0.3.18 gắn cho item ghi khi gói ghi HẾT HẠN của thư viện
 * (`nodeS7.js:1729-1735` `processS7WriteItem(undefined)`, gọi từ `packetTimeout("write")` :277-284 ⇒ `writeResponse(undefined, …)`). Thăm dò thật
 * (quaHanGhi.thuVienThat.r1b2b2.test.ts, sim `hangWrite`): callback(true) sau ~globalTimeout, item ĐẦU của gói mang chuỗi này (`writeResponse` dừng
 * ở item đầu trả 0, :1299-1305); PLC trả mã lỗi (0x0A) ⇒ callback(true) NHANH, KHÔNG item nào mang chuỗi này (chỉ `writeResponse` = mã PLC).
 */
export const S7_ERRCODE_QUA_HAN_GHI = "We must have timed Out - we have no response to process";

/**
 * T3 — lần ghi VỪA XONG (callback `anyBadQualities === true`) có phải HẾT HẠN của thư viện với gói ĐÃ GỬI (⇒ kết cục không rõ)?
 * Bản thư viện: nodes7 0.3.18. Đọc `conn.writePacketArray[*].itemList[*]` (dựng lại MỖI lần writeItems — prepareWritePacket :665-751, item là bản
 * clone mới ⇒ không mang errCode của lần ghi trước). Đúng khi ≥ 1 item `valid === false && errCode === S7_ERRCODE_QUA_HAN_GHI` thuộc một gói
 * `timeoutError !== true`.
 *   • `timeoutError === true` ⇒ gói KHÔNG được gửi: `sendWritePacket` (:1103-1121) thấy isoConnectionState ≠ 4 ⇒ không `isoclient.write`, chỉ hẹn
 *     `packetTimeout("write")` sau 0 ms ⇒ CÙNG chuỗi errCode mà không byte nào rời máy (thăm dò S7-d: 0 PDU ghi tới sim) ⇒ không đếm ⇒ `failed`
 *     (chưa gửi). Gói đã gửi luôn mang `timeoutError = false` (:1097); thư viện không chỗ nào khác đổi cờ này.
 *   • Chỉ xét `valid === false` (0.3.18 không bao giờ đặt `valid = true` cho item ghi; bản khác có thể — item tốt mang errCode cũ ⇒ bỏ qua).
 * Vì sao KHÔNG dò thời gian: PLC trả lời chậm sát globalTimeout không phân biệt được bằng đồng hồ; errCode do chính bộ hẹn của thư viện gắn là bằng
 * chứng trực tiếp. Truy cập phòng thủ, không ném; cấu trúc không đọc được ⇒ false (`failed` như trước).
 */
export function laQuaHanGhiS7(conn: unknown): boolean {
  try {
    const arr = (conn as { writePacketArray?: unknown } | null)?.writePacketArray;
    if (!Array.isArray(arr)) return false;
    for (const goi of arr) {
      if (!goi || typeof goi !== "object") continue;
      if ((goi as { timeoutError?: unknown }).timeoutError === true) continue; // không được gửi
      const ds = (goi as { itemList?: unknown }).itemList;
      if (!Array.isArray(ds)) continue;
      for (const it of ds) {
        if (!it || typeof it !== "object") continue;
        if ((it as { valid?: unknown }).valid !== false) continue;
        if ((it as { errCode?: unknown }).errCode === S7_ERRCODE_QUA_HAN_GHI) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * T3C (phòng thủ ba, TRONG phiên) — chốt trên INSTANCE nodes7 (thuộc tính riêng che prototype; thư viện gọi `self.prepareWritePacket()`):
 *   • `writeItems`: khoá / giá trị nodes7 không nhận một-đối-một (không phải mảng chuỗi cùng độ dài, rỗng) ⇒ ném NGAY — nodes7 sẽ dựng danh
 *     sách rỗng / thiếu (:465-480) mà không báo;
 *   • `prepareWritePacket` (chạy TRONG writeItems, TRƯỚC mọi `sendWritePacket`): danh sách nodes7 vừa dựng (`instantWriteBlockList`) phải khớp
 *     từng item với danh sách yêu cầu (cùng số, cùng thứ tự, `loiItemNodes7` sạch). RỖNG ⇒ bản gốc trả sớm (:673-676) giữ `writePacketArray` cũ ⇒
 *     `sendWritePacket` (:491 ngay, hoặc :1463 khi xếp hàng sau lượt đọc) GỬI LẠI gói ghi trước — chốt ném ⇒ không gì được gửi.
 * Ném = writeItems ném (không gói, `writeInQueue` không đặt; `writePacketArray` cũ đều `sent=false` ⇒ lời ghi kế dựng lại bình thường).
 * Gọi thẳng instance (bỏ qua writeTags) cũng qua chốt.
 *
 * T3C fix 1 (M1, fail-CLOSED): phiên là nodes7 THẬT (`instanceof lopNodes7That()`) mà `writeItems` / `prepareWritePacket` / `prepareReadPacket` vắng
 * hoặc không phải hàm ⇒ KHÔNG gắn được chốt ⇒ trả lý do `OT_S7_THU_VIEN_KHONG_KIEM_DUOC`; driver từ chối MỌI lời ghi / đọc của phiên đó.
 * Phiên KHÔNG phải nodes7 thật chỉ có ở test đơn vị (`vi.doMock("nodes7")`, thư viện giả không có nội tại nào) ⇒ gắn những gì có; lớp 2
 * (`kiemDiaChiS7`) vẫn chạy trên bộ phân tích THẬT cho mọi lời ghi.
 */
function ganChotGhiNodes7(conn: any): string | undefined {
  const lop = lopNodes7That() as (new (...a: unknown[]) => unknown) | undefined;
  const that = typeof lop === "function" && conn instanceof lop;
  const thieu = ["writeItems", "prepareWritePacket", "prepareReadPacket"].filter((h) => typeof conn?.[h] !== "function");
  if (that && thieu.length > 0) {
    return `${MA_S7_THU_VIEN_KHONG_KIEM_DUOC}: nodes7 session is missing ${thieu.join(", ")} - the replay latch cannot be installed; S7 writes and reads refused`;
  }
  if (!conn || typeof conn.writeItems !== "function" || typeof conn.prepareWritePacket !== "function") return undefined;
  const gocWriteItems = conn.writeItems;
  const gocPrepare = conn.prepareWritePacket;
  let yeuCau: readonly string[] | null = null;
  const tuChoi = (lyDo: string) => new Error(`${MA_S7_DIA_CHI_THU_VIEN_BO}: ${lyDo} - refused before sending (nodes7 would resend the previous write packet or write part of the batch); nothing sent`);
  conn.writeItems = function (this: any, arg: unknown, value: unknown, cb?: unknown) {
    let ds: string[];
    if (typeof arg === "string") ds = [arg];
    else if (Array.isArray(arg) && Array.isArray(value) && arg.length === value.length && arg.every((k) => typeof k === "string")) ds = arg as string[];
    else throw tuChoi("writeItems called with keys / values nodes7 does not take one-to-one");
    if (ds.length === 0) throw tuChoi("writeItems called with an empty list");
    yeuCau = ds;
    try {
      return gocWriteItems.call(this, arg, value, cb);
    } finally {
      yeuCau = null;
    }
  };
  conn.prepareWritePacket = function (this: any, ...args: unknown[]) {
    const ds = yeuCau;
    const items: unknown = this.instantWriteBlockList;
    if (!Array.isArray(items) || items.length === 0) throw tuChoi("nodes7 built an empty write list");
    if (ds) {
      if (items.length !== ds.length) throw tuChoi(`nodes7 built ${items.length} of ${ds.length} write items`);
      for (let i = 0; i < ds.length; i++) {
        const ly = (items[i] as { useraddr?: unknown } | undefined)?.useraddr !== ds[i] ? "dropped or reordered" : loiItemNodes7(items[i]);
        if (ly) throw tuChoi(`write item "${ds[i]}" ${ly}`);
      }
    }
    return gocPrepare.apply(this, args);
  };
  // Phía ĐỌC, cùng lớp: `prepareReadPacket` với danh sách đọc RỖNG trả sớm (:827-829) trước khi xoá `readPacketArray` (:932) ⇒ `sendReadPacket`
  // (:616) gửi lại gói ĐỌC cũ, `readResponse` trả giá trị địa chỉ CŨ dưới khoá cũ. KHÔNG ném (readAllItems còn chạy từ hẹn giờ thử lại 100 ms của
  // thư viện, :590-597 — ném ở đó thành uncaughtException): xoá gói đọc cũ ⇒ không gì được gửi; `sendReadPacket` thấy mảng rỗng gọi lại (false, {})
  // (:976-979, "zero tags") ⇒ không có giá trị nào (tag ⇒ bad), không bao giờ giá trị địa chỉ cũ.
  if (typeof conn.prepareReadPacket === "function") {
    const gocPrepareRead = conn.prepareReadPacket;
    conn.prepareReadPacket = function (this: any, ...args: unknown[]) {
      const ds: unknown = this.polledReadBlockList;
      if (Array.isArray(ds) && !ds.some((x) => x !== undefined)) {
        if (typeof this.clearReadPacketTimeouts === "function") this.clearReadPacketTimeouts();
        this.readPacketArray = [];
        this.globalReadBlockList = [];
        return undefined;
      }
      return gocPrepareRead.apply(this, args);
    };
  }
  return undefined;
}

/** T3 — ân hạn B3 của dispatcher (`otDeviceWrite.OT_TIMED_OUT_WRITE_GRACE_MS`; test ghim bằng nhau — driver không import otDeviceWrite) + đệm. */
export const AN_HAN_B3_CHO_DRIVER_MS = 1000;
export const DEM_SAU_AN_HAN_B3_MS = 500;

/**
 * T3 (rà T2 M-3 + kiem-dinh) — bộ hẹn DỰ PHÒNG của MỘT lời ghi S7 = max(HAN_DU_PHONG_GHI_DRIVER_MS, hạn lệnh + ân hạn B3 + 500). Hạn lệnh = hạn
 * MẶC ĐỊNH của dispatcher (`OT_CONTROL_TIMEOUT_MS`, cùng cách đọc với `commandDispatcher.effectiveTimeoutMs`), đọc LÚC GHI ⇒ với lệnh không có hạn
 * riêng, hạn dispatcher + B3 (giữ chỗ + đặt lại phiên) luôn tới TRƯỚC bộ hẹn này. GIỚI HẠN đã biết (như EIP): `deadlineMs` riêng của một lệnh không tới
 * driver (`OtWrite` không mang hạn) ⇒ lệnh có hạn riêng dài hơn được che bởi việc HẠ PHIÊN khi bộ hẹn hết (`haPhienSauDuPhong`).
 */
export function hanDuPhongGhiS7Ms(): number {
  const hanLenh = hanLenhOtMacDinhMs(); // T3 fix 1 (M-4) — kẹp ≤ TRAN_HEN_GIO_MS (lề cho + 1500) ⇒ setTimeout không bao giờ tràn về 1 ms
  return Math.max(HAN_DU_PHONG_GHI_DRIVER_MS, hanLenh + AN_HAN_B3_CHO_DRIVER_MS + DEM_SAU_AN_HAN_B3_MS);
}

function withHanGhiDuPhong<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      t = setTimeout(() => reject(new LoiQuaHanYeuCauDriver("s7", `${label} backup timeout after ${ms}ms`, "du_phong")), ms);
    }),
  ]).finally(() => clearTimeout(t));
}

/** Parse host/port từ endpoint. "tcp://host:port" | "host:port" | "host". */
function parseEndpoint(endpoint: string, defaultPort: number): { host: string; port: number } {
  let s = String(endpoint ?? "").trim();
  s = s.replace(/^tcp:\/\//i, "");
  const idx = s.lastIndexOf(":");
  if (idx > 0) {
    const host = s.slice(0, idx);
    const port = Number(s.slice(idx + 1));
    if (host && Number.isFinite(port)) return { host, port };
  }
  return { host: s || "127.0.0.1", port: defaultPort };
}

export class S7Driver extends NotImplementedDriver {
  readonly protocol: OtProtocol = "s7";
  protected readonly packageName = "nodes7";

  private conn: any = null;
  private connected = false;
  private connectedAt: Date | null = null;
  private lastOkAt: Date | undefined;
  private lastError: string | undefined;
  private lastLatencyMs: number | undefined;
  /** SCADA R0 (C5) — hạn giao dịch đã cấu hình ở connect(); readAllItems của nodes7 có thể không bao giờ gọi lại. */
  private timeoutMs = 5000;
  /** doc 81 Đợt 9 T1 — where the program checksum is read (same host / port / rack / slot as the nodes7 session). */
  private checksumTarget: S7ChecksumTarget | null = null;
  /**
   * SCADA R1b-2b-1 — yêu cầu đang bay theo phiên NodeS7: dropConnection ⇒ connectionCleanup ⇒ clearWritePacketTimeouts /
   * clearReadPacketTimeouts xoá hẹn giờ gói mà KHÔNG gọi writeDoneCallback ⇒ lệnh ghi chỉ xong ở hạn 5000 ms của driver, thành 'failed'.
   * Reject NGAY (kết cục không rõ) ở: mất liên kết (markLinkLost), disconnect(), connect() trước khi hạ phiên cũ.
   */
  private readonly dangBay = new SoYeuCauDangBay("s7");
  /**
   * T3C mục 5 — cấu hình tag đã nạp (subscribe = khởi động / nạp lại) có tag S7 bit ∉ 0..7 ⇒ lý do có mã, GHÉP vào health().lastError (connect()
   * xoá lastError, không xoá thứ này — cấu hình vẫn sai sau khi nối lại). Ghi tới tag ấy luôn bị từ chối (parseS7Address), đọc ⇒ config_error.
   */
  private loiCauHinhTag: string | undefined;
  /** T3C fix 1 (M1) — phiên nodes7 thật thiếu nội tại chốt cần ⇒ lý do có mã; mọi ghi / đọc của phiên bị từ chối (fail-closed). */
  private loiThuVien: string | undefined;

  override async connect(cfg: OtConnectionConfig): Promise<void> {
    const mod: any = await this.loadPackage();
    if (!mod) {
      throw new Error("nodes7 not installed");
    }
    const NodeS7 = mod.default ?? mod;
    // T12b fix round 1 — connect lại trên CÙNG driver (supervisor/otManager nối lại khi phiên cũ còn nửa mở hoặc isoConnectionState đã
    // hạ nhưng transport chưa đóng): hạ phiên cũ trước (capture-and-null như disconnect; KHÔNG chờ — dropConnection có thể không gọi lại),
    // không rò socket. Listener của phiên cũ đã có chốt danh tính (`this.conn === conn`).
    const cu = this.conn;
    if (cu) {
      this.conn = null;
      this.connected = false;
      this.dangBay.huy(cu, "reconnect replaced the session"); // R1b-2b-1 (iii)
      try {
        if (typeof cu.dropConnection === "function") cu.dropConnection(() => undefined);
      } catch {
        // ignore
      }
    }
    const conn = new NodeS7();
    const loiChot = ganChotGhiNodes7(conn); // T3C — chốt trong phiên: nodes7 không bao giờ gửi lại gói cũ / ghi một phần

    const opts = cfg.options ?? {};
    const defaultPort = typeof opts.port === "number" ? opts.port : 102;
    const { host, port } = parseEndpoint(cfg.endpoint, defaultPort);
    const timeoutMs = cfg.timeoutMs ?? 5000;
    this.timeoutMs = timeoutMs;
    const rack = typeof opts.rack === "number" ? opts.rack : 0;
    // slot 2 cho S7-300/400, slot 1 cho S7-1200/1500 (mặc định 1).
    const slot = typeof opts.slot === "number" ? opts.slot : 1;

    try {
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          conn.initiateConnection(
            { port, host, rack, slot, timeout: timeoutMs, silent: true },
            (err: unknown) => {
              if (err) reject(err instanceof Error ? err : new Error(String(err)));
              else resolve();
            },
          );
        }),
        timeoutMs,
        "s7 initiateConnection",
      );

      this.conn = conn;
      this.connected = true;
      this.connectedAt = new Date();
      this.loiThuVien = loiChot; // T3C fix 1 (M1) — fail-closed theo phiên
      this.checksumTarget = { host, port, rack, slot };
      this.lastError = undefined;
      // doc 40 OT-F1 — NodeS7 là callback-based, KHÔNG có event channel ổn định. Gắn
      // 'error'/'close' phòng hờ (bọc try/catch — no-op nếu không expose). Đường phát
      // hiện CHÍNH cho nodes7 là isConnected()/health() đọc `isoConnectionState` thật
      // của lib (xem isConnected) + fallback đếm-lỗi ở connectionSupervisor.
      this.attachLinkLossHandlers(conn);
    } catch (err) {
      this.lastError = (err as Error)?.message || String(err);
      try {
        if (typeof conn.dropConnection === "function") {
          await new Promise<void>((resolve) => conn.dropConnection(() => resolve()));
        }
      } catch {
        // ignore
      }
      throw err;
    }
  }

  override async disconnect(): Promise<void> {
    // doc 81 Đợt 5 task F2 (item 28) — capture-and-null-first: the fields are cleared BEFORE the first await and only
    // the CAPTURED handle is dropped. A drop that completes late (after a supervisor reset already reconnected this same
    // driver object) therefore never clears the NEW session (was: `await drop(); this.conn = null; connected = false`).
    const conn = this.conn;
    this.conn = null;
    this.connected = false;
    this.dangBay.huy(conn, "session torn down (disconnect)"); // R1b-2b-1 (ii) — trước dropConnection (huỷ hẹn giờ gói, không gọi lại)
    if (conn && typeof conn.dropConnection === "function") {
      try {
        await new Promise<void>((resolve) => conn.dropConnection(() => resolve()));
      } catch {
        // ignore
      }
    }
  }

  /**
   * doc 40 OT-F1 — isConnected() phải nói THẬT khi rớt cáp/PLC reboot giữa phiên.
   * NodeS7 giữ trạng thái ISO ở `isoConnectionState` (4 = connected); khi transport
   * đứt, lib tự hạ về != 4. Ta ưu tiên trạng thái lib (guarded) rồi mới tới cờ nội bộ —
   * nhờ vậy health()/isConnected() không còn báo "connected" giả sau khi mất kết nối,
   * để connectionSupervisor phát hiện và reconnect. Package mock (không có field) →
   * lui về cờ `connected` như cũ (không đổi hành vi test).
   */
  override isConnected(): boolean {
    if (!this.connected) return false;
    const st = (this.conn as { isoConnectionState?: unknown } | null)?.isoConnectionState;
    if (typeof st === "number") return st === 4;
    return this.connected;
  }

  /** doc 40 OT-F1 — gắn listener 'error'/'close' phòng hờ (no-op nếu lib không emit). */
  private attachLinkLossHandlers(conn: any): void {
    if (!conn || typeof conn.on !== "function") return;
    for (const ev of ["error", "close"]) {
      try {
        conn.on(ev, (arg?: unknown) => {
          if (this.conn === conn) this.markLinkLost(ev, arg, conn);
        });
      } catch {
        // ignore
      }
    }
  }

  /**
   * T3 — bộ hẹn DỰ PHÒNG hết mà thư viện CHƯA gọi lại ⇒ thư viện còn giữ (và có thể còn gửi / tự nối lại cho) yêu cầu cũ. Coi như hạn dispatcher + đặt
   * lại phiên B3: hạ phiên NGAY, TRƯỚC khi trả kết quả — yêu cầu đang bay khác của phiên ⇒ `mat_lien_ket`; `dropConnection` (huỷ hẹn giờ nối lại /
   * đọc lại) rồi `connectionCleanup` (huỷ socket NGAY, xoá hẹn giờ gói ghi ⇒ không còn `writeResponse` / `connectNow` nào từ yêu cầu cũ; không chờ
   * 'close' tới 2,5 s như dropConnection một mình). connected=false ⇒ supervisor nối lại bằng đường sẵn có; lệnh kế (STOP) trước khi nối lại ⇒
   * DeviceUnreachableError (không gửi gì, `failed` — băng E-STOP cứng `khong_dat`), không bao giờ chồng lên yêu cầu cũ.
   */
  private haPhienSauDuPhong(conn: any, lyDo: string): void {
    if (!conn || this.conn !== conn) return;
    this.conn = null;
    this.connected = false;
    this.lastError = `s7 session torn down (${lyDo}) — the library still held the write; reconnect via the supervisor`;
    this.dangBay.huy(conn, `session torn down: ${lyDo}`);
    try {
      if (typeof conn.dropConnection === "function") conn.dropConnection(() => undefined);
    } catch {
      // ignore
    }
    try {
      if (typeof conn.connectionCleanup === "function") conn.connectionCleanup();
    } catch {
      // ignore
    }
  }

  /** Lật cờ mất kết nối (idempotent — chỉ tác động khi đang connected). */
  private markLinkLost(ev: string, arg: unknown, conn: any): void {
    const detail = arg ? `: ${(arg as Error)?.message ?? String(arg)}` : "";
    if (this.connected) {
      this.connected = false;
      this.lastError = `s7 link lost (${ev})${detail}`;
    }
    this.dangBay.huy(conn, `link ${ev}${detail}`); // R1b-2b-1 (i)
  }

  override async readTags(tags: OtTagAddress[]): Promise<OtSample[]> {
    if (!this.connected || !this.conn) {
      throw new DeviceUnreachableError("s7");
    }
    if (tags.length === 0) return [];
    if (this.loiThuVien) throw new LoiS7KhongKiemDuoc(this.loiThuVien); // T3C fix 1 (M1) — fail-closed

    // Ánh xạ tagKey → địa chỉ S7 đã validate (translation callback của NodeS7).
    // SCADA R0 (C2) — sau cờ: địa chỉ sai của MỘT tag ⇒ chỉ tag đó bad/config_error, tag khác vẫn đọc.
    // Cờ tắt: địa chỉ sai ném cả lô như cũ.
    const v2 = chatLuongV2Bat();
    const addrByKey = new Map<string, string>();
    const loiDiaChi = new Map<string, OtSample>();
    const mauLoiDiaChi = (tagKey: string): OtSample => ({
      tagKey,
      raw: null,
      value: null,
      quality: "bad",
      timestamp: new Date(),
      tsSource: "server",
      statusCode: "invalid_address",
      reason: "config_error",
    });
    for (const t of tags) {
      try {
        addrByKey.set(t.tagKey, parseS7Address(t.address).s7);
      } catch (e) {
        // T3C fix 1 (I1) — bit ∉ 0..7 (cấu hình cũ) KHÔNG làm mù cả adapter khi cờ V2 tắt: chỉ tag đó bad (trần), tag khác vẫn đọc.
        if (!v2 && !laLoiS7BitNgoaiDai(e)) throw e;
        if (v2) loiDiaChi.set(t.tagKey, mauLoiDiaChi(t.tagKey));
      }
    }
    // T3C mục 4 — phía ĐỌC cùng lớp: khoá nodes7 sẽ BỎ ⇒ như địa chỉ sai, không tới addItems (bỏ HẾT ⇒ nodes7 gửi lại gói đọc cũ và trả giá trị
    // địa chỉ CŨ dưới khoá cũ — đo: s7BitNgoaiDai.r1b2b2.test.ts). Địa chỉ mảng vẫn đọc (json).
    // Cờ V2: config_error có lý do; cờ tắt: bad trần như khi nodes7 tự bỏ item trước đây (không ném cả lô — tag khác vẫn đọc).
    // T3C fix 1 — CÙNG vị từ với lưu / khởi động / ghi (`kiemDiaChiS7`, chế độ "doc" theo dataType: mảng json / mảng CHAR kiểu string vẫn đọc);
    // không kiểm được ⇒ ném (fail-closed).
    const kieuCua = new Map(tags.map((t) => [t.tagKey, t.dataType] as const));
    for (const [k, diaChi] of [...addrByKey]) {
      const l = kiemDiaChiS7(diaChi, { khoa: k, cheDo: "doc", dataType: kieuCua.get(k) });
      if (!l) continue;
      if (l.ma === MA_S7_THU_VIEN_KHONG_KIEM_DUOC) throw new LoiS7KhongKiemDuoc(l.lyDo);
      addrByKey.delete(k);
      if (v2) loiDiaChi.set(k, mauLoiDiaChi(k));
    }
    this.conn.setTranslationCB((tag: string) => addrByKey.get(tag));

    /** R1b-2b-1 T3 (G2) — cờ `anythingBad` của thư viện ở lần đọc này (false ⇒ "BAD n" của tag string/json là giá trị thật). */
    let thuVienBaoLoi = true;
    let values: Record<string, unknown> = {};
    if (addrByKey.size > 0) {
      const keys = tags.filter((t) => addrByKey.has(t.tagKey)).map((t) => t.tagKey);
      const kieuTheoKhoa = new Map(tags.map((t) => [t.tagKey, t.dataType] as const));
      this.conn.removeItems(); // xoá item phiên trước
      this.conn.addItems(keys);

      const t0 = Date.now();
      /** R1b-2a T13 fix round 2 (I1) — `isoConnectionState` của nodes7 ĐÚNG LÚC callback đọc (undefined = lib/mock không có trường). */
      let trangThaiSauDoc: number | undefined;
      const conn = this.conn;
      // SCADA R0 (C5) — readAllItems có thể không bao giờ gọi lại ⇒ đọc CÓ HẠN (không cờ, sửa lỗi treo).
      values = await withDeadline(
        this.dangBay.bay(
          conn,
          new Promise<Record<string, unknown>>((resolve, reject) => {
            // final fix (rà soát cuối M-4) — CHỈ callback ĐẦU TIÊN được ghi: một callback lặp MUỘN (anythingBad=false) rơi giữa resolve(vals1) và
            // phần tiếp theo sẽ ghi đè `thuVienBaoLoi` / `trangThaiSauDoc` ⇒ chuỗi "BAD n" của vals1 đọc thành giá trị tốt.
            let daGoi = false;
            conn.readAllItems((anythingBad: boolean, vals: Record<string, unknown>) => {
              if (daGoi) return;
              daGoi = true;
              const st = (conn as { isoConnectionState?: unknown } | null)?.isoConnectionState;
              trangThaiSauDoc = typeof st === "number" ? st : undefined;
              thuVienBaoLoi = anythingBad !== false;
              // anythingBad=true vẫn trả vals (item lỗi mang giá trị BAD) — không reject.
              if (vals && typeof vals === "object") resolve(vals);
              else reject(new Error("S7Driver: readAllItems returned no values"));
            });
          }),
        ),
        this.timeoutMs + 1000,
        "s7 readAllItems",
      );
      this.lastLatencyMs = Date.now() - t0;
      // R1b-2a T13 fix round 2 (I1, cờ V2) — gói đọc QUÁ HẠN (PLC im, TCP còn) hoặc liên kết chưa lên: nodes7 (nodeS7.js packetTimeout "read"
      // ⇒ connectionReset() ⇒ readResponse(undefined)) VẪN gọi lại, mọi item mang chuỗi "BAD 255", và isoConnectionState đã rời 4. Đó là
      // lần đọc KHÔNG được trả lời ⇒ ném lỗi mức liên kết (chatLuongLoiChung ⇒ comm_lost; vòng poll ⇒ tick ok:false, D1 đếm), KHÔNG trả mẫu
      // device_error (sẽ thành "đã trả lời" ⇒ connected giả, D1 không bao giờ bắn). Item BAD khi liên kết vẫn 4 = PLC báo lỗi item ⇒ device_error.
      if (v2 && trangThaiSauDoc !== undefined && trangThaiSauDoc !== 4 && keys.some((k) => laMauBadThuVien(values[k], kieuTheoKhoa.get(k) ?? "string", thuVienBaoLoi))) {
        const err = new DeviceUnreachableError("s7", `read not answered: nodes7 returned BAD and left the link (isoConnectionState ${trangThaiSauDoc})`);
        this.lastError = err.message;
        throw err;
      }
      this.lastOkAt = new Date();
    }

    return tags.map((tag) => {
      const loi = loiDiaChi.get(tag.tagKey);
      if (loi) return loi;
      const raw = values[tag.tagKey];
      const co = coerceS7Value(raw, tag.dataType, { thuVienBaoLoi });

      let value = co.value;
      if (co.quality === "good" && typeof value === "number" && tag.dataType !== "bool") {
        // R1b-2b-1 T6 fix round 1 — scale xuôi + làm tròn int qua MỘT nguồn (`otScale.scaleXuoi`), cũng là nguồn mô phỏng của so đọc lại.
        value = scaleXuoi(value, tag.dataType === "int" ? "int" : "float", tag.scale, tag.offset);
      }

      return {
        tagKey: tag.tagKey,
        raw,
        value: co.quality === "good" ? value : null,
        quality: co.quality,
        timestamp: new Date(),
        tsSource: "server", // doc 81 Đợt 4 Task B6 — stamped by the driver on receipt
        // R1b-2a T13 fix round 1 — readAllItems ĐÃ trả lời; item BAD ⇒ bad CÓ lý do (bad trần = chưa trả lời, mauMayChuDaTraLoi).
        ...(v2 && co.quality === "bad" ? MAU_GIA_TRI_HONG : {}),
      } satisfies OtSample;
    });
  }

  override async subscribe(
    tags: OtTagAddress[],
    onSample: OnOtSample,
    intervalMs = 5000,
    tuyChon?: TuyChonVongPoll,
  ): Promise<OtSubscriptionHandle> {
    if (!this.connected) throw new DeviceUnreachableError("s7");
    this.loiCauHinhTag = lyDoCauHinhDiaChiS7(tags) ?? undefined; // T3C mục 5 + fix 1 (I2) — không im lặng

    // SCADA R0 — vòng poll DÙNG CHUNG (chống chồng tick, hạn đọc, mẫu xấu một lần khi mất liên lạc sau cờ).
    return taoVongPoll({
      tags,
      intervalMs,
      deadlineMs: tuyChon?.deadlineMs,
      doc: async (t) => {
        try {
          return await this.readTags(t);
        } catch (e) {
          this.lastError = (e as Error)?.message || String(e);
          throw e;
        }
      },
      onSample,
      onTick: tuyChon?.onTick,
      phanLoiLoi: chatLuongLoiChung,
      chatLuongV2: chatLuongV2Bat(),
      nhan: "s7",
    });
  }

  /**
   * ⚠️ ONLY commandDispatcher may call this — write reaches physical device.
   *
   * Ghi giá trị xuống PLC S7 qua NodeS7.writeItems. Reachable CHỈ qua HITL
   * execute() → dispatch(). Với mỗi write: parseS7Address (read-only I/E/PI →
   * ok:false isolate); inverse scale/offset (int/float) → coerce theo dataType;
   * setTranslationCB ánh xạ tagKey→địa chỉ; writeItems(keys[],values[],cb(anyBad)).
   * writeItems trả 1 (busy, đồng bộ) → ok:false "S7 write busy" (không chờ cb);
   * cb(anyBadQualities=true) → ok:false "bad write quality" cả batch;
   * anyBadQualities=false → ok:true cả batch. Lỗi parse từng write được cô lập.
   */
  override async writeTags(writes: OtWrite[]): Promise<OtCommandResult[]> {
    if (!this.connected || !this.conn) {
      throw new DeviceUnreachableError("s7");
    }
    if (writes.length === 0) return [];
    // T3C fix 1 (M1) — phiên nodes7 thật thiếu nội tại chốt ⇒ không gì tới thư viện (`failed`, mã ổn định).
    if (this.loiThuVien) return this.tuChoiCaLo(writes, this.loiThuVien);

    // Chuẩn bị từng write; cô lập lỗi parse / read-only (không kéo sập batch).
    const prepared: Array<{ tagKey: string; addr?: string; value?: unknown; error?: string; huyLo?: boolean }> =
      writes.map((w) => {
        try {
          const parsed = parseS7Address(w.address);
          if (parsed.isReadOnly) {
            return { tagKey: w.tagKey, error: "register type not writable" };
          }
          const dataType = w.dataType ?? "float";
          const raw = inverseScale(w.value, dataType, w.scale ?? 1, w.offset ?? 0);
          // R1b-2b-1 T2 fix round 1 (M1) — địa chỉ BIT (DBx,X / M0.0…): MỘT luật bool BẤT KỂ dataType (như coil Modbus / bit SLMP): ngoài tập ⇒ write
          // đó ok:false; STOP đã xác minh ⇒ `boolDungGhim` (KD-T2). Giá trị là giá trị người gọi (không inverse-scale — một bit không có thang đo).
          return { tagKey: w.tagKey, addr: parsed.s7, value: parsed.isBit ? boolChoGhi(w.value, w.dungGhim) : coerceS7Write(raw, dataType, w.dungGhim) };
        } catch (err) {
          // T3C — bit ∉ 0..7 ⇒ CẢ lô bị từ chối (lô thiếu một lời ghi cũng là kết cục sai); lỗi khác vẫn cô lập theo write như cũ.
          return { tagKey: w.tagKey, error: (err as Error)?.message || String(err), huyLo: laLoiS7BitNgoaiDai(err) };
        }
      });

    // T3C lớp 1 — lô chứa địa chỉ bit ∉ 0..7 ⇒ không gì tới nodes7.
    const bitNgoai = prepared.find((p) => p.huyLo);
    if (bitNgoai) {
      return this.tuChoiCaLo(prepared, `${MA_S7_BIT_NGOAI_DAI}: batch refused - tag "${bitNgoai.tagKey}" in the same batch names a bit outside 0..7; nothing sent`);
    }

    const writable = prepared.filter((p) => p.error === undefined);
    if (writable.length === 0) {
      // Toàn bộ lỗi parse/read-only — không gọi writeItems.
      return prepared.map((p) => ({ tagKey: p.tagKey, ok: false, error: p.error }));
    }

    // Ánh xạ tagKey → địa chỉ S7 (translation callback của NodeS7).
    const addrByKey = new Map<string, string>();
    for (const p of writable) addrByKey.set(p.tagKey, p.addr!);

    // T3C lớp 2 — TRƯỚC writeItems: khoá nào nodes7 sẽ bỏ / hiểu khác ⇒ CẢ lô bị từ chối, không gói nào (không bao giờ gọi writeItems với danh sách
    // hiệu lực khác danh sách yêu cầu).
    // T3C fix 1 — CÙNG vị từ với lưu / khởi động (`kiemDiaChiS7`, bộ phân tích THẬT của nodes7); không kiểm được ⇒ fail-closed, mã riêng.
    const kieuGhi = new Map(writes.map((w) => [w.tagKey, w.dataType ?? null] as const));
    const thuVienBo = new Map(writable.flatMap((p) => {
      const l = kiemDiaChiS7(p.addr!, { khoa: p.tagKey, cheDo: "ghi", dataType: kieuGhi.get(p.tagKey) }); // "ghi" bỏ qua dataType (chặt)
      return l ? [[p.tagKey, l] as const] : [];
    }));
    if (thuVienBo.size > 0) {
      const dau = [...thuVienBo].find(([, l]) => l.ma === MA_S7_THU_VIEN_KHONG_KIEM_DUOC) ?? [...thuVienBo][0]!;
      const [k, l] = dau;
      const loiRieng = new Map([...thuVienBo].map(([kk, ll]) => [kk, `${ll.lyDo} - batch refused; nothing sent`]));
      return this.tuChoiCaLo(prepared, `${l.ma}: batch refused - tag "${k}": ${l.lyDo.slice(l.ma.length + 2)} (nodes7 address parser); nothing sent`, loiRieng);
    }

    this.conn.setTranslationCB((tag: string) => addrByKey.get(tag));

    const keys = writable.map((p) => p.tagKey);
    const values = writable.map((p) => p.value);

    let batchError: string | null = null;
    let ketCucKhongRo: OtCommandResult["ketCucKhongRo"] | null = null;
    const conn = this.conn;
    // T3 — bộ hẹn dự phòng theo hạn lệnh mặc định HIỆN HÀNH (đọc lúc ghi); trước: hằng 5000 = đúng hạn lệnh (đua với dispatcher, B3 có thể không chạy).
    const hanDuPhongMs = hanDuPhongGhiS7Ms();
    /** T3 — bộ hẹn dự phòng hết (thư viện chưa gọi lại) — khác hết hạn của CHÍNH thư viện (callback(true) + errCode). */
    let duPhongHet = false;
    try {
      await withHanGhiDuPhong(
        // R1b-2b-1 — qua sổ đang bay: phiên bị hạ / liên kết mất ⇒ reject NGAY (không chờ hạn rồi báo 'failed').
        this.dangBay.bay(
          conn,
          new Promise<void>((resolve, reject) => {
            // writeItems trả 1 (đồng bộ) nếu busy → coi là lỗi, KHÔNG chờ callback.
            const rc = conn.writeItems(keys, values, (anyBadQualities: boolean) => {
              if (!anyBadQualities) return resolve();
              // T3 — callback(true) là CẢ "PLC trả lời lỗi" LẪN "gói ĐÃ GỬI hết hạn của thư viện": phân biệt bằng errCode item (thăm dò thật).
              if (laQuaHanGhiS7(conn)) reject(new LoiQuaHanYeuCauDriver("s7", `nodes7 write packet timeout: ${S7_ERRCODE_QUA_HAN_GHI}`, "thu_vien"));
              else reject(new Error("bad write quality"));
            });
            if (rc === 1) reject(new Error("S7 write busy"));
          }),
        ),
        hanDuPhongMs,
        "s7 writeItems",
      ).catch((e: unknown) => {
        // T3 fix 1 (M-2) — theo cờ CÓ KIỂU, không so chữ của message.
        if (laLoiQuaHanYeuCauDriver(e) && (e as { loai?: unknown }).loai === "du_phong") duPhongHet = true;
        throw e;
      });
    } catch (err) {
      batchError = (err as Error)?.message || String(err);
      this.lastError = batchError;
      // R1b-2b-1 — lô ĐÃ giao cho thư viện khi liên kết mất: kết cục KHÔNG RÕ ⇒ ném lên (dispatcher ⇒ 'timeout' ngay), không 'failed'.
      if (laLoiMatLienKetKhiDangGui(err)) throw err;
      // T3 — hết hạn của thư viện (gói ĐÃ gửi) hoặc bộ hẹn dự phòng ⇒ kết cục KHÔNG RÕ cho MỌI write của lô ('timeout'), không 'failed'.
      ketCucKhongRo = ketCucKhongRoCua(err);
      // T3 — bộ hẹn dự phòng hết = thư viện CHƯA trả lời ⇒ còn giữ yêu cầu ⇒ hạ phiên TRƯỚC khi trả (lệnh kế — STOP — không chồng lên yêu cầu cũ).
      if (duPhongHet) this.haPhienSauDuPhong(conn, batchError);
    }

    if (!batchError) this.lastOkAt = new Date();

    return prepared.map((p) => {
      if (p.error !== undefined) return { tagKey: p.tagKey, ok: false, error: p.error };
      if (batchError) return ketCucKhongRo ? { tagKey: p.tagKey, ok: false, error: batchError, ketCucKhongRo } : { tagKey: p.tagKey, ok: false, error: batchError };
      return { tagKey: p.tagKey, ok: true };
    });
  }

  /**
   * T3C — từ chối CẢ lô, không gì tới nodes7 (kết cục RÕ: `failed`, không `ketCucKhongRo`). Write có lỗi riêng giữ lỗi ấy (`loiRieng` ưu tiên), write
   * hợp lệ mang lý do chung của lô.
   */
  private tuChoiCaLo(prepared: ReadonlyArray<{ tagKey: string; error?: string }>, loiChung: string, loiRieng?: ReadonlyMap<string, string>): OtCommandResult[] {
    this.lastError = loiChung;
    return prepared.map((p) => ({ tagKey: p.tagKey, ok: false, error: loiRieng?.get(p.tagKey) ?? p.error ?? loiChung }));
  }

  /**
   * doc 81 Đợt 9 task T1 — the checksum of the program loaded in the controller (READ-ONLY), per the S7comm protocol
   * documentation (s7BlockChecksum.ts). Not verified on a real device yet — the source label says so on screen.
   *   • a SEPARATE ISO-on-TCP connection per read: it shares no queue with writeTags (L-7 — a STOP write never waits);
   *   • bounded by `opts.deadlineMs` (the adapter's deadline, R-9-b; default 1000 ms, hard cap 10 s — clampS7Deadline) and
   *     cancelled by `opts.signal` (socket destroyed, nothing pending);
   *   • not connected / any failure ⇒ THROWS (the caller fails closed); never answers `supported:false`.
   */
  async readProgramChecksum(opts?: { signal?: AbortSignal; deadlineMs?: number }): Promise<ProgramChecksumResult> {
    const target = this.checksumTarget;
    if (!this.isConnected() || !this.conn || !target) {
      throw new DeviceUnreachableError("s7");
    }
    const checksum = await readS7ProgramChecksum(target, { signal: opts?.signal, deadlineMs: clampS7Deadline(opts?.deadlineMs) });
    return { supported: true, checksum, source: S7_CHECKSUM_SOURCE };
  }

  override async health(): Promise<OtHealth> {
    return {
      protocol: this.protocol,
      // doc 40 OT-F1 — báo trạng thái THẬT (đọc isoConnectionState của lib), không phải
      // cờ nội bộ có thể đã lỗi thời sau khi rớt kết nối giữa phiên.
      connected: this.isConnected(),
      lastOkAt: this.lastOkAt ?? this.connectedAt ?? undefined,
      // T3C mục 5 — cấu hình tag lỗi (bit ∉ 0..7) luôn đứng đầu, kể cả khi đang connected và chưa có lỗi nào khác.
      lastError: this.loiCauHinhTag ? (this.lastError && this.lastError !== this.loiCauHinhTag ? `${this.loiCauHinhTag} | last error: ${this.lastError}` : this.loiCauHinhTag) : this.lastError,
      latencyMs: this.lastLatencyMs,
    };
  }
}

export function createS7Driver(): OtDriver {
  return new S7Driver();
}
