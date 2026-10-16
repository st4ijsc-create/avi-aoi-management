/**
 * hangDoiUuTienLlm.ts — Đợt 0.3: **CỔNG ƯU TIÊN trước `llama-server`.**
 *
 * ─── VÌ SAO ──────────────────────────────────────────────────────────────────────────────────
 * Chủ dự án chốt giữ `llama-server` **1 slot × 64k ctx** (Qwen3.6-35B-A3B) và KHÔNG dựng server
 * thứ hai. Với một slot, mọi lượt sinh chữ (`serverGenerateText`, `serverChatCompletion`,
 * `serverGenerateJSON`, hai đường stream, FIM khi dùng chung server) xếp vào hàng **FIFO nội bộ
 * của llama-server** — hàng đó không biết ai là người đang ngồi chờ, ai là cron 03:00. Một lượt
 * eval KB 111 câu xếp trước câu hỏi của kỹ sư là kỹ sư chờ hàng phút.
 *
 * Ta KHÔNG ngắt được lượt đang chạy (llama.cpp không có tiền-chiếm). Cái làm được là **giữ các
 * lượt CHỜ ở phía mình** và chỉ thả xuống server đúng số slot nó có — rồi chọn lượt thả theo mức:
 *   tuong-tac (người dùng HTTP đang chờ)  >  agent (vòng agent nhiều lượt)  >  nen (cron/eval/báo cáo).
 * Trong cùng mức: FIFO.
 *
 * ─── HỢP ĐỒNG ────────────────────────────────────────────────────────────────────────────────
 *   • Mức đi theo NGỮ CẢNH (`AsyncLocalStorage`), không theo tham số: nguồn nền bọc ĐIỂM VÀO của
 *     nó bằng `chayVoiUuTien("nen", …)` một lần, mọi lượt LLM sâu bên dưới tự mang mức đó — không
 *     phải luồn tham số qua 5 tầng service (và không có tầng thứ 6 nào quên luồn).
 *   • Không có ngữ cảnh ⇒ `tuong-tac`. Lý do: lượt không ai khai báo gần như luôn là một yêu cầu
 *     HTTP của người dùng; đoán sai theo hướng này chỉ làm một việc nền đi sớm (hành vi CŨ), đoán
 *     ngược lại sẽ bắt người dùng chờ sau cron — đúng thứ cổng sinh ra để chặn.
 *   • Chống đói: lượt dưới mức cao nhất chờ quá `LLM_PRIORITY_GATE_AGING_MS` (mặc định 120 s) được
 *     coi ngang `tuong-tac` và xếp theo thứ tự ĐẾN ⇒ một luồng tương tác dày không giam nền mãi.
 *     Tính LƯỜI ở lúc chọn lượt (không cần đồng hồ riêng cho mỗi lượt chờ).
 *   • Trần: độ dài hàng (`LLM_PRIORITY_GATE_QUEUE_MAX`, mặc định 32) ⇒ `LoiHangDoiLlmQuaTai`;
 *     thời gian chờ (`LLM_PRIORITY_GATE_WAIT_MS`, mặc định 300 s) ⇒ `LoiHangDoiLlmHetGioCho`;
 *     `AbortSignal` huỷ khi đang chờ (người dùng bấm Dừng) ⇒ rời hàng NGAY, `LoiHangDoiLlmBiHuy`
 *     (`name = "AbortError"` — các tầng trên vốn nhận diện huỷ bằng tên đó / `signal.aborted`).
 *   • Stream: slot giữ SUỐT vòng đời generator, nhả ở `finally` (xong / ném / `return()` sớm).
 *     Van an toàn: một lượt giữ slot quá `LLM_PRIORITY_GATE_HOLD_MAX_MS` (mặc định 15 phút — gấp
 *     nhiều lần lượt dài nhất có thể với ngân sách nghĩ 12k) bị THU HỒI slot kèm cảnh báo. Lý do:
 *     một generator bị consumer BỎ RƠI mà không `return()` sẽ không bao giờ chạy `finally`; không
 *     có van thì một lỗi như thế khoá cứng mọi lượt LLM của tiến trình. Thu hồi nhầm một lượt đang
 *     sống chỉ cho thêm MỘT lượt xuống hàng FIFO của llama-server — tức đúng hành vi trước cổng.
 *   • Cờ tắt `LLM_PRIORITY_GATE_ENABLED=false` ⇒ `quaCongUuTien*` gọi thẳng `fn` — hành vi cũ y
 *     nguyên (không xếp hàng, không đếm).
 *
 * ─── GIỚI HẠN (nói thẳng) ────────────────────────────────────────────────────────────────────
 * Cổng là của TIẾN TRÌNH NÀY. Kẻ gọi `:8091` từ tiến trình khác (script `scripts/ai-eval/*`, một
 * replica thứ hai, extension gọi thẳng) không đi qua nó ⇒ cổng không thấy và không xếp họ được.
 * Số slot là CẤU HÌNH (`LLAMA_SERVER_SLOTS`, cùng biến mà `scripts/ai/start-llama-server.ps1`
 * dùng để dựng `-np`), không hỏi `/props` — cùng lý do `serverSlotContextTokens` không hỏi: hàm
 * nằm trên đường sinh chữ, phải thuần + đồng bộ.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type MucUuTien = "tuong-tac" | "agent" | "nen";

const CAC_MUC: readonly MucUuTien[] = ["tuong-tac", "agent", "nen"];
/** Hạng: nhỏ hơn = đi trước. */
const HANG: Record<MucUuTien, number> = { "tuong-tac": 0, agent: 1, nen: 2 };

/** Báo cho người đang chờ (vd. luồng SSE) rằng lượt của họ phải xếp hàng. */
export interface ThongBaoCho {
  /** Số lượt đứng trước: đang chạy + đang chờ được xếp trên lượt này, tại lúc vào hàng. */
  phiaTruoc: number;
  muc: MucUuTien;
}
export type NgheCho = (p: ThongBaoCho) => void;

interface NguCanhUuTien {
  muc: MucUuTien;
  nghe?: NgheCho;
  /** Trần chờ RIÊNG của nguồn này (nhỏ hơn trần chung mới có tác dụng). */
  choToiDaMs?: number;
}

export interface TuyChonUuTien {
  /**
   * Trần chờ riêng cho mọi lượt LLM bên trong (lấy MIN với trần chung). Dành cho nguồn nền mà
   * kẻ khác đang `await` — vd. làm giàu cảnh báo bằng AI nằm TRÊN đường gửi cảnh báo: thà bỏ phần
   * làm giàu còn hơn giữ cảnh báo lại 5 phút sau hàng người dùng.
   */
  choToiDaMs?: number;
}

/** Tham số của một lượt xin slot. */
export interface TuyChonXin {
  signal?: AbortSignal;
  nghe?: NgheCho;
  choToiDaMs?: number;
}

const khoNguCanh = new AsyncLocalStorage<NguCanhUuTien>();

/**
 * Chạy `fn` với mức ưu tiên `muc` cho MỌI lượt LLM bên trong nó (lan qua `await`, timer, lồng
 * nhau — ngữ cảnh trong cùng thắng). Giữ nguyên người nghe chờ của ngữ cảnh ngoài.
 */
export function chayVoiUuTien<T>(muc: MucUuTien, fn: () => T, tuyChon?: TuyChonUuTien): T {
  const ngoai = khoNguCanh.getStore();
  return khoNguCanh.run({ muc, nghe: ngoai?.nghe, choToiDaMs: tuyChon?.choToiDaMs ?? ngoai?.choToiDaMs }, fn);
}

/** Mức của ngữ cảnh hiện tại; không có ngữ cảnh ⇒ `tuong-tac` (xem đầu tệp vì sao). */
export function mucUuTienHienTai(): MucUuTien {
  return khoNguCanh.getStore()?.muc ?? "tuong-tac";
}

/**
 * Gắn một người nghe "phải xếp hàng" cho các lượt LLM bên trong `fn` (giữ nguyên mức hiện tại).
 * Dành cho tuyến SSE: phát "đang chờ lượt model (N phía trước)" thay vì im lặng.
 */
export function chayVoiNgheCho<T>(nghe: NgheCho, fn: () => T): T {
  const ngoai = khoNguCanh.getStore();
  return khoNguCanh.run({ muc: ngoai?.muc ?? "tuong-tac", nghe, choToiDaMs: ngoai?.choToiDaMs }, fn);
}

// ─── Lỗi có mã ─────────────────────────────────────────────────────────────────────────────────

export class LoiHangDoiLlmQuaTai extends Error {
  readonly code = "LLM_QUEUE_OVERLOADED";
  constructor(message = "Hàng chờ model AI đang đầy — thử lại sau ít phút") {
    super(message);
    this.name = "LoiHangDoiLlmQuaTai";
  }
}

export class LoiHangDoiLlmHetGioCho extends Error {
  readonly code = "LLM_QUEUE_WAIT_TIMEOUT";
  constructor(message = "Chờ lượt model AI quá lâu — model đang bận, thử lại sau") {
    super(message);
    this.name = "LoiHangDoiLlmHetGioCho";
  }
}

/** `name = "AbortError"` CỐ Ý: các tầng trên nhận diện "người dùng huỷ" bằng đúng tên này. */
export class LoiHangDoiLlmBiHuy extends Error {
  readonly code = "LLM_QUEUE_ABORTED";
  constructor(message = "Đã huỷ khi đang chờ lượt model AI") {
    super(message);
    this.name = "AbortError";
  }
}

const MA_LOI_CONG = new Set(["LLM_QUEUE_OVERLOADED", "LLM_QUEUE_WAIT_TIMEOUT", "LLM_QUEUE_ABORTED"]);

/**
 * Lỗi này đến từ CỔNG (chưa hề chạm server) chứ không phải từ llama-server? Tầng engine dùng nó
 * để KHÔNG diễn giải nhầm "hàng đầy" thành "server hỏng" (và không lùi in-process vì nó).
 */
export function laLoiHangDoiLlm(e: unknown): boolean {
  const ma = (e as { code?: unknown } | null)?.code;
  return typeof ma === "string" && MA_LOI_CONG.has(ma);
}

// ─── Cấu hình ──────────────────────────────────────────────────────────────────────────────────

function envSoDuong(ten: string): number | undefined {
  const raw = process.env[ten];
  if (raw === undefined || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : undefined;
}

/** Mặc định BẬT; chỉ đúng chuỗi `false` mới tắt (một lỗi gõ không được lặng lẽ tắt cổng). */
export function congUuTienBat(): boolean {
  return (process.env.LLM_PRIORITY_GATE_ENABLED ?? "").trim().toLowerCase() !== "false";
}

/**
 * Số lượt được thả xuống llama-server cùng lúc = số slot của nó. Thứ tự nguồn:
 *   1. `LLM_PRIORITY_GATE_CONCURRENCY` — người vận hành ép riêng cho cổng.
 *   2. `LLAMA_SERVER_SLOTS` — biến `.env` mà script khởi động dùng để dựng `-np` (nguồn sự thật
 *      của cấu hình đang chạy: `.env` hiện là 1).
 *   3. `LLAMA_SERVER_PARALLEL` — tên cũ mà `serverSlotContextTokens()` đọc.
 *   4. 1.
 */
export function soSlotLlamaServer(): number {
  return (
    envSoDuong("LLM_PRIORITY_GATE_CONCURRENCY") ??
    envSoDuong("LLAMA_SERVER_SLOTS") ??
    envSoDuong("LLAMA_SERVER_PARALLEL") ??
    1
  );
}

export interface CauHinhCong {
  soSlot: number;
  hangToiDa: number;
  choToiDaMs: number;
  nguongNangMs: number;
  giuToiDaMs?: number;
  /** Đồng hồ cho phép chọn lượt (chống đói); test thay được. */
  dongHo?: () => number;
}

// ─── Cổng ──────────────────────────────────────────────────────────────────────────────────────

interface LuotCho {
  muc: MucUuTien;
  thuTu: number;
  tDen: number;
  traSlot: (nha: () => void) => void;
  tuChoi: (e: Error) => void;
  hetGio: ReturnType<typeof setTimeout> | null;
  boNgheHuy?: () => void;
}

export interface ThongKeCong {
  soSlot: number;
  dangChay: number;
  dangCho: Record<MucUuTien, number>;
  daPhucVu: number;
  daNangChongDoi: number;
  tuChoiQuaTai: number;
  hetGioCho: number;
  huyKhiCho: number;
  thuHoiCuong: number;
  /** Thời gian chờ của tối đa 200 lượt GẦN NHẤT đã được thả (gồm cả lượt không phải chờ: 0 ms). */
  choGanDay: { soMau: number; p50Ms: number; maxMs: number };
}

const SO_MAU_CHO = 200;

export class CongUuTienLlm {
  private dangChay = 0;
  private readonly hang: LuotCho[] = [];
  private demThuTu = 0;
  private readonly mauCho: number[] = [];
  private readonly dem = { daPhucVu: 0, daNangChongDoi: 0, tuChoiQuaTai: 0, hetGioCho: 0, huyKhiCho: 0, thuHoiCuong: 0 };
  private readonly dongHo: () => number;

  constructor(private readonly ch: CauHinhCong) {
    this.dongHo = ch.dongHo ?? Date.now;
  }

  /** Chạy `fn` khi tới lượt; nhả slot ở MỌI đường ra. */
  async chay<T>(muc: MucUuTien, fn: () => Promise<T>, tuyChon: TuyChonXin = {}): Promise<T> {
    const nha = await this.xin(muc, tuyChon);
    try {
      return await fn();
    } finally {
      nha();
    }
  }

  /**
   * Bản cho generator: xin slot ở lần `.next()` đầu, giữ suốt vòng đời luồng gốc, nhả ở `finally`
   * — gồm cả khi consumer `return()`/`break` sớm (client bỏ đi). Chờ rồi bị huỷ ⇒ luồng gốc KHÔNG
   * bao giờ được mở (không một byte nào gửi tới server).
   */
  async *chayLuong<T>(
    muc: MucUuTien,
    moLuong: () => AsyncGenerator<T>,
    tuyChon: TuyChonXin = {},
  ): AsyncGenerator<T> {
    const nha = await this.xin(muc, tuyChon);
    try {
      yield* moLuong();
    } finally {
      nha();
    }
  }

  /** Xin một slot. Trả về hàm nhả (gọi nhiều lần vô hại). */
  xin(muc: MucUuTien, { signal, nghe, choToiDaMs }: TuyChonXin = {}): Promise<() => void> {
    if (signal?.aborted) {
      this.dem.huyKhiCho++;
      return Promise.reject(new LoiHangDoiLlmBiHuy());
    }
    if (this.dangChay < this.ch.soSlot && this.hang.length === 0) {
      this.dangChay++;
      this.ghiCho(0);
      return Promise.resolve(this.taoHamNha());
    }
    if (this.hang.length >= this.ch.hangToiDa) {
      this.dem.tuChoiQuaTai++;
      return Promise.reject(new LoiHangDoiLlmQuaTai());
    }

    return new Promise<() => void>((resolve, reject) => {
      const luot: LuotCho = {
        muc,
        thuTu: this.demThuTu++,
        tDen: this.dongHo(),
        traSlot: resolve,
        tuChoi: reject,
        hetGio: null,
      };
      luot.hetGio = setTimeout(() => {
        if (!this.roiHang(luot)) return;
        this.dem.hetGioCho++;
        reject(new LoiHangDoiLlmHetGioCho());
      }, Math.min(this.ch.choToiDaMs, choToiDaMs ?? Infinity));
      luot.hetGio.unref?.();
      if (signal) {
        const khiHuy = () => {
          if (!this.roiHang(luot)) return;
          this.dem.huyKhiCho++;
          reject(new LoiHangDoiLlmBiHuy());
        };
        signal.addEventListener("abort", khiHuy, { once: true });
        luot.boNgheHuy = () => signal.removeEventListener("abort", khiHuy);
      }

      const bayGio = this.dongHo();
      const khoaToi = this.khoa(luot, bayGio);
      const phiaTruoc =
        this.dangChay + this.hang.filter((k) => this.soKhoa(this.khoa(k, bayGio), khoaToi) < 0).length;
      this.hang.push(luot);
      if (nghe) {
        try {
          nghe({ phiaTruoc, muc });
        } catch {
          /* người nghe hỏng không được làm hỏng lượt LLM */
        }
      }
    });
  }

  thongKe(): ThongKeCong {
    const dangCho = { "tuong-tac": 0, agent: 0, nen: 0 } as Record<MucUuTien, number>;
    for (const l of this.hang) dangCho[l.muc]++;
    const sx = [...this.mauCho].sort((a, b) => a - b);
    return {
      soSlot: this.ch.soSlot,
      dangChay: this.dangChay,
      dangCho,
      ...this.dem,
      choGanDay: {
        soMau: sx.length,
        p50Ms: sx.length ? sx[Math.floor((sx.length - 1) / 2)] : 0,
        maxMs: sx.length ? sx[sx.length - 1] : 0,
      },
    };
  }

  // ── nội bộ ──

  /** Khoá xếp hạng HIỆU LỰC: [hạng sau chống đói, thứ tự đến]. */
  private khoa(l: LuotCho, bayGio: number): [number, number] {
    const hang = HANG[l.muc];
    const hieuLuc = hang > 0 && bayGio - l.tDen >= this.ch.nguongNangMs ? 0 : hang;
    return [hieuLuc, l.thuTu];
  }

  private soKhoa(a: [number, number], b: [number, number]): number {
    return a[0] - b[0] || a[1] - b[1];
  }

  /** Gỡ lượt khỏi hàng; `false` nếu nó đã rời (đã được thả / đã huỷ) — chống xử lý hai lần. */
  private roiHang(l: LuotCho): boolean {
    const i = this.hang.indexOf(l);
    if (i < 0) return false;
    this.hang.splice(i, 1);
    if (l.hetGio) clearTimeout(l.hetGio);
    l.boNgheHuy?.();
    return true;
  }

  private ghiCho(ms: number): void {
    this.dem.daPhucVu++;
    this.mauCho.push(ms);
    if (this.mauCho.length > SO_MAU_CHO) this.mauCho.shift();
  }

  private taoHamNha(): () => void {
    let daNha = false;
    const nha = () => {
      if (daNha) return;
      daNha = true;
      if (van) clearTimeout(van);
      this.dangChay = Math.max(0, this.dangChay - 1);
      this.tha();
    };
    const giuToiDa = this.ch.giuToiDaMs ?? 0;
    const van =
      giuToiDa > 0
        ? setTimeout(() => {
            if (daNha) return;
            this.dem.thuHoiCuong++;
            console.warn(
              `[hangDoiUuTienLlm] một lượt giữ slot llama-server quá ${giuToiDa} ms mà không nhả — THU HỒI ` +
                "slot (nhiều khả năng một generator bị bỏ rơi không return()). Xem LLM_PRIORITY_GATE_HOLD_MAX_MS.",
            );
            nha();
          }, giuToiDa)
        : null;
    van?.unref?.();
    return nha;
  }

  /** Thả lượt chờ tốt nhất cho mỗi slot rảnh. */
  private tha(): void {
    while (this.dangChay < this.ch.soSlot && this.hang.length > 0) {
      const bayGio = this.dongHo();
      let tot = this.hang[0];
      let khoaTot = this.khoa(tot, bayGio);
      for (let i = 1; i < this.hang.length; i++) {
        const k = this.khoa(this.hang[i], bayGio);
        if (this.soKhoa(k, khoaTot) < 0) {
          tot = this.hang[i];
          khoaTot = k;
        }
      }
      this.roiHang(tot);
      if (khoaTot[0] < HANG[tot.muc]) this.dem.daNangChongDoi++;
      this.dangChay++;
      this.ghiCho(Math.max(0, bayGio - tot.tDen));
      tot.traSlot(this.taoHamNha());
    }
  }
}

// ─── Thể hiện dùng chung của tiến trình ───────────────────────────────────────────────────────

let congChung: CongUuTienLlm | null = null;

function layCong(): CongUuTienLlm {
  if (!congChung) {
    congChung = new CongUuTienLlm({
      soSlot: soSlotLlamaServer(),
      hangToiDa: envSoDuong("LLM_PRIORITY_GATE_QUEUE_MAX") ?? 32,
      choToiDaMs: envSoDuong("LLM_PRIORITY_GATE_WAIT_MS") ?? 300_000,
      nguongNangMs: envSoDuong("LLM_PRIORITY_GATE_AGING_MS") ?? 120_000,
      giuToiDaMs: envSoDuong("LLM_PRIORITY_GATE_HOLD_MAX_MS") ?? 15 * 60_000,
    });
  }
  return congChung;
}

/**
 * Điểm cắm cho lượt KHÔNG-stream xuống llama-server. Mức lấy từ ngữ cảnh. Cờ tắt ⇒ gọi thẳng.
 */
export function quaCongUuTien<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!congUuTienBat()) return fn();
  const nc = khoNguCanh.getStore();
  return layCong().chay(nc?.muc ?? "tuong-tac", fn, { signal, nghe: nc?.nghe, choToiDaMs: nc?.choToiDaMs });
}

/** Điểm cắm cho lượt STREAM: slot giữ suốt vòng đời generator. Cờ tắt ⇒ đi thẳng. */
export async function* quaCongUuTienLuong<T>(
  moLuong: () => AsyncGenerator<T>,
  signal?: AbortSignal,
): AsyncGenerator<T> {
  if (!congUuTienBat()) {
    yield* moLuong();
    return;
  }
  const nc = khoNguCanh.getStore();
  yield* layCong().chayLuong(nc?.muc ?? "tuong-tac", moLuong, { signal, nghe: nc?.nghe, choToiDaMs: nc?.choToiDaMs });
}

/** Ảnh chụp cho `/api/health/ai`. */
export function thongKeHangDoiLlm(): ThongKeCong & { batCong: boolean; cacMuc: readonly MucUuTien[] } {
  return { batCong: congUuTienBat(), cacMuc: CAC_MUC, ...layCong().thongKe() };
}

/** Chỉ cho test: bỏ thể hiện chung để lần gọi sau dựng lại từ env. */
export function __datLaiCongUuTienChoTest(): void {
  congChung = null;
}
