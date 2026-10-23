/**
 * Sprint F1.1 — Stub OT driver: mô phỏng dữ liệu thiết bị KHÔNG cần hạ tầng thật.
 *
 * Sinh giá trị xác định theo `tagKey` (sin + nhiễu nhẹ), áp scale/offset từ tag.
 * Dùng để E2E pipeline ingest → telemetry → (tuỳ chọn) UNS mà chưa cài driver thật.
 * SCADA R0 (C9) — stub CÓ KỊCH BẢN: `simDatLoi` (rớt kết nối / tag xấu / tag nghi ngờ / ép giá trị), `connectionOptions.simKichBan`
 * (tự rớt rồi có lại theo thời gian) và writeTags ghi vào RAM (readTags trả lại giá trị đã ghi). Dùng cho nghiệm thu R0 và nút "Lab" (M10).
 */
import type {
  OtProtocol,
  OtDriver,
  OtConnectionConfig,
  OtTagAddress,
  OtSample,
  OtSubscriptionHandle,
  OtCommandResult,
  OtHealth,
  OnOtSample,
  ProgramChecksumResult,
  TuyChonVongPoll,
} from "../otDriver";
import { createHash } from "node:crypto";
import { DeviceUnreachableError } from "../../../_core/deviceErrors";
import { taoVongPoll } from "../vongPoll";
import { chatLuongLoiChung, chatLuongV2Bat } from "../chatLuong";

/** Hash ổn định từ chuỗi để mỗi tagKey có pha riêng. */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * SCADA R0 (C9) — lỗi mô phỏng đặt bằng `simDatLoi` (GHI ĐÈ toàn bộ; `{}` = hết lỗi).
 * `giaTri` là giá trị kỹ thuật (đã qua scale/offset), ưu tiên hơn giá trị đã ghi RAM và hơn sóng sin.
 */
export interface LoiStub {
  matKetNoi?: boolean;
  tagXau?: string[];
  tagNghiNgo?: string[];
  giaTri?: Record<string, number | boolean | string>;
}

/** Kịch bản theo thời gian (`connectionOptions.simKichBan`, đọc ở `connect`): mất từ `matKetNoiSauMs` (mặc định 0), kéo dài `matKetNoiTrongMs` (bỏ trống = mãi mãi). */
interface KichBanStub {
  matKetNoiSauMs?: number;
  matKetNoiTrongMs?: number;
}

/** Các stub đang kết nối, theo endpoint (cho nút Lab của M10 và nghiệm thu). Gỡ khi `disconnect`. */
const stubDangChay = new Map<string, StubDriver>();

/** Instance stub đang kết nối ở `endpoint`; undefined nếu chưa `connect` hoặc đã `disconnect`. */
export function layStubDangChay(endpoint: string): StubDriver | undefined {
  return stubDangChay.get(endpoint);
}

function soHuuHan(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
}

export class StubDriver implements OtDriver {
  readonly protocol: OtProtocol = "stub";

  private connected = false;
  private connectedAt: Date | null = null;
  private lastError: string | undefined;
  private endpoint: string | null = null;
  /** SCADA R0 (C9) — lỗi mô phỏng hiện hành, giá trị ghi RAM, và cửa sổ mất kết nối theo thời gian [tu, den). */
  private loi: LoiStub = {};
  private readonly ram = new Map<string, number | boolean | string>();
  private matTu: number | null = null;
  private matDen = Number.POSITIVE_INFINITY;
  /**
   * doc 81 Đợt 8 task O1 — the program "loaded in" the simulated controller: `connectionOptions.simProgram` (a string) at
   * connect; null ⇔ no simulated program (the sim then reports supported:false, like a controller without the feature).
   */
  private simProgram: string | null = null;
  private simProgramFault: "error" | "hang" | null = null;

  async connect(cfg: OtConnectionConfig): Promise<void> {
    // SCADA R0 — đang mô phỏng mất kết nối (`simDatLoi({matKetNoi:true})` hoặc trong cửa sổ `simKichBan` của lần connect trước)
    // thì nối lại KHÔNG thành công, như một thiết bị thật không với tới: tránh chập chờn connected↔reconnecting của supervisor.
    // Kiểm TRƯỚC khi tính lại cửa sổ kịch bản (nối lại không được kéo dài/khởi động lại cửa sổ đang chạy).
    if (this.matKetNoiHieuLuc()) throw new DeviceUnreachableError("stub");
    this.connected = true;
    this.connectedAt = new Date();
    this.lastError = undefined;
    const p = cfg?.options?.simProgram;
    this.simProgram = typeof p === "string" ? p : null;

    // SCADA R0 (C9) — kịch bản tự rớt/có lại, tính theo đồng hồ (Date.now) từ lúc connect.
    const kb = cfg?.options?.simKichBan as KichBanStub | undefined;
    const sau = soHuuHan(kb?.matKetNoiSauMs);
    const trong = soHuuHan(kb?.matKetNoiTrongMs);
    if (kb && (sau !== undefined || trong !== undefined)) {
      this.matTu = Date.now() + (sau ?? 0);
      this.matDen = trong !== undefined ? this.matTu + trong : Number.POSITIVE_INFINITY;
    } else {
      this.matTu = null;
      this.matDen = Number.POSITIVE_INFINITY;
    }

    if (this.endpoint !== null && this.endpoint !== cfg.endpoint && stubDangChay.get(this.endpoint) === this) {
      stubDangChay.delete(this.endpoint);
    }
    this.endpoint = cfg.endpoint;
    stubDangChay.set(cfg.endpoint, this);
  }

  /**
   * SIM ONLY (C9) — đặt lỗi mô phỏng; GHI ĐÈ toàn bộ trạng thái lỗi trước đó (`{}` = hết lỗi). Giá trị đã ghi RAM
   * (`writeTags`) KHÔNG bị xoá. Lỗi theo thời gian của `simKichBan` độc lập với hàm này.
   */
  simDatLoi(l: LoiStub): void {
    this.loi = { ...l };
  }

  /** Đang mất kết nối mô phỏng (đặt tay hoặc trong cửa sổ kịch bản). */
  private matKetNoiHieuLuc(): boolean {
    if (this.loi.matKetNoi) return true;
    if (this.matTu === null) return false;
    const now = Date.now();
    return now >= this.matTu && now < this.matDen;
  }

  /**
   * doc 81 Đợt 8 task O1 — READ-ONLY checksum of the simulated program: "sha256:<hex of the program text>". Shares nothing
   * with writeTags (no queue). Throws when not connected or when a read fault is injected (never answers supported:false
   * for a failure).
   */
  async readProgramChecksum(opts: { signal?: AbortSignal } = {}): Promise<ProgramChecksumResult> {
    if (!this.connected) throw new DeviceUnreachableError("stub");
    // final wave: typed (rawErrorCensus) — the simulated controller "did not answer" the checksum read; detail kept
    if (this.simProgramFault === "error") throw new DeviceUnreachableError("stub", "sim program checksum read fault (injected)");
    if (this.simProgramFault === "hang") {
      // final wave (O M4) — a controller that never answers: the read settles ONLY when the caller aborts it (cancellation
      // contract); counted so a test can prove nothing is left pending.
      const signal = opts.signal;
      return new Promise<ProgramChecksumResult>((_, reject) => {
        if (!signal) {
          this.simPendingReads += 1; // contract violation by the caller (no signal): stays pending, and is counted
          return;
        }
        if (signal.aborted) return reject(new Error("program checksum read aborted"));
        this.simPendingReads += 1;
        signal.addEventListener(
          "abort",
          () => {
            this.simPendingReads -= 1;
            reject(new Error("program checksum read aborted"));
          },
          { once: true },
        );
      });
    }
    if (this.simProgram === null) return { supported: false, source: "sim" };
    return { supported: true, checksum: `sha256:${createHash("sha256").update(this.simProgram, "utf8").digest("hex")}`, source: "sim" };
  }

  /** SIM ONLY — a different program is loaded into the simulated controller (as a vendor tool would, outside this server). */
  simLoadProgram(program: string | null): void {
    this.simProgram = program;
  }

  /** SIM ONLY (final wave O M4) — checksum reads still pending (a "hang" read not yet aborted). */
  simPendingReads = 0;

  /** SIM ONLY — make the next checksum reads fail ("error"), never answer ("hang"), or work again (null). */
  simSetProgramReadFault(fault: "error" | "hang" | null): void {
    this.simProgramFault = fault;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    // gỡ đăng ký CHỈ khi chính mình còn là instance đang chạy ở endpoint đó (connect mới cùng endpoint đã thay thế).
    // Đang mô phỏng mất kết nối THỦ CÔNG (`simDatLoi({matKetNoi:true})`) thì GIỮ đăng ký: connect() ném trong lúc mất, nên nếu gỡ thì
    // không ai tìm lại được instance để `simDatLoi({})` (nút Lab của M10); kết thúc lỗi/connect lại thì quay về quy tắc thường.
    if (this.loi.matKetNoi) return;
    if (this.endpoint !== null && stubDangChay.get(this.endpoint) === this) stubDangChay.delete(this.endpoint);
  }

  isConnected(): boolean {
    return this.connected && !this.matKetNoiHieuLuc();
  }

  /** Sinh một mẫu mô phỏng cho một tag, áp scale/offset. */
  private sampleFor(tag: OtTagAddress): OtSample {
    const now = Date.now();
    const phase = hashString(tag.tagKey) % 1000;
    const base = Math.sin((now / 1000 + phase) * 0.1);          // [-1, 1]
    const noise = (Math.random() - 0.5) * 0.05;
    const scale = tag.scale ?? 1;
    const offset = tag.offset ?? 0;

    let value: number | string | boolean | null;
    let raw: unknown;
    switch (tag.dataType) {
      case "bool":
        value = base > 0;
        raw = value;
        break;
      case "int": {
        const n = Math.round((base + noise) * 100) * scale + offset;
        value = Math.round(n);
        raw = value;
        break;
      }
      case "float": {
        const n = (base + noise) * scale + offset;
        value = Math.round(n * 1e6) / 1e6;
        raw = value;
        break;
      }
      case "string":
        value = `${tag.tagKey}:${base.toFixed(3)}`;
        raw = value;
        break;
      case "json": {
        const obj = { tagKey: tag.tagKey, base: Math.round(base * 1e6) / 1e6, ts: now };
        value = JSON.stringify(obj);
        raw = obj;
        break;
      }
      default:
        value = null;
        raw = null;
    }

    return {
      tagKey: tag.tagKey,
      raw,
      value,
      quality: "good",
      timestamp: new Date(now),
      tsSource: "server", // doc 81 Đợt 4 Task B6 — stamped by the driver on receipt
    };
  }

  /**
   * Mẫu cho một tag có áp lỗi mô phỏng. Ưu tiên giá trị: `giaTri` > đã ghi RAM > sóng sin.
   * tagXau ⇒ bad (không giá trị); tagNghiNgo ⇒ uncertain GIỮ giá trị. Áp dụng bất kể cờ OT_CHAT_LUONG_V2_ENABLED
   * (là yêu cầu mô phỏng tường minh; cờ chỉ quyết định vòng poll có phát loạt mẫu xấu khi mất liên lạc hay không).
   */
  private mauCoLoi(tag: OtTagAddress): OtSample {
    const sin = this.sampleFor(tag);
    const ghi = this.loi.giaTri && tag.tagKey in this.loi.giaTri ? this.loi.giaTri[tag.tagKey] : this.ram.get(tag.tagKey);
    const mau: OtSample = ghi === undefined ? sin : { ...sin, raw: ghi, value: ghi };
    if (this.loi.tagXau?.includes(tag.tagKey)) {
      return { ...mau, raw: null, value: null, quality: "bad", statusCode: "stub_bad", reason: "device_error" };
    }
    if (this.loi.tagNghiNgo?.includes(tag.tagKey)) {
      return { ...mau, quality: "uncertain", statusCode: "stub_uncertain", reason: "device_error" };
    }
    return mau;
  }

  async readTags(tags: OtTagAddress[]): Promise<OtSample[]> {
    if (!this.connected || this.matKetNoiHieuLuc()) throw new DeviceUnreachableError("stub");
    return tags.map((t) => this.mauCoLoi(t));
  }

  async subscribe(
    tags: OtTagAddress[],
    onSample: OnOtSample,
    intervalMs = 5000,
    tuyChon?: TuyChonVongPoll,
  ): Promise<OtSubscriptionHandle> {
    if (!this.connected) throw new DeviceUnreachableError("stub");

    // Cờ đọc MỘT lần ở đây (cùng mẫu với các driver khác). Vòng poll dùng chung: chống chồng tick, hạn đọc, mẫu xấu MỘT lần khi mất liên lạc (sau cờ).
    const v2 = chatLuongV2Bat();
    return taoVongPoll({
      tags,
      intervalMs,
      deadlineMs: tuyChon?.deadlineMs,
      doc: (t) => this.readTags(t),
      onSample,
      onTick: tuyChon?.onTick,
      phanLoiLoi: chatLuongLoiChung,
      chatLuongV2: v2,
      nhan: "stub",
    });
  }

  /** Ghi vào RAM (C9): `readTags` trả lại giá trị đã ghi. Mất kết nối ⇒ ok:false (như thiết bị thật không nhận lệnh). */
  async writeTags(
    writes: Array<{ tagKey: string; address: string; value: unknown }>,
  ): Promise<OtCommandResult[]> {
    if (!this.connected || this.matKetNoiHieuLuc()) {
      return writes.map((w) => ({ tagKey: w.tagKey, ok: false, error: "stub: not connected" }));
    }
    return writes.map((w) => {
      const v = w.value;
      if (typeof v !== "number" && typeof v !== "boolean" && typeof v !== "string") {
        return { tagKey: w.tagKey, ok: false, error: "stub: unsupported value type" };
      }
      this.ram.set(w.tagKey, v);
      return { tagKey: w.tagKey, ok: true };
    });
  }

  async health(): Promise<OtHealth> {
    return {
      protocol: this.protocol,
      connected: this.isConnected(),
      lastOkAt: this.connectedAt ?? undefined,
      lastError: this.lastError,
    };
  }
}

/** Factory cho registry. */
export function createStubDriver(): OtDriver {
  return new StubDriver();
}
