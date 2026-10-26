/**
 * Sprint F1.3 — Mitsubishi MELSEC MC driver THẬT (package `mcprotocol`, nạp qua loadPackage()).
 *
 * ⚠️ doc 37 §6.2 / M7 — GIỚI HẠN THƯ VIỆN (spec-verified vs manual):
 *   `mcprotocol` mã hoá **1E frame nhị phân (A-compatible)**. Xác nhận theo MELSEC
 *   Communication Protocol Reference Manual (SH-081227ENG), Ch.18 "Communicating
 *   Using 1E Frames" p391-396:
 *     • Subheader = mã lệnh nhị phân: 00H batch-read bit / 01H batch-read word /
 *       02H batch-write bit / 03H batch-write word; response = request|80H, tức
 *       80H/81H/82H/83H (p392 "Subheader").
 *     • PC No. (station): FFH = trạm host (kết nối trực tiếp); 01H–40H (1–64) =
 *       trạm khác qua network module (p393). 1E frame KHÔNG có trường Network No.
 *       (SH-081227: "1C/1E frame do not have the setting of network No.").
 *     • Bộ device 1E chỉ là TẬP CON A-compatible: X Y M L S F B, T(TN/TS/TC),
 *       C(CN/CS/CC), D W R; SM/SD truy cập qua M9000/D9000 — KHÔNG có
 *       ZR SB SW V DX DY Z RD STS/long-timer/long-counter (p351-352). Địa chỉ
 *       ngoài tập này KHÔNG map được qua 1E frame.
 *   → iQ-R/iQ-F MẶC ĐỊNH SLMP 3E frame: subheader request '5000' (50 00) / response
 *   'D000' (D0 00); 4E frame request '5400' / response 'D400' + serial-No 2 byte
 *   (SH-081227 "Message Format" p42/p48, Access route p45; SLMP Reference Manual
 *   SH-080956ENG §"3E/4E frame message format"). Muốn dùng lib này với iQ-R: hoặc
 *   (a) bật "A-compatible 1E frame" trong Open Setting của GX Works3, hoặc (b) thay
 *   bằng encoder SLMP 3E/4E (xem TODO dưới). Port KHÔNG có mặc định chuẩn — set ở
 *   Open Setting của module (SH-080956 §3.1/3.2 TCP/UDP), kỹ sư phải nhập đúng.
 *
 * TODO — SLMP 3E encoder (KHÔNG thêm npm dep; tự viết trên node:net đã có):
 *   Request batch-read-word (command 0401H, subcommand 0000H) nhị phân, LE:
 *     [50 00]            subheader 3E
 *     [00]               network No.  (mặc định 00 = host)
 *     [FF]               PC No.       (mặc định FF = host)
 *     [FF 03]            request dest module I/O No. (0x03FF = host CPU)
 *     [00]               request dest multidrop station No.
 *     [len 2B]           request-data length (byte sau trường này)
 *     [timer 2B]         monitoring timer (0 = wait)
 *     [01 04]            command 0401H
 *     [00 00]            subcommand 0000H (Q/L 1-byte device-code)
 *     [devNo 3B]         head device No. (LE, 3 byte)
 *     [devCode 1B]       device-code 1 byte: D=A8 W=B4 M=90 X=9C Y=9D R=AF
 *                        B=A0 SD=A9 SM=91 … (bảng đầy đủ ở mcAddress.ts)
 *     [points 2B]        số điểm (LE)
 *   Response OK: [D0 00][00 FF FF 03 00][resLen 2B][endCode 2B=00 00][data…].
 *   iQ-R subcommand 0002/0003 → device-code 2 byte (00A8H…) + devNo 4 byte.
 *   Ref: SLMP Reference Manual SH-080956 §5.1-5.2 p17-37.
 *   Khi có encoder, bổ sung config: networkNo (byte "Network No", mặc định 00H),
 *   stationNo (byte "PC No", mặc định FFH), octalInputOutput (X/Y hệ bát phân cho
 *   dòng FX; Q/iQ-R dùng hệ 16 — SH-081227 p68). `mcprotocol.initiateConnection`
 *   CHỈ nhận {port,host,ascii} nên 3 field này CHƯA nối được nếu chưa thay lib.
 *
 * mcprotocol có API callback + translation giống NodeS7:
 *   - new MC(); initiateConnection({port,host,ascii}, cb(err))
 *   - setTranslationCB(tag => address); addItems([...]); readAllItems(cb(anythingBad, values))
 *   - dropConnection(cb)
 * Ta promisify. readTags: setTranslationCB ánh xạ tagKey→địa chỉ MELSEC (đã validate
 * bằng parseMcAddress), addItems(tagKeys), readAllItems → values{tagKey}.
 *
 * - connect: initiateConnection race timeout; thiếu lib → throw "mcprotocol not installed".
 * - readTags: coerceMcValue + áp scale/offset Ở DRIVER; item lỗi → quality:"bad".
 * - subscribe: POLL setInterval; unref; close()=clearInterval.
 * - writeTags (F4b/G2.1): GHI THẬT qua mcprotocol.writeItems(keys[],values[],cb(anyBad))
 *   — pattern y hệt NodeS7. setTranslationCB; inverse scale/offset + coerce; device
 *   read-only (X/DX) → ok:false; writeItems trả 1 (busy) → ok:false "MC write busy";
 *   anyBadQualities → ok:false "bad write quality". ⚠️ chỉ commandDispatcher gọi.
 * - disconnect: dropConnection.
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
  TuyChonVongPoll,
} from "../otDriver";
import { NotImplementedDriver } from "./notImplementedDriver";
import { parseMcAddress, coerceMcValue } from "./mcAddress";
import { inverseScale, scaleXuoi } from "./otScale";
import { boolChoGhi } from "./boolNghiem";
import { DeviceUnreachableError } from "../../../_core/deviceErrors";
import { boundedClose, withDeadline } from "./boundedClose";
import { SoYeuCauDangBay, laLoiMatLienKetKhiDangGui } from "./dangBay";
import { taoVongPoll } from "../vongPoll";
import { chatLuongLoiChung, chatLuongV2Bat, laMauBadThuVien, MAU_GIA_TRI_HONG } from "../chatLuong";

/** Ép raw (đã inverse scale) sang kiểu mcprotocol chấp nhận theo dataType. */
function coerceMcWrite(raw: unknown, dataType: string, dungGhim?: boolean): number | boolean | string {
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

const withTimeout = withDeadline;

/**
 * R1b-2a final-fix I-1 — hạn gói đọc của mcprotocol 0.1.2: `self.globalTimeout = 4500` (mcprotocol.js, constructor) — hẹn
 * `packetTimeout("read")` cho từng gói. Driver không ghi đè giá trị này; đọc từ instance nếu có (để không lệch nếu lib đổi), lui về 4500.
 */
export const HAN_GOI_MCPROTOCOL_MAC_DINH_MS = 4500;
/** Ngưỡng "đã trôi gần bằng hạn gói": 90 % hạn (bộ hẹn Node có thể lệch vài ms; ≥ 90 % mới coi là quá hạn). */
export const TI_LE_NGUONG_QUA_HAN_MC = 0.9;

export function hanGoiThuVienMc(conn: unknown): number {
  const g = (conn as { globalTimeout?: unknown } | null)?.globalTimeout;
  return typeof g === "number" && Number.isFinite(g) && g > 0 ? g : HAN_GOI_MCPROTOCOL_MAC_DINH_MS;
}

/** Lần đọc mọi-item-BAD có phải lib tự quá hạn gói (không phải PLC trả lời lỗi nhanh)? Đo trên đồng hồ đơn điệu. */
export function laDocMcQuaHanGoi(daTroiMs: number, globalTimeoutMs: number): boolean {
  return daTroiMs >= globalTimeoutMs * TI_LE_NGUONG_QUA_HAN_MC;
}

/**
 * R1b-2b-1 T4 (muc 58) - chuoi errCode nguyen van khi goi doc qua han: mcprotocol 0.1.2 `mcprotocol.js` :1263
 * (`processMBPacket(undefined, ...)` tu bo hen globalTimeout cua goi).
 */
export const MC_ERRCODE_QUA_HAN_GOI = "Timeout error - zero length packet";
export type LoaiLoiDocMc = "qua_han_goi" | "plc_tra_loi_loi" | "khong_ro";

/**
 * Phan loai loi cua lan doc "moi item BAD" bang `errCode` tung item cua thu vien (mcprotocol 0.1.2: `conn.readPacketArray[*].itemList[*]`;
 * `processMBPacket` dat `valid=false` + `errCode` cho item loi, `valid=true` cho item tot va KHONG xoa errCode cu ⇒ chi xet `valid === false`).
 *   - moi item loi la "Timeout error - zero length packet" ⇒ "qua_han_goi";
 *   - >= 1 item loi mang errCode khac (MC Error Response / Invalid Response Length / ...) ⇒ "plc_tra_loi_loi" (it nhat mot goi duoc PLC tra loi ⇒ PLC song);
 *   - khong doc duoc cau truc (thu vien khac ban, mang rong, khong item nao valid===false) ⇒ "khong_ro" ⇒ goi gia tri van dung luat thoi gian
 *     `laDocMcQuaHanGoi` (du phong khi cau truc noi bo doi, nen khong xoa luat do). Truy cap phong thu, khong nem.
 *   - final fix (ra soat cuoi M-3): item valid===false ma errCode KHONG phai chuoi (undefined = mac dinh cua constructor item mcprotocol.js
 *     :2411-2412, tuc "chua duoc xu ly o lan doc nay"; hoac so / null) KHONG phai bang chung PLC da tra loi ⇒ khong dem. Khong item loi nao mang
 *     errCode chuoi ⇒ "khong_ro" (fail-closed: luat thoi gian quyet), khong bao gio "plc_tra_loi_loi".
 */
export function phanLoaiLoiDocMc(conn: unknown): LoaiLoiDocMc {
  try {
    const arr = (conn as { readPacketArray?: unknown } | null)?.readPacketArray;
    if (!Array.isArray(arr)) return "khong_ro";
    let soLoi = 0;
    let coLoiKhac = false;
    for (const goi of arr) {
      const ds = (goi as { itemList?: unknown } | null)?.itemList;
      if (!Array.isArray(ds)) continue;
      for (const it of ds) {
        if (!it || typeof it !== "object" || (it as { valid?: unknown }).valid !== false) continue;
        const errCode = (it as { errCode?: unknown }).errCode;
        if (typeof errCode !== "string") continue; // final fix M-3: khong co errCode chuoi ⇒ khong phai bang chung (khong dem)
        soLoi++;
        if (errCode !== MC_ERRCODE_QUA_HAN_GOI) coLoiKhac = true;
      }
    }
    if (soLoi === 0) return "khong_ro";
    return coLoiKhac ? "plc_tra_loi_loi" : "qua_han_goi";
  } catch {
    return "khong_ro";
  }
}

/**
 * doc 81 Đợt 1B Task 1 — GIA CỐ `mcprotocol` 0.1.2 TỪ BÊN NGOÀI (không sửa node_modules).
 *
 * Lỗi của thư viện (BE1 §0 (2), mcprotocol.js):
 *   • `connectionCleanup()` (dòng 1211-1219) và `onTCPConnect()` (dòng 198-199) gọi
 *     `isoclient.removeAllListeners('error')` trên socket CÒN SỐNG. `dropConnection()` chỉ
 *     `end()` rồi cleanup ⇒ lỗi đến sau (ETIMEDOUT ~21 s khi SYN không ai trả lời, ECONNRESET
 *     khi PLC reset) không còn ai nghe ⇒ `uncaughtException` ⇒ `process.exit(1)`.
 *   • `connectNow()` bỏ socket cũ mà không destroy; `sendReadPacket/sendWritePacket` tự gọi
 *     `connectNow()` khi thấy mất kết nối — kể cả SAU khi ta đã ngắt.
 *
 * Cách gia cố (chỉ trên INSTANCE — thuộc tính riêng che prototype; lib gọi mọi hàm này qua
 * `self.x()` nên luôn đi qua lớp bọc):
 *   1. Listener `error` của driver luôn có mặt trên MỌI socket lib tạo: gắn lại ngay sau mỗi
 *      chỗ lib gỡ (`connectNow`, `connectionCleanup`, `onTCPConnect`). Chỉ hai chỗ trong lib
 *      gỡ listener `error` (dòng 199, 1217) và cả hai đều đã được bọc.
 *   2. Socket bị lib bỏ lại khi `connectNow()` thay socket ⇒ destroy.
 *   3. Sau khi driver ngắt (`dropped`) ⇒ `connectNow/readAllItems/writeItems` thành no-op:
 *      lib không tự mở lại socket tới PLC sau khi ta đã ngắt.
 * Mock (test đơn vị) không có các hàm nội bộ này ⇒ bỏ qua, hành vi như cũ.
 */
interface McHardening {
  dropped: boolean;
  guard: (sock: any) => void;
}

function hardenMcInstance(conn: any, onSocketError: (err: unknown) => void): McHardening {
  const state: McHardening = {
    dropped: false,
    guard: () => undefined,
  };
  const onError = (err: unknown) => {
    try {
      onSocketError(err);
    } catch {
      // listener cuối cùng — không bao giờ ném
    }
  };
  state.guard = (sock: any) => {
    if (!sock || typeof sock.on !== "function" || typeof sock.listeners !== "function") return;
    if (!sock.listeners("error").includes(onError)) sock.on("error", onError);
  };
  if (!conn || typeof conn.connectNow !== "function" || typeof conn.connectionCleanup !== "function") {
    return state; // không phải mcprotocol thật (mock) — không có gì để gia cố
  }

  const origConnectNow = conn.connectNow;
  conn.connectNow = function (this: any, ...args: unknown[]) {
    if (state.dropped) return undefined; // (3) không tự nối lại sau khi driver đã ngắt
    const prev = this.isoclient;
    const r = origConnectNow.apply(this, args);
    if (prev && this.isoclient !== prev) {
      state.guard(prev);
      try {
        prev.destroy(); // (2) socket bị bỏ lại
      } catch {
        // ignore
      }
    }
    state.guard(this.isoclient); // (1)
    return r;
  };

  const origCleanup = conn.connectionCleanup;
  conn.connectionCleanup = function (this: any, ...args: unknown[]) {
    const r = origCleanup.apply(this, args);
    state.guard(this.isoclient); // (1) lib vừa removeAllListeners('error')
    return r;
  };

  if (typeof conn.onTCPConnect === "function") {
    const origOnConnect = conn.onTCPConnect;
    conn.onTCPConnect = function (this: any, ...args: unknown[]) {
      const r = origOnConnect.apply(this, args);
      state.guard(this.isoclient); // (1) lib vừa removeAllListeners('error')
      return r;
    };
  }

  for (const name of ["readAllItems", "writeItems"]) {
    if (typeof conn[name] !== "function") continue;
    const orig = conn[name];
    conn[name] = function (this: any, ...args: unknown[]) {
      if (state.dropped) return undefined; // (3) vòng thử lại 100 ms của lib dừng ở đây
      return orig.apply(this, args);
    };
  }
  return state;
}

/**
 * doc 81 Đợt 1B Task 1 — ngắt `mcprotocol` CÓ HẠN: `dropConnection()` (không có callback)
 * + đợi socket `close` tối đa DEFAULT_CLOSE_TIMEOUT_MS, quá hạn ⇒ `destroy()`. Socket đang
 * dở connect (IP không định tuyến) ⇒ destroy ngay (không có gì để đóng êm).
 */
function dropMcBounded(conn: any, hardening: McHardening | null): Promise<unknown> {
  if (!conn) return Promise.resolve();
  if (hardening) hardening.dropped = true;
  const sock: any = conn.isoclient;
  if (hardening && sock) hardening.guard(sock);
  return boundedClose({
    close: (done) => {
      if (sock && typeof sock.once === "function" && !sock.destroyed) sock.once("close", () => done());
      if (typeof conn.dropConnection === "function") {
        // lib thật bỏ qua đối số; mock (test đơn vị) gọi cb như trước.
        conn.dropConnection(() => done());
      }
      if (hardening && sock) hardening.guard(sock);
      if (!sock || sock.destroyed) {
        done();
      } else if (sock.connecting) {
        sock.destroy();
        done();
      }
    },
    destroy: () => {
      if (sock && typeof sock.destroy === "function" && !sock.destroyed) sock.destroy();
    },
  });
}

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

export class MitsubishiMcDriver extends NotImplementedDriver {
  readonly protocol: OtProtocol = "mitsubishi-mc";
  protected readonly packageName = "mcprotocol";

  private conn: any = null;
  /** doc 81 Đợt 1B Task 1 — trạng thái gia cố của `conn` hiện tại (null với mock). */
  private hardening: McHardening | null = null;
  private timeoutMs = 5000;
  private connected = false;
  private connectedAt: Date | null = null;
  private lastOkAt: Date | undefined;
  private lastError: string | undefined;
  private lastLatencyMs: number | undefined;
  /**
   * SCADA R1b-2b-1 — yêu cầu đang bay theo phiên mcprotocol: dropConnection ⇒ connectionCleanup ⇒ clearWritePacketTimeouts xoá hẹn giờ
   * gói mà KHÔNG gọi writeDoneCallback (mcprotocol.js:128-134, 422-431, 1211-1225) ⇒ lệnh ghi chỉ xong ở hạn 5000 ms của driver, 'failed'.
   * Reject NGAY (kết cục không rõ) ở: lỗi socket (markLinkLost qua lớp gia cố), disconnect(), connect() trước khi hạ phiên cũ.
   */
  private readonly dangBay = new SoYeuCauDangBay("mitsubishi-mc");

  override async connect(cfg: OtConnectionConfig): Promise<void> {
    const mod: any = await this.loadPackage();
    if (!mod) {
      throw new Error("mcprotocol not installed");
    }
    const MC = mod.default ?? mod;
    // doc 81 Đợt 1B Task 1 — hạ kết nối cũ (nếu có) trước khi thay.
    if (this.conn) {
      const prev = this.conn;
      const prevHardening = this.hardening;
      this.conn = null;
      this.hardening = null;
      this.connected = false;
      this.dangBay.huy(prev, "reconnect replaced the session"); // R1b-2b-1 (iii)
      await dropMcBounded(prev, prevHardening);
    }
    const conn = new MC();
    const hardening = hardenMcInstance(conn, (err) => {
      if (this.conn === conn) this.markLinkLost("error", err, conn);
    });

    const opts = cfg.options ?? {};
    const defaultPort = typeof opts.port === "number" ? opts.port : 1281;
    const { host, port } = parseEndpoint(cfg.endpoint, defaultPort);
    const timeoutMs = cfg.timeoutMs ?? 5000;
    this.timeoutMs = timeoutMs;
    const ascii = opts.ascii === true; // mặc định binary (false)

    try {
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          conn.initiateConnection({ port, host, ascii }, (err: unknown) => {
            if (err) reject(err instanceof Error ? err : new Error(String(err)));
            else resolve();
          });
        }),
        timeoutMs,
        "mc initiateConnection",
      );

      this.conn = conn;
      this.hardening = hardening;
      this.connected = true;
      this.connectedAt = new Date();
      this.lastError = undefined;
      // doc 40 OT-F1 — mcprotocol là fork của NodeS7 (callback-based, cùng API), KHÔNG
      // có event channel ổn định. Gắn 'error'/'close' phòng hờ; đường phát hiện CHÍNH là
      // isConnected()/health() đọc `isoConnectionState` thật + fallback đếm-lỗi ở supervisor.
      this.attachLinkLossHandlers(conn);
    } catch (err) {
      this.lastError = (err as Error)?.message || String(err);
      // doc 81 Đợt 1B Task 1 — dropConnection() không có callback + gỡ listener 'error':
      // ngắt CÓ HẠN, destroy socket (kể cả socket đang dở SYN tới IP không định tuyến).
      await dropMcBounded(conn, hardening);
      throw err;
    }
  }

  override async disconnect(): Promise<void> {
    const conn = this.conn;
    const hardening = this.hardening;
    this.conn = null;
    this.hardening = null;
    this.connected = false;
    this.dangBay.huy(conn, "session torn down (disconnect)"); // R1b-2b-1 (ii) — trước dropConnection (huỷ hẹn giờ gói, không gọi lại)
    // doc 81 Đợt 1B Task 1 — ngắt có hạn (≤ DEFAULT_CLOSE_TIMEOUT_MS rồi destroy).
    await dropMcBounded(conn, hardening);
  }

  /**
   * doc 40 OT-F1 — isConnected() nói THẬT khi rớt kết nối giữa phiên. mcprotocol (fork
   * NodeS7) giữ `isoConnectionState` (4 = connected); lib tự hạ khi transport đứt. Ưu tiên
   * trạng thái lib (guarded) rồi mới tới cờ nội bộ để supervisor phát hiện & reconnect.
   * Mock không có field → lui về cờ `connected` (không đổi hành vi test).
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

  /** Lật cờ mất kết nối (idempotent — chỉ tác động khi đang connected). */
  private markLinkLost(ev: string, arg: unknown, conn: any): void {
    const detail = arg ? `: ${(arg as Error)?.message ?? String(arg)}` : "";
    if (this.connected) {
      this.connected = false;
      this.lastError = `mitsubishi-mc link lost (${ev})${detail}`;
    }
    this.dangBay.huy(conn, `link ${ev}${detail}`); // R1b-2b-1 (i)
  }

  override async readTags(tags: OtTagAddress[]): Promise<OtSample[]> {
    if (!this.connected || !this.conn) {
      throw new DeviceUnreachableError("mitsubishi-mc");
    }
    if (tags.length === 0) return [];

    // SCADA R0 (C2) — sau cờ: địa chỉ sai của MỘT tag ⇒ chỉ tag đó bad/config_error, tag khác vẫn đọc.
    // Cờ tắt: địa chỉ sai ném cả lô như cũ.
    const v2 = chatLuongV2Bat();
    const addrByKey = new Map<string, string>();
    const loiDiaChi = new Map<string, OtSample>();
    for (const t of tags) {
      try {
        addrByKey.set(t.tagKey, parseMcAddress(t.address).mc);
      } catch (e) {
        if (!v2) throw e;
        loiDiaChi.set(t.tagKey, {
          tagKey: t.tagKey,
          raw: null,
          value: null,
          quality: "bad",
          timestamp: new Date(),
          tsSource: "server",
          statusCode: "invalid_address",
          reason: "config_error",
        });
      }
    }
    this.conn.setTranslationCB((tag: string) => addrByKey.get(tag));

    /** R1b-2b-1 T3 (G2) — cờ `anythingBad` của thư viện ở lần đọc này. */
    let thuVienBaoLoi = true;
    let values: Record<string, unknown> = {};
    if (addrByKey.size > 0) {
      const keys = tags.filter((t) => addrByKey.has(t.tagKey)).map((t) => t.tagKey);
      const kieuTheoKhoa = new Map(tags.map((t) => [t.tagKey, t.dataType] as const));
      this.conn.removeItems();
      this.conn.addItems(keys);

      const t0 = Date.now();
      // R1b-2a final-fix I-1 — đồng hồ ĐƠN ĐIỆU (không theo đồng hồ tường / NTP) cho phép phân biệt quá hạn gói vs PLC trả lời lỗi.
      const t0DonDieu = performance.now();
      // doc 81 Đợt 1B Task 1 — readAllItems có thể không bao giờ gọi lại (lib tự thử lại mỗi
      // 100 ms khi còn gói chưa xong) ⇒ đọc CÓ HẠN; lib tự timeout gói sau globalTimeout 4500 ms.
      const connDoc = this.conn;
      values = await withDeadline(
        this.dangBay.bay(
          connDoc,
          new Promise<Record<string, unknown>>((resolve, reject) => {
            // final fix (rà soát cuối M-4) — CHỈ callback ĐẦU TIÊN được ghi: một callback lặp MUỘN (anythingBad=false) rơi giữa resolve(vals1) và
            // phần tiếp theo sẽ ghi đè `thuVienBaoLoi` ⇒ chuỗi "BAD n" của vals1 đọc thành giá trị tốt.
            let daGoi = false;
            connDoc.readAllItems((anythingBad: boolean, vals: Record<string, unknown>) => {
              if (daGoi) return;
              daGoi = true;
              thuVienBaoLoi = anythingBad !== false;
              if (vals && typeof vals === "object") resolve(vals);
              else reject(new Error("MitsubishiMcDriver: readAllItems returned no values"));
            });
          }),
        ),
        Math.max(this.timeoutMs, 4500) + 1000,
        "mc readAllItems",
      );
      this.lastLatencyMs = Date.now() - t0;
      const daTroiMs = performance.now() - t0DonDieu;
      // R1b-2a T13 fix round 2 (I1, cờ V2) + final-fix I-1 — gói đọc QUÁ HẠN (PLC im, TCP còn): mcprotocol (mcprotocol.js packetTimeout
      // "read" ⇒ readResponse(undefined)) VẪN gọi lại, mọi item mang chuỗi "BAD 255", và KHÔNG hạ isoConnectionState (vẫn 4). Nhưng PLC
      // trả lời LỖI cho cả khối (end code lỗi / độ dài sai) cũng tô 0xFF ⇒ cùng chuỗi "BAD 255". Phân biệt bằng THỜI GIAN: lib chỉ gọi
      // readResponse(undefined) từ bộ hẹn globalTimeout của gói ⇒ quá hạn thật luôn trả về SAU ≥ globalTimeout. Do đó:
      //   • MỌI item BAD và (đã trôi ≥ ~globalTimeout, hoặc lib tự báo rời isoConnectionState≠4) ⇒ mất liên lạc ⇒ ném McReadTimeoutError
      //     (chatLuongLoiChung ⇒ timeout/comm_lost; vòng poll ⇒ tick ok:false, D1 đếm);
      //   • MỌI item BAD mà trả về NHANH ⇒ PLC CÒN SỐNG và đã trả lời lỗi ⇒ từng item device_error, phiên GIỮ nguyên, lệnh ghi (STOP ghim)
      //     vẫn đi được (final review I-1: trước đó adapter bị hạ + lùi dần ⇒ STOP ADAPTER_OFFLINE).
      // Còn sót (biết, ghi giới hạn): PLC trả lời lỗi CHẬM sát globalTimeout (≥ 90 %) bị coi là mất liên lạc (fail-closed cho đọc).
      if (v2 && keys.length > 0 && keys.every((k) => laMauBadThuVien(values[k], kieuTheoKhoa.get(k) ?? "string", thuVienBaoLoi))) {
        const globalTimeoutMs = hanGoiThuVienMc(this.conn);
        const st = (this.conn as { isoConnectionState?: unknown } | null)?.isoConnectionState;
        const libRoi = typeof st === "number" && st !== 4;
        // R1b-2b-1 T4 (muc 58): errCode tung item cua thu vien quyet dinh truoc; chi "khong_ro" moi roi ve luat thoi gian.
        const loai = phanLoaiLoiDocMc(this.conn);
        const matLienLac = libRoi || loai === "qua_han_goi" || (loai === "khong_ro" && laDocMcQuaHanGoi(daTroiMs, globalTimeoutMs));
        if (matLienLac) {
          const err = Object.assign(
            new Error(
              `mc read not answered: every item BAD (mcprotocol packet timeout, ${Math.round(daTroiMs)} ms, ~${globalTimeoutMs} ms, ${loai}${libRoi ? ", lib not connected" : ""})`,
            ),
            { name: "McReadTimeoutError" },
          );
          this.lastError = err.message;
          throw err;
        }
        // nhanh ⇒ PLC đã trả lời lỗi cho mọi item: KHÔNG ném; từng item ra device_error bên dưới (MAU_GIA_TRI_HONG).
        this.lastError = `mc read answered with error for every item (${Math.round(daTroiMs)} ms, ~${globalTimeoutMs} ms, ${loai}) — device_error, session kept`;
      }
      this.lastOkAt = new Date();
    }

    return tags.map((tag) => {
      const loi = loiDiaChi.get(tag.tagKey);
      if (loi) return loi;
      const raw = values[tag.tagKey];
      const co = coerceMcValue(raw, tag.dataType, { thuVienBaoLoi });

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
    if (!this.connected) throw new DeviceUnreachableError("mitsubishi-mc");

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
      nhan: "mc",
    });
  }

  /**
   * ⚠️ ONLY commandDispatcher may call this — write reaches physical device.
   *
   * Ghi giá trị xuống PLC MELSEC qua mcprotocol.writeItems. Reachable CHỈ qua HITL
   * execute() → dispatch(). Pattern y hệt S7: parseMcAddress (read-only X/DX →
   * ok:false isolate); inverse scale/offset + coerce; setTranslationCB;
   * writeItems(keys[],values[],cb(anyBad)). writeItems trả 1 (busy) → ok:false
   * "MC write busy"; cb(anyBadQualities=true) → ok:false "bad write quality";
   * else ok:true cả batch. Lỗi parse từng write được cô lập.
   */
  override async writeTags(writes: OtWrite[]): Promise<OtCommandResult[]> {
    if (!this.connected || !this.conn) {
      throw new DeviceUnreachableError("mitsubishi-mc");
    }
    if (writes.length === 0) return [];

    const prepared: Array<{ tagKey: string; addr?: string; value?: unknown; error?: string }> =
      writes.map((w) => {
        try {
          const parsed = parseMcAddress(w.address);
          if (parsed.isReadOnly) {
            return { tagKey: w.tagKey, error: "register type not writable" };
          }
          const dataType = w.dataType ?? "float";
          const raw = inverseScale(w.value, dataType, w.scale ?? 1, w.offset ?? 0);
          // R1b-2b-1 T2 fix round 1 (M1) — bit-device / "<word>.<bit>": MỘT luật bool BẤT KỂ dataType (như coil Modbus / bit SLMP): ngoài tập ⇒ write
          // đó ok:false; STOP đã xác minh ⇒ `boolDungGhim` (KD-T2). Giá trị là giá trị người gọi (không inverse-scale — một bit không có thang đo).
          return { tagKey: w.tagKey, addr: parsed.mc, value: parsed.isBit ? boolChoGhi(w.value, w.dungGhim) : coerceMcWrite(raw, dataType, w.dungGhim) };
        } catch (err) {
          return { tagKey: w.tagKey, error: (err as Error)?.message || String(err) };
        }
      });

    const writable = prepared.filter((p) => p.error === undefined);
    if (writable.length === 0) {
      return prepared.map((p) => ({ tagKey: p.tagKey, ok: false, error: p.error }));
    }

    const addrByKey = new Map<string, string>();
    for (const p of writable) addrByKey.set(p.tagKey, p.addr!);
    this.conn.setTranslationCB((tag: string) => addrByKey.get(tag));

    const keys = writable.map((p) => p.tagKey);
    const values = writable.map((p) => p.value);

    let batchError: string | null = null;
    const conn = this.conn;
    try {
      await withTimeout(
        // R1b-2b-1 — qua sổ đang bay: phiên bị hạ / lỗi socket ⇒ reject NGAY (không chờ hạn 5000 ms rồi báo 'failed').
        this.dangBay.bay(
          conn,
          new Promise<void>((resolve, reject) => {
            const rc = conn.writeItems(keys, values, (anyBadQualities: boolean) => {
              if (anyBadQualities) reject(new Error("bad write quality"));
              else resolve();
            });
            if (rc === 1) reject(new Error("MC write busy"));
          }),
        ),
        5000,
        "mc writeItems",
      );
    } catch (err) {
      batchError = (err as Error)?.message || String(err);
      this.lastError = batchError;
      // R1b-2b-1 — lô ĐÃ giao cho thư viện khi liên kết mất: kết cục KHÔNG RÕ ⇒ ném lên (dispatcher ⇒ 'timeout' ngay), không 'failed'.
      if (laLoiMatLienKetKhiDangGui(err)) throw err;
    }

    if (!batchError) this.lastOkAt = new Date();

    return prepared.map((p) => {
      if (p.error !== undefined) return { tagKey: p.tagKey, ok: false, error: p.error };
      if (batchError) return { tagKey: p.tagKey, ok: false, error: batchError };
      return { tagKey: p.tagKey, ok: true };
    });
  }

  override async health(): Promise<OtHealth> {
    return {
      protocol: this.protocol,
      // doc 40 OT-F1 — báo trạng thái THẬT (đọc isoConnectionState), không phải cờ nội bộ.
      connected: this.isConnected(),
      lastOkAt: this.lastOkAt ?? this.connectedAt ?? undefined,
      lastError: this.lastError,
      latencyMs: this.lastLatencyMs,
    };
  }
}

export function createMitsubishiMcDriver(): OtDriver {
  return new MitsubishiMcDriver();
}
