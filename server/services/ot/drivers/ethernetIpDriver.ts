/**
 * Sprint F1.3 — EtherNet/IP (Allen-Bradley CIP) driver THẬT
 * (package `st-ethernet-ip`, nạp qua loadPackage()).
 *
 * st-ethernet-ip có API promise-based:
 *   - new Controller(); await PLC.connect(ipAddress, slot)
 *   - const tag = PLC.newTag(name, program); await PLC.readTag(tag) → tag.value
 *   - await PLC.disconnect()
 *
 * - connect: Controller.connect race timeout; thiếu lib → throw "st-ethernet-ip not installed".
 * - readTags: newTag theo parseEipTag (name+program), readTag từng tag, coerceEipValue,
 *   áp scale/offset Ở DRIVER. Lỗi 1 tag → quality:"bad" (không sập batch).
 * - subscribe: POLL setInterval; unref; close()=clearInterval.
 * - writeTags (F4b/G2.1): GHI THẬT — per-tag tuần tự. parseEipTag→newTag→inverse
 *   scale/offset+coerce→set tag.value→await PLC.writeTag(tag) (withTimeout). Lỗi 1
 *   tag → ok:false cô lập (không kéo sập batch). EIP không cần isReadOnly — gate
 *   ghi nằm ở deviceTags.writable (commandDispatcher). ⚠️ chỉ commandDispatcher gọi.
 * - disconnect: PLC.disconnect().
 *
 * packageName = "st-ethernet-ip" (lib pure-JS, feature-complete cho ControlLogix/CompactLogix;
 * thay placeholder "ethernet-ip" của F1.1).
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
import { parseEipTag, coerceEipValue } from "./eipTag";
import { inverseScale, scaleXuoi } from "./otScale";
import { boolChoGhi } from "./boolNghiem";
import { DeviceUnreachableError } from "../../../_core/deviceErrors";
import { HAN_DU_PHONG_GHI_DRIVER_MS, LoiQuaHanYeuCauDriver, SoYeuCauDangBay, ketCucKhongRoCua, laLoiMatLienKetKhiDangGui, laLoiQuaHanYeuCauDriver } from "./dangBay";
import { taoVongPoll } from "../vongPoll";
import { chatLuongLoiChung, chatLuongV2Bat, laLoiHuyTickPoll, MAU_GIA_TRI_HONG } from "../chatLuong";

/** Ép raw (đã inverse scale) sang kiểu st-ethernet-ip chấp nhận theo dataType. */
function coerceEipWrite(raw: unknown, dataType: string, dungGhim?: boolean): number | boolean | string {
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

/**
 * SCADA R1b-2b-2a T2 (mục 66) — tiền tố lỗi hết hạn ghi của CHÍNH st-ethernet-ip 2.7.5: `_writeTag` / `_writeTagFragmented` dựng
 * `new Error(`TIMEOUT occurred while writing Writing Tag: ${tag.name}.`)` rồi `promiseTimeout(…, timeout_sp, writeTagErr)` (dist/controller/index.js:812,
 * :855) — gói CIP đã `write_cip` ⇒ kết cục không rõ.
 */
export const EIP_TIEN_TO_QUA_HAN_GHI = "TIMEOUT occurred while writing Writing Tag:";

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms),
    ),
  ]);
}

/**
 * R1b-2b-2a T2 (mục 66) — bộ hẹn DỰ PHÒNG của MỘT lời ghi: `HAN_DU_PHONG_GHI_DRIVER_MS` (6500 > hạn lệnh mặc định 5000 + ân hạn B3 1000 ⇒ trong cấu hình
 * mặc định hạn của dispatcher thắng và B3 giữ chỗ + đặt lại phiên khi thư viện còn giữ yêu cầu). Hết hạn ⇒ `LoiQuaHanYeuCauDriver` (gói CIP đã gửi ⇒
 * kết cục không rõ). Hẹn giờ được huỷ khi lời ghi xong (không treo 6,5 s).
 */
function withHanGhiDuPhong<T>(p: Promise<T>, label: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      t = setTimeout(() => reject(new LoiQuaHanYeuCauDriver("ethernet-ip", `${label} timeout after ${HAN_DU_PHONG_GHI_DRIVER_MS}ms`)), HAN_DU_PHONG_GHI_DRIVER_MS);
    }),
  ]).finally(() => clearTimeout(t));
}

/** R1b-2b-2a T2 — hết hạn ghi của CHÍNH st-ethernet-ip (`timeout_sp`, chuỗi `EIP_TIEN_TO_QUA_HAN_GHI`). */
function laQuaHanGhiEip(err: unknown): boolean {
  const m = (err as { message?: unknown } | null | undefined)?.message;
  return typeof m === "string" && m.startsWith(EIP_TIEN_TO_QUA_HAN_GHI);
}

/**
 * SCADA R1b-2b-2a T3A (backlog 79) — tiền tố hết hạn ĐỌC của st-ethernet-ip 2.7.5: `_readTag` / `_readTagFragmented` dựng
 * `new Error(`TIMEOUT occurred while writing Reading Tag: ${tag.name}.`)` (dist/controller/index.js:730, :769).
 */
export const EIP_TIEN_TO_QUA_HAN_DOC = "TIMEOUT occurred while writing Reading Tag:";

/**
 * SCADA R1b-2b-2a T3A (backlog 79, dieu-phoi D2 2026-10-30) — PHIÊN NHIỄM. st-ethernet-ip 2.7.5 KHÔNG tương quan trả lời với yêu cầu: `_writeTag` /
 * `_readTag` gắn listener "Write Tag" / "Read Tag" rồi chỉ gỡ SAU `await promiseTimeout(…)` (dist/controller/index.js:814-831, :733-757) — hết hạn ⇒
 * listener của yêu cầu cũ CÒN GẮN; trả lời SendUnitData bị bỏ 2 byte số thứ tự (:1072) và định tuyến chỉ theo mã dịch vụ. Thăm dò thật (T3A Step 0):
 * ack MUỘN của lời ghi A giải lời ghi STOP kế = `ok` (~30 ms, STOP chưa từng được trả lời); trả lời MUỘN của đọc TagA ⇒ đọc TagB "good" mang giá trị
 * TagA. Gỡ listener thôi KHÔNG đủ (listener của chính yêu cầu kế vẫn nhận ack cũ) ⇒ BẤT KỲ hết hạn nào của thư viện (đọc / ghi) hoặc bộ hẹn dự phòng
 * của driver ⇒ Controller đó NHIỄM: hạ ngay (yêu cầu đang bay của nó ⇒ `mat_lien_ket`), mở Controller MỚI (EventEmitter mới — không listener cũ nào
 * qua được). Thao tác kế chờ phiên mới có TRẦN; quá trần ⇒ KHÔNG gửi gì, `failed` / unreachable (thấy được), không bao giờ `ok`.
 */
function laQuaHanThuVienEip(err: unknown): boolean {
  if (laLoiQuaHanYeuCauDriver(err)) return true;
  const m = (err as { message?: unknown } | null | undefined)?.message;
  return typeof m === "string" && (m.startsWith(EIP_TIEN_TO_QUA_HAN_GHI) || m.startsWith(EIP_TIEN_TO_QUA_HAN_DOC));
}

/**
 * T3A — trần chờ PHIÊN MỚI sau phiên nhiễm, cho MỘT lời gọi writeTags / readTags (tính từ đầu lời gọi). 2000 ms < hạn lệnh mặc định của dispatcher
 * (OT_CONTROL_TIMEOUT_MS 5000; hạn đua từ lúc gọi writeTags) ⇒ STOP chờ nối lại tối đa 2 s và còn ≥ 3 s cho chính lời ghi trên phiên mới (một vòng CIP
 * trên LAN ~ vài chục ms; nối lại = TCP + RegisterSession + ForwardOpen + identity + danh sách tag ~ 5–10 vòng). Quá trần ⇒ không gửi, `failed`.
 */
export const HAN_CHO_PHIEN_MOI_SAU_NHIEM_MS = 2000;

/**
 * SCADA R1b-2b-2a T3A commit 2 (dieu-phoi D1) — mã lỗi ỔN ĐỊNH khi tag ghi KHÔNG có kiểu CIP lấy được từ danh sách tag mà st-ethernet-ip đã nạp lúc
 * connect (`Controller.connect(…, SETUP=true)` ⇒ `getControllerTagList` ⇒ `state.tagList`). Trước đây `newTag` không mang kiểu ⇒ thư viện ném
 * "has not been initialized" ở `generateWriteMessageRequest` (tag/index.js:582-583) TRƯỚC `write_cip` ⇒ MỌI lời ghi EIP (kể cả STOP) `failed`, 0 gói.
 * Nay: kiểu = kiểu THẬT của PLC trong danh sách; không có / không phải kiểu nguyên tử ⇒ `failed` với mã này, KHÔNG gửi gì, không bao giờ đoán.
 */
export const MA_KIEU_TAG_EIP_KHONG_RO = "EIP_TAG_TYPE_UNKNOWN";

export class LoiKieuTagEipKhongRo extends Error {
  readonly code = MA_KIEU_TAG_EIP_KHONG_RO;
  constructor(
    readonly tenTag: string,
    readonly chuongTrinh: string | null,
  ) {
    super(
      `${MA_KIEU_TAG_EIP_KHONG_RO}: tag "${tenTag}"${chuongTrinh ? ` (program ${chuongTrinh})` : ""} has no atomic CIP type in the controller tag list loaded at connect — nothing sent`,
    );
    this.name = "LoiKieuTagEipKhongRo";
  }
}

/** Tên ghi được hỗ trợ: `Ten`, `Ten[i]` / `Ten[i,j]` (phần tử mảng), `Ten.N` / `Ten[i].N` (bit). Thành viên UDT (`A.B`) ⇒ không hỗ trợ (không đoán). */
const TEN_GHI_HO_TRO = /^([A-Za-z_][A-Za-z0-9_]*)(\[[0-9]+(?:,[0-9]+)*\])?(?:\.([0-9]{1,2}))?$/;

/**
 * T3A commit 2 — kiểu CIP của tag ghi từ danh sách tag của CHÍNH Controller (nạp lúc connect; không thêm vòng nào trước STOP). null ⇒ không rõ.
 *   • tag gốc phải có trong danh sách (đúng phạm vi chương trình), kiểu nguyên tử (không phải cấu trúc);
 *   • `Ten[i]` chỉ khi tag gốc là mảng; `Ten` (không chỉ số) chỉ khi tag gốc KHÔNG là mảng.
 */
export function kieuCipTuDanhSachTag(plc: any, ten: string, chuongTrinh: string | null): number | null {
  const ds = plc?.state?.tagList;
  if (!ds || typeof ds.getTag !== "function") return null;
  const m = TEN_GHI_HO_TRO.exec(ten);
  if (!m) return null;
  let t: any;
  try {
    t = ds.getTag(m[1], chuongTrinh);
  } catch {
    return null;
  }
  const kieu = t?.type;
  if (!kieu || kieu.structure === true || typeof kieu.code !== "number" || !Number.isInteger(kieu.code)) return null;
  const laMang = typeof kieu.arrayDims === "number" && kieu.arrayDims > 0;
  if (Boolean(m[2]) !== laMang) return null;
  return kieu.code;
}

/** Hạ một Controller không còn dùng (không chờ): forwardClose lịch sự, hỏng / quá hạn ⇒ huỷ socket. */
function haController(plc: any): void {
  if (!plc) return;
  try {
    if (typeof plc.disconnect === "function") {
      void Promise.resolve(plc.disconnect()).catch(() => {
        try {
          if (typeof plc.destroy === "function") plc.destroy();
        } catch {
          // ignore
        }
      });
    }
  } catch {
    // ignore
  }
}

/** Tách host (bỏ tcp:// và :port nếu có) — EtherNet/IP nối IP cố định cổng 44818. */
function parseHost(endpoint: string): string {
  let s = String(endpoint ?? "").trim();
  s = s.replace(/^tcp:\/\//i, "");
  const idx = s.lastIndexOf(":");
  if (idx > 0) {
    const host = s.slice(0, idx);
    if (host) return host;
  }
  return s || "127.0.0.1";
}

export class EthernetIpDriver extends NotImplementedDriver {
  readonly protocol: OtProtocol = "ethernet-ip";
  protected readonly packageName = "st-ethernet-ip";

  private plc: any = null;
  private connected = false;
  private connectedAt: Date | null = null;
  private lastOkAt: Date | undefined;
  private lastError: string | undefined;
  private lastLatencyMs: number | undefined;
  /**
   * SCADA R1b-2b-1 — yêu cầu đang bay theo Controller: `disconnect()` của st-ethernet-ip 2.7.5 hạ socket nhưng KHÔNG trả lời lệnh ghi đang
   * chờ — nó chỉ xong ở `promiseTimeout(timeout_sp)` (= hạn kết nối, mặc định 5000 ms) hoặc hạn 5000 ms của driver, rồi thành 'failed'.
   * Reject NGAY (kết cục không rõ) ở: close/error/Disconnected của Controller (markLinkLost), disconnect(), connect() khi thay Controller cũ.
   */
  private readonly dangBay = new SoYeuCauDangBay("ethernet-ip");
  /** T3A — cấu hình của connect() gần nhất (để mở phiên MỚI sau phiên nhiễm). */
  private cfg: OtConnectionConfig | null = null;
  /** T3A — thế hệ phiên: connect() / disconnect() tăng ⇒ một lần nối lại sau nhiễm đã lỗi thời không bao giờ cài Controller của nó. */
  private theHe = 0;
  /** T3A — lần mở phiên MỚI đang chạy sau phiên nhiễm (true = đã cài). `connected` giữ true trong lúc này; thất bại ⇒ connected=false (supervisor lo). */
  private noiLaiSauNhiem: Promise<boolean> | null = null;

  override async connect(cfg: OtConnectionConfig): Promise<void> {
    const mod: any = await this.loadPackage();
    if (!mod) {
      throw new Error("st-ethernet-ip not installed");
    }
    const Controller = mod.Controller ?? mod.default?.Controller ?? mod.default;
    if (typeof Controller !== "function") {
      throw new Error("st-ethernet-ip not installed");
    }
    // T12b fix round 1 — connect lại trên CÙNG driver: hạ Controller cũ trước (capture-and-null như disconnect; không chờ), không rò
    // socket. Listener mất-kết-nối của Controller cũ đã có chốt danh tính (`this.plc === plc`); mỗi Controller giữ giao dịch riêng.
    const cu = this.plc;
    this.theHe += 1; // T3A — lần nối lại sau nhiễm đang chạy (nếu có) thành lỗi thời
    this.noiLaiSauNhiem = null;
    this.cfg = cfg;
    if (cu) {
      this.plc = null;
      this.connected = false;
      this.dangBay.huy(cu, "reconnect replaced the session"); // R1b-2b-1 (iii)
      try {
        if (typeof cu.disconnect === "function") void Promise.resolve(cu.disconnect()).catch(() => undefined);
      } catch {
        // ignore
      }
    }
    let plc: any;
    try {
      plc = await this.moController(Controller, cfg);
    } catch (err) {
      this.lastError = (err as Error)?.message || String(err);
      throw err;
    }
    this.plc = plc;
    this.connected = true;
    this.connectedAt = new Date();
    this.lastError = undefined;
  }

  /**
   * Mở MỘT Controller đã nối (dùng cho connect() và cho phiên MỚI sau phiên nhiễm — T3A). Không chạm trạng thái driver; lỗi ⇒ hạ Controller đó rồi ném.
   */
  private async moController(Controller: any, cfg: OtConnectionConfig): Promise<any> {
    const plc = new Controller();

    const opts = cfg.options ?? {};
    const host = parseHost(cfg.endpoint);
    const slot = typeof opts.slot === "number" ? opts.slot : 0;
    const timeoutMs = cfg.timeoutMs ?? 5000;
    // R1b-2b-1 T7 (muc 11) — setter timeout_sp cua st-ethernet-ip doi SO; nghe 'error' TRUOC connect: EventEmitter khong nguoi nghe nem
    // 'error' => lam sap tien trinh. Listener canh `this.plc === plc` (chua gan luc dang ket noi) => khong lat phien.
    if (typeof timeoutMs === "number") plc.timeout_sp = timeoutMs;
    this.attachLinkLossHandlers(plc);

    try {
      await withTimeout(plc.connect(host, slot), timeoutMs, "eip connect");
      // doc 40 OT-F1 — st-ethernet-ip Controller là EventEmitter; lắng 'close'/'error'/
      // 'Disconnected' để phát hiện mất kết nối giữa phiên (rớt cáp / PLC reboot). Trước
      // đây `connected` chỉ lật ở disconnect() → supervisor không thấy rớt. Lật
      // connected=false → isConnected()/health() nói thật, supervisor reconnect/failover. (R1b-2b-1 T7: gắn TRƯỚC connect.)
      return plc;
    } catch (err) {
      try {
        if (typeof plc.disconnect === "function") await plc.disconnect();
      } catch {
        // ignore
      }
      throw err;
    }
  }

  /**
   * T3A — Controller `plc` NHIỄM (hết hạn của thư viện / bộ hẹn dự phòng): hạ NGAY nếu nó còn là phiên hiện tại — yêu cầu đang bay của nó reject
   * `LoiMatLienKetKhiDangGui` (kết cục không rõ) — rồi mở Controller MỚI ở nền (một lần; thế hệ chốt). Idempotent.
   */
  private nhiemPhien(plc: any, lyDo: string): void {
    if (!plc || this.plc !== plc) return;
    this.plc = null;
    this.lastError = `ethernet-ip session contaminated (${lyDo}) — torn down, reconnecting on a fresh session`;
    this.dangBay.huy(plc, `session contaminated: ${lyDo}`);
    haController(plc);
    const cfg = this.cfg;
    if (!cfg || !this.connected) return;
    const theHe = this.theHe;
    const p: Promise<boolean> = (async () => {
      const mod: any = await this.loadPackage();
      const Controller = mod?.Controller ?? mod?.default?.Controller ?? mod?.default;
      if (typeof Controller !== "function") throw new DeviceUnreachableError("ethernet-ip", "st-ethernet-ip not installed");
      return this.moController(Controller, cfg);
    })().then(
      (moi) => {
        if (this.theHe !== theHe || this.noiLaiSauNhiem !== p || !this.connected) {
          haController(moi);
          return false;
        }
        this.plc = moi;
        this.noiLaiSauNhiem = null;
        this.connectedAt = new Date();
        this.lastError = undefined;
        return true;
      },
      (err) => {
        if (this.theHe === theHe && this.noiLaiSauNhiem === p) {
          this.noiLaiSauNhiem = null;
          this.connected = false; // supervisor nối lại / chuyển dự phòng
          this.lastError = `ethernet-ip reconnect after a contaminated session failed: ${(err as Error)?.message || String(err)}`;
        }
        return false;
      },
    );
    this.noiLaiSauNhiem = p;
  }

  /**
   * T3A — Controller dùng được cho thao tác này: phiên hiện tại, hoặc chờ phiên MỚI sau nhiễm tới `hetHanLuc` (trần HAN_CHO_PHIEN_MOI_SAU_NHIEM_MS,
   * tính từ đầu lời gọi). Không có / quá trần ⇒ `DeviceUnreachableError` TRƯỚC khi gửi bất cứ gì.
   */
  private async layPhien(hetHanLuc: number): Promise<any> {
    if (this.plc) return this.plc;
    const p = this.noiLaiSauNhiem;
    if (!p || !this.connected) throw new DeviceUnreachableError("ethernet-ip");
    const conLai = hetHanLuc - Date.now();
    let t: ReturnType<typeof setTimeout> | undefined;
    const daCai =
      conLai > 0
        ? await Promise.race([p, new Promise<false>((r) => (t = setTimeout(() => r(false), conLai)))]).finally(() => clearTimeout(t))
        : false;
    if (daCai && this.plc) return this.plc;
    throw new DeviceUnreachableError(
      "ethernet-ip",
      `no fresh session within ${HAN_CHO_PHIEN_MOI_SAU_NHIEM_MS}ms after a contaminated session — nothing sent`,
    );
  }

  /** T3A — có phiên hiện tại hoặc đang mở phiên mới sau nhiễm. */
  private coPhienHoacDangMo(): boolean {
    return this.connected && (!!this.plc || !!this.noiLaiSauNhiem);
  }

  override async disconnect(): Promise<void> {
    // doc 81 Đợt 5 task F2 (item 28) — capture-and-null-first (see s7Driver.disconnect): a late completion of the old
    // Controller's disconnect never clears the session a later connect() opened on this same driver object.
    const plc = this.plc;
    this.plc = null;
    this.connected = false;
    this.theHe += 1; // T3A — lần nối lại sau nhiễm đang chạy (nếu có) không bao giờ cài
    this.noiLaiSauNhiem = null;
    this.dangBay.huy(plc, "session torn down (disconnect)"); // R1b-2b-1 (ii)
    if (plc && typeof plc.disconnect === "function") {
      try {
        await plc.disconnect();
      } catch {
        // ignore
      }
    }
  }

  override isConnected(): boolean {
    return this.connected;
  }

  /**
   * doc 40 OT-F1 — gắn listener mất-kết-nối vào Controller (EventEmitter). Chỉ lật
   * connected=false (reconnect do connectionSupervisor lo). Guard `this.plc===plc` chống
   * listener của kết nối cũ lật nhầm kết nối mới. Bọc try/catch cho package tối giản/mock.
   */
  private attachLinkLossHandlers(plc: any): void {
    if (!plc || typeof plc.on !== "function") return;
    for (const ev of ["close", "error", "Disconnected"]) {
      try {
        plc.on(ev, (arg?: unknown) => {
          if (this.plc === plc) this.markLinkLost(ev, arg, plc);
        });
      } catch {
        // ignore
      }
    }
  }

  /** Lật cờ mất kết nối (idempotent — chỉ tác động khi đang connected). */
  private markLinkLost(ev: string, arg: unknown, plc: any): void {
    const detail = arg ? `: ${(arg as Error)?.message ?? String(arg)}` : "";
    if (this.connected) {
      this.connected = false;
      this.lastError = `ethernet-ip link lost (${ev})${detail}`;
    }
    this.dangBay.huy(plc, `link ${ev}${detail}`); // R1b-2b-1 (i)
  }

  /**
   * Đọc một tag, trả OtSample. Lỗi → quality:"bad" (không throw).
   * R1b-2a T13 fix round 2 (m2) — `v2` do người gọi truyền: đường poll = ảnh chụp cờ lúc subscribe (cùng giá trị với huỷ tick và loạt mẫu
   * xấu của vòng poll), readTags công khai = đọc MỘT lần mỗi lời gọi. Không đọc cờ theo từng mẫu ⇒ một phiên không trộn hai hình dạng mẫu.
   */
  private async readOne(tag: OtTagAddress, abortOnCommLost: boolean, v2: boolean, hetHanLuc: number): Promise<OtSample> {
    const now = () => new Date();
    let plc: any = null;
    try {
      const { name, program } = parseEipTag(tag.address);
      plc = await this.layPhien(hetHanLuc); // T3A — phiên nhiễm ⇒ chỉ đọc trên phiên MỚI (có trần)
      const eipTag = plc.newTag(name, program ?? null);
      // T3A — qua sổ đang bay: phiên bị hạ vì nhiễm ⇒ reject NGAY, trả lời muộn trên Controller cũ không bao giờ thành mẫu "good".
      await this.dangBay.bay(plc, plc.readTag(eipTag));
      const raw = eipTag?.value;

      const co = coerceEipValue(raw, tag.dataType);
      let value = co.value;
      if (co.quality === "good" && typeof value === "number" && tag.dataType !== "bool") {
        // R1b-2b-1 T6 fix round 1 — scale xuôi + làm tròn int qua MỘT nguồn (`otScale.scaleXuoi`), cũng là nguồn mô phỏng của so đọc lại.
        value = scaleXuoi(value, tag.dataType === "int" ? "int" : "float", tag.scale, tag.offset);
      }

      if (co.quality === "good") this.lastOkAt = now();
      return {
        tagKey: tag.tagKey,
        raw,
        value: co.quality === "good" ? value : null,
        quality: co.quality,
        timestamp: now(),
        tsSource: "server", // doc 81 Đợt 4 Task B6 — stamped by the driver on receipt
        // R1b-2a T13 fix round 1 — readTag ĐÃ trả lời; giá trị không ép được ⇒ bad CÓ lý do (bad trần = chưa trả lời, mauMayChuDaTraLoi).
        ...(co.quality === "bad" && v2 ? MAU_GIA_TRI_HONG : {}),
      } satisfies OtSample;
    } catch (err) {
      // T3A — hết hạn của thư viện ⇒ listener "Read Tag" cũ còn gắn ⇒ phiên NHIỄM (hạ + mở phiên mới).
      if (laQuaHanThuVienEip(err)) this.nhiemPhien(plc, (err as Error)?.message || String(err));
      this.lastError = (err as Error)?.message || String(err);
      // SCADA R0 (C1) — đường poll, sau cờ: lỗi mức LIÊN KẾT (ECONNRESET/…, mất kết nối) ⇒ HUỶ cả tick (một loạt mẫu xấu do vòng poll phát);
      // T12 D3: giao dịch QUÁ HẠN cũng huỷ. Lỗi thiết bị theo từng tag. (`v2`: ảnh chụp của người gọi — m2.)
      if (abortOnCommLost && (laLoiHuyTickPoll(err) || !this.connected)) throw err;
      return {
        tagKey: tag.tagKey,
        raw: null,
        value: null,
        quality: "bad",
        timestamp: now(),
        tsSource: "server", // doc 81 Đợt 4 Task B6 — stamped by the driver on receipt
        // SCADA R0 (C2) — sau cờ: bộ phân loại chung (mạng ⇒ comm_lost, còn lại device_error + thông điệp cắt 80 ký tự).
        ...(v2 ? chatLuongLoiChung(err) : {}),
      } satisfies OtSample;
    }
  }

  override async readTags(tags: OtTagAddress[]): Promise<OtSample[]> {
    return this.docTuanTu(tags, false, chatLuongV2Bat());
  }

  /**
   * SCADA R0 (C1) — đường ĐỌC CHO VÒNG POLL (chỉ `subscribe` dùng). Cờ BẬT: lỗi mức LIÊN KẾT hoặc giao dịch QUÁ HẠN đầu tiên HUỶ cả tick (ném; T12 D3) để vòng poll
   * phát MỘT loạt mẫu xấu; cờ TẮT: y hệt `readTags`. `readTags` công khai (readback ghi thiết bị, probe, bộ đọc an toàn) KHÔNG BAO GIỜ huỷ:
   * luôn trả mẫu bad theo từng tag.
   */
  private docChoVongPoll(tags: OtTagAddress[], chatLuongV2: boolean): Promise<OtSample[]> {
    return this.docTuanTu(tags, chatLuongV2, chatLuongV2);
  }

  private async docTuanTu(tags: OtTagAddress[], abortOnCommLost: boolean, v2: boolean): Promise<OtSample[]> {
    if (!this.coPhienHoacDangMo()) {
      throw new DeviceUnreachableError("ethernet-ip");
    }
    if (tags.length === 0) return [];

    const t0 = Date.now();
    const hetHanLuc = t0 + HAN_CHO_PHIEN_MOI_SAU_NHIEM_MS; // T3A — một trần cho cả lô
    const out: OtSample[] = [];
    for (const tag of tags) {
      out.push(await this.readOne(tag, abortOnCommLost, v2, hetHanLuc));
    }
    this.lastLatencyMs = Date.now() - t0;
    return out;
  }

  override async subscribe(
    tags: OtTagAddress[],
    onSample: OnOtSample,
    intervalMs = 5000,
    tuyChon?: TuyChonVongPoll,
  ): Promise<OtSubscriptionHandle> {
    if (!this.connected) throw new DeviceUnreachableError("ethernet-ip");

    // Cờ đọc MỘT lần ở đây: huỷ tick (docChoVongPoll) và phát loạt mẫu xấu (taoVongPoll) không bao giờ lệch nhau.
    const v2 = chatLuongV2Bat();
    // SCADA R0 — vòng poll DÙNG CHUNG (chống chồng tick, hạn đọc, mẫu xấu một lần khi mất liên lạc sau cờ).
    return taoVongPoll({
      tags,
      intervalMs,
      deadlineMs: tuyChon?.deadlineMs,
      doc: async (t) => {
        try {
          return await this.docChoVongPoll(t, v2);
        } catch (e) {
          this.lastError = (e as Error)?.message || String(e);
          throw e;
        }
      },
      onSample,
      onTick: tuyChon?.onTick,
      phanLoiLoi: chatLuongLoiChung,
      chatLuongV2: v2,
      nhan: "ethernet-ip",
    });
  }

  /** Ghi một write; trả OtCommandResult (không throw). */
  private async writeOne(w: OtWrite, hetHanLuc: number): Promise<OtCommandResult> {
    let plc: any = null;
    try {
      const { name, program } = parseEipTag(w.address);
      const dataType = w.dataType ?? "float";
      const raw = inverseScale(w.value, dataType, w.scale ?? 1, w.offset ?? 0);
      const value = coerceEipWrite(raw, dataType, w.dungGhim);

      // T3A — phiên nhiễm ⇒ chờ phiên MỚI có trần; quá trần ⇒ DeviceUnreachableError TRƯỚC khi gửi (`failed`, không bao giờ `ok`).
      plc = await this.layPhien(hetHanLuc);
      // T3A commit 2 (D1) — kiểu CIP THẬT từ danh sách tag đã nạp lúc connect; không có ⇒ ném TRƯỚC newTag / gửi (`failed`, 0 gói).
      const kieuCip = kieuCipTuDanhSachTag(plc, name, program ?? null);
      if (kieuCip == null) throw new LoiKieuTagEipKhongRo(name, program ?? null);
      const eipTag = plc.newTag(name, program ?? null);
      eipTag.type = kieuCip;
      // st-ethernet-ip: set tag.value rồi await PLC.writeTag(tag).
      eipTag.value = value;
      // R1b-2b-1 — qua sổ đang bay: liên kết mất / phiên bị hạ ⇒ reject NGAY (kết cục không rõ), không chờ hạn rồi báo 'failed'.
      // R1b-2b-2a T2 — bộ hẹn dự phòng 6500 ms (trước: 5000 = đúng hạn lệnh ⇒ đua với dispatcher, B3 có thể không chạy).
      await withHanGhiDuPhong(this.dangBay.bay(plc, plc.writeTag(eipTag, value)), "eip writeTag");

      this.lastOkAt = new Date();
      return { tagKey: w.tagKey, ok: true };
    } catch (err) {
      const msg = (err as Error)?.message || String(err);
      // T3A — hết hạn của thư viện / bộ hẹn dự phòng ⇒ listener "Write Tag" cũ còn gắn ⇒ phiên NHIỄM: hạ + mở phiên mới; ack muộn của lời ghi
      // này không bao giờ tới được lời ghi kế (STOP). Kết cục của CHÍNH lời ghi này vẫn `qua_han_driver` (T2).
      if (laQuaHanThuVienEip(err)) this.nhiemPhien(plc, msg);
      this.lastError = msg;
      // R1b-2b-1 — lệnh ĐÃ giao cho thư viện khi liên kết mất: kết cục KHÔNG RÕ ⇒ ném lên (dispatcher ⇒ 'timeout' ngay), không 'failed'.
      if (laLoiMatLienKetKhiDangGui(err)) throw err;
      // R1b-2b-2a T2 (mục 66) — hết hạn của thư viện (`timeout_sp`) hoặc bộ hẹn dự phòng của driver khi gói đã gửi ⇒ kết cục KHÔNG RÕ của write này
      // (dispatcher ⇒ 'timeout'), không 'failed'. Lỗi CIP (PLC đã trả lời) / ép kiểu cục bộ ⇒ 'failed' như cũ.
      const ketCucKhongRo = ketCucKhongRoCua(err) ?? (laQuaHanGhiEip(err) ? "qua_han_driver" : null);
      if (ketCucKhongRo) return { tagKey: w.tagKey, ok: false, error: msg, ketCucKhongRo };
      return { tagKey: w.tagKey, ok: false, error: msg };
    }
  }

  /**
   * ⚠️ ONLY commandDispatcher may call this — write reaches physical device.
   *
   * Ghi giá trị xuống PLC EtherNet/IP. Reachable CHỈ qua HITL execute() →
   * dispatch(). Ghi TUẦN TỰ per-tag: parseEipTag→newTag→inverse scale/offset+
   * coerce→await writeTag. Lỗi 1 tag được cô lập (ok:false), không kéo sập batch.
   */
  override async writeTags(writes: OtWrite[]): Promise<OtCommandResult[]> {
    if (!this.coPhienHoacDangMo()) {
      throw new DeviceUnreachableError("ethernet-ip");
    }
    if (writes.length === 0) return [];

    const hetHanLuc = Date.now() + HAN_CHO_PHIEN_MOI_SAU_NHIEM_MS; // T3A — một trần cho cả lô
    const out: OtCommandResult[] = [];
    for (const w of writes) {
      out.push(await this.writeOne(w, hetHanLuc));
    }
    return out;
  }

  override async health(): Promise<OtHealth> {
    return {
      protocol: this.protocol,
      connected: this.connected,
      lastOkAt: this.lastOkAt ?? this.connectedAt ?? undefined,
      lastError: this.lastError,
      latencyMs: this.lastLatencyMs,
    };
  }
}

export function createEthernetIpDriver(): OtDriver {
  return new EthernetIpDriver();
}
