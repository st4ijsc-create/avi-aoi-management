/**
 * ★★ Đợt 7.1 — BỘ LẬP LỊCH KHE NẶNG. Spec: docs/superpowers/specs/2026-10-20-ai-local-da-model-va-luong-tu-dong-design.md §3.5.
 *
 * Một llama-server (Q5: 1 × 64k) giữ MỘT model nặng. Yêu cầu cho model nặng khác ⇒ phải đổi khe (13–43 s đo Đợt 6).
 * Đổi theo yêu cầu đến là ĐẬP (A,B,A,B… mỗi lượt một lần đổi). Lớp này đứng TRƯỚC cổng ưu tiên và quyết KHI NÀO đổi:
 *   • gom: phục vụ hết yêu cầu khớp model đang giữ; người chờ model khác xếp hàng;
 *   • ĐỔI khi đã lưu trú ≥ `luuTruToiThieuMs` VÀ (người chờ là `tuong-tac` · HOẶC chờ ≥ `choNenToiDaMs` · HOẶC model
 *     đang giữ RẢNH ≥ `ranhDeDoiMs`);
 *   • quyết đổi ⇒ "XẢ": lượt mới cho model cũ cũng vào hàng; lượt đang chạy về 0 ⇒ đổi;
 *   • rảnh ≥ `veNhaSauMs` mà đang giữ model khác nhà ⇒ về nhà;
 *   • đổi hỏng ⇒ người chờ model đó bị từ chối NÓI THẬT, model nghỉ `nghiSauHongMs` (không đập vào một model hỏng).
 *
 * THUẦN với I/O tiêm vào (`BoPhucVuKheNang`) — đồng hồ là `Date.now` (lưới dùng đồng hồ giả của vitest).
 * KHÔNG ngắt lượt đang chạy (llama.cpp không tiền-chiếm) — chỉ giữ lượt CHỜ.
 */
import type { MucUuTien } from "../hangDoiUuTienLlm";

export interface BoPhucVuKheNang {
  /** Basename model llama-server đang giữ (`/props`); `null` = không đọc được (chết / đang nạp). */
  modelDangGiu(): Promise<string | null>;
  /** Đổi khe sang `model` (basename). Ném khi hỏng — bên dưới đã tự quay về model nhà. */
  doiSang(model: string): Promise<void>;
  /**
   * ★ Đợt 9 — KHOÁ KHE (`khoaKhe.ts`): khoá còn hạn ⇒ KHÔNG đổi khe, KHÔNG về nhà; người chờ model khác bị từ chối nói thật.
   * Vắng ⇒ không bao giờ khoá (lưới cũ, hành vi 7.1).
   */
  khoaKhe?(): { chu: string; lyDo: string; hetHan: number } | null;
}

export interface CauHinhKheNang {
  luuTruToiThieuMs: number;
  choNenToiDaMs: number;
  ranhDeDoiMs: number;
  veNhaSauMs: number;
  nghiSauHongMs: number;
  xacNhanMs: number;
  choToiDaMs: number;
  /** `false` ⇒ không bao giờ tự đổi (tiến trình worker; cờ `AI_KHE_NANG_HOAN_DOI=false`). */
  tuDoi: boolean;
}

export const CAU_HINH_MAC_DINH: CauHinhKheNang = {
  luuTruToiThieuMs: 60_000,
  choNenToiDaMs: 10 * 60_000,
  ranhDeDoiMs: 10_000,
  veNhaSauMs: 15 * 60_000,
  nghiSauHongMs: 60_000,
  xacNhanMs: 5_000,
  choToiDaMs: 15 * 60_000,
  tuDoi: true,
};

export type MaLoiKheNang = "KHE_NANG_TAT" | "KHE_NANG_HONG" | "KHE_NANG_HET_GIO" | "KHE_NANG_HUY" | "KHE_NANG_SERVER" | "KHE_NANG_KHOA";

export class LoiKheNang extends Error {
  constructor(
    public readonly code: MaLoiKheNang,
    message: string,
  ) {
    super(message);
    this.name = code === "KHE_NANG_HUY" ? "AbortError" : "LoiKheNang";
  }
}

const HANG: Record<MucUuTien, number> = { "tuong-tac": 0, agent: 1, nen: 2 };

interface NguoiCho {
  model: string;
  muc: MucUuTien;
  tDen: number;
  thuTu: number;
  nhan: (nha: () => void) => void;
  tuChoi: (e: Error) => void;
  hetGio: NodeJS.Timeout | null;
  boNghe?: () => void;
}

export interface ThongKeKheNang {
  dangGiu: string | null;
  dangDoi: string | null;
  dangXa: boolean;
  soLanDoi: number;
  soLanHong: number;
  dangChay: Record<string, number>;
  dangCho: { model: string; muc: MucUuTien; choMs: number }[];
  nghi: Record<string, number>;
}

export class KheNang {
  private dangGiu: string | null = null;
  private xacNhanLuc = -Infinity;
  private xacNhanDangChay: Promise<void> | null = null;
  private dangDoiSang: string | null = null;
  private xa = false;
  private doiLuc = -Infinity;
  private ranhTu = -Infinity;
  private readonly dangChay = new Map<string, number>();
  private readonly hang: NguoiCho[] = [];
  private readonly hong = new Map<string, number>();
  private hen: NodeJS.Timeout | null = null;
  private soLanDoi = 0;
  private soLanHong = 0;
  private demThuTu = 0;

  constructor(
    private readonly bo: BoPhucVuKheNang,
    private readonly ch: CauHinhKheNang,
    private readonly modelNha: () => string,
  ) {}

  /**
   * Xin chạy một lượt cho `model`; trả hàm nhả (gọi nhiều lần vô hại).
   * ★ Đợt 9 — `khiDoiKhe`: gọi ĐÚNG một lần nếu lượt này được VÀO sau một lần đổi khe THỰC (soLanDoi tăng) xảy ra trong
   * lúc nó chờ, và khe đang giữ đúng model của nó (trần đổi khe theo token /v1, `tranDoiKheToken.ts`). Lượt khớp model
   * đang giữ ngay lúc đến ⇒ không gọi.
   */
  async cho(model: string, muc: MucUuTien, signal?: AbortSignal, khiDoiKhe?: () => void): Promise<() => void> {
    if (signal?.aborted) throw new LoiKheNang("KHE_NANG_HUY", "Đã huỷ khi đang chờ khe model.");
    const nghiToi = this.hong.get(model) ?? 0;
    if (nghiToi > Date.now()) {
      throw new LoiKheNang(
        "KHE_NANG_HONG",
        `Model ${model} vừa nạp hỏng — tạm nghỉ ${Math.ceil((nghiToi - Date.now()) / 1000)} s trước khi thử lại.`,
      );
    }
    await this.xacNhan();
    if (!this.dangDoiSang && this.dangGiu === null) {
      // Không đọc được /props: model nhà đi tiếp (engine tự fail-closed / chờ giám sát); model khác không có đường.
      if (model === this.modelNha()) return this.nhan(model);
      throw new LoiKheNang("KHE_NANG_SERVER", `llama-server không trả lời /props — không đổi được sang ${model}.`);
    }
    if (!this.ch.tuDoi && model !== this.dangGiu && !this.dangDoiSang) {
      throw new LoiKheNang(
        "KHE_NANG_TAT",
        `llama-server đang giữ ${this.dangGiu}; tiến trình này không được tự đổi khe sang ${model}.`,
      );
    }
    if (!this.dangDoiSang && !this.xa && model === this.dangGiu) return this.nhan(model);

    return new Promise<() => void>((resolve, reject) => {
      const doiLucDen = this.soLanDoi;
      const nhan = (nha: () => void) => {
        if (khiDoiKhe && this.soLanDoi > doiLucDen && this.dangGiu === model) {
          try {
            khiDoiKhe();
          } catch {
            /* bộ đếm không bao giờ được làm hỏng lượt sinh chữ */
          }
        }
        resolve(nha);
      };
      const n: NguoiCho = { model, muc, tDen: Date.now(), thuTu: this.demThuTu++, nhan, tuChoi: reject, hetGio: null };
      n.hetGio = setTimeout(() => {
        if (this.roiHang(n)) reject(new LoiKheNang("KHE_NANG_HET_GIO", `Chờ khe model ${model} quá ${Math.round(this.ch.choToiDaMs / 1000)} s.`));
      }, this.ch.choToiDaMs);
      n.hetGio.unref?.();
      if (signal) {
        const khiHuy = () => {
          if (this.roiHang(n)) reject(new LoiKheNang("KHE_NANG_HUY", "Đã huỷ khi đang chờ khe model."));
          this.danhGia();
        };
        signal.addEventListener("abort", khiHuy, { once: true });
        n.boNghe = () => signal.removeEventListener("abort", khiHuy);
      }
      this.hang.push(n);
      this.danhGia();
    });
  }

  thongKe(): ThongKeKheNang {
    const bayGio = Date.now();
    return {
      dangGiu: this.dangGiu,
      dangDoi: this.dangDoiSang,
      dangXa: this.xa,
      soLanDoi: this.soLanDoi,
      soLanHong: this.soLanHong,
      dangChay: Object.fromEntries(this.dangChay),
      dangCho: this.hang.map((n) => ({ model: n.model, muc: n.muc, choMs: bayGio - n.tDen })),
      nghi: Object.fromEntries([...this.hong].filter(([, t]) => t > bayGio).map(([m, t]) => [m, t - bayGio])),
    };
  }

  dung(): void {
    if (this.hen) clearTimeout(this.hen);
    this.hen = null;
  }

  // ── nội bộ ──

  private async xacNhan(): Promise<void> {
    if (this.dangDoiSang) return;
    if (Date.now() - this.xacNhanLuc < this.ch.xacNhanMs) return;
    if (!this.xacNhanDangChay) {
      this.xacNhanDangChay = (async () => {
        try {
          const m = await this.bo.modelDangGiu();
          if (!this.dangDoiSang) this.dangGiu = m;
        } catch {
          if (!this.dangDoiSang) this.dangGiu = null;
        } finally {
          this.xacNhanLuc = Date.now();
          this.xacNhanDangChay = null;
        }
      })();
    }
    await this.xacNhanDangChay;
  }

  private tongChay(): number {
    let t = 0;
    for (const v of this.dangChay.values()) t += v;
    return t;
  }

  private nhan(model: string): () => void {
    this.dangChay.set(model, (this.dangChay.get(model) ?? 0) + 1);
    let daNha = false;
    return () => {
      if (daNha) return;
      daNha = true;
      const con = (this.dangChay.get(model) ?? 1) - 1;
      if (con > 0) this.dangChay.set(model, con);
      else this.dangChay.delete(model);
      if (this.tongChay() === 0) this.ranhTu = Date.now();
      this.danhGia();
    };
  }

  private roiHang(n: NguoiCho): boolean {
    const i = this.hang.indexOf(n);
    if (i < 0) return false;
    this.hang.splice(i, 1);
    if (n.hetGio) clearTimeout(n.hetGio);
    n.boNghe?.();
    return true;
  }

  private henLuc(luc: number): void {
    if (this.hen) clearTimeout(this.hen);
    this.hen = setTimeout(() => {
      this.hen = null;
      this.danhGia();
    }, Math.max(0, luc - Date.now()));
    this.hen.unref?.();
  }

  private danhGia(): void {
    if (this.dangDoiSang) return;
    // Hết người chờ model khác (vd. đích vừa huỷ) ⇒ thôi xả, người chờ model đang giữ được nhận lại.
    if (!this.hang.some((n) => n.model !== this.dangGiu)) this.xa = false;
    if (!this.xa) {
      for (const n of [...this.hang]) {
        if (n.model === this.dangGiu && this.roiHang(n)) n.nhan(this.nhan(n.model));
      }
    }
    const bayGio = Date.now();
    const khac = this.hang.filter((n) => n.model !== this.dangGiu);
    const nha = this.modelNha();
    // ★ Đợt 9 — KHOÁ KHE còn hạn ⇒ không đổi, không về nhà; người chờ model khác bị từ chối NÓI THẬT; xét lại khi khoá hết.
    let khoa: { chu: string; lyDo: string; hetHan: number } | null = null;
    try {
      khoa = this.bo.khoaKhe?.() ?? null;
    } catch {
      khoa = null;
    }

    if (khac.length === 0) {
      if (this.ch.tuDoi && this.dangGiu && this.dangGiu !== nha && this.tongChay() === 0 && this.hang.length === 0) {
        const luc = Math.max(this.ranhTu + this.ch.veNhaSauMs, this.doiLuc + this.ch.luuTruToiThieuMs);
        if (khoa) this.henLuc(Math.max(luc, khoa.hetHan + 1));
        else if (bayGio >= luc) this.batDauDoi(nha);
        else this.henLuc(luc);
      }
      return;
    }
    if (khoa) {
      const den = new Date(khoa.hetHan).toISOString();
      for (const n of khac) {
        if (this.roiHang(n)) {
          n.tuChoi(new LoiKheNang("KHE_NANG_KHOA", `Khe llama-server đang bị khoá bởi ${khoa.chu} tới ${den}${khoa.lyDo ? ` (${khoa.lyDo})` : ""} — không đổi sang ${n.model}; khe giữ ${this.dangGiu ?? "?"}.`));
        }
      }
      return;
    }
    if (!this.ch.tuDoi) {
      for (const n of khac) {
        if (this.roiHang(n)) n.tuChoi(new LoiKheNang("KHE_NANG_TAT", `Tiến trình này không được tự đổi khe sang ${n.model}.`));
      }
      return;
    }

    const dich = [...khac].sort((a, b) => HANG[a.muc] - HANG[b.muc] || a.thuTu - b.thuTu)[0];
    if (!this.xa) {
      const luuTruXong = bayGio - this.doiLuc >= this.ch.luuTruToiThieuMs;
      const coNguoiChoCu = this.hang.some((n) => n.model === this.dangGiu);
      const ranh = this.tongChay() === 0 && !coNguoiChoCu && bayGio - this.ranhTu >= this.ch.ranhDeDoiMs;
      const duLauChoNen = bayGio - dich.tDen >= this.ch.choNenToiDaMs;
      const kichHoat = luuTruXong && (dich.muc === "tuong-tac" || duLauChoNen || ranh || this.dangGiu === null);
      if (!kichHoat) {
        const cacMoc = [dich.tDen + this.ch.choNenToiDaMs];
        if (this.tongChay() === 0 && !coNguoiChoCu) cacMoc.push(this.ranhTu + this.ch.ranhDeDoiMs);
        this.henLuc(Math.max(this.doiLuc + this.ch.luuTruToiThieuMs, Math.min(...cacMoc)));
        return;
      }
      this.xa = true;
    }
    if (this.tongChay() > 0) return; // chờ lượt đang chạy nhả
    this.batDauDoi(dich.model);
  }

  private batDauDoi(model: string): void {
    this.dangDoiSang = model;
    this.xa = false;
    if (this.hen) clearTimeout(this.hen);
    this.hen = null;
    let hong = false;
    void this.bo
      .doiSang(model)
      .then(
        () => {
          this.dangGiu = model;
          this.soLanDoi++;
          const bayGio = Date.now();
          this.xacNhanLuc = bayGio;
          this.doiLuc = bayGio;
          this.ranhTu = bayGio;
        },
        (e: unknown) => {
          hong = true;
          this.soLanHong++;
          this.hong.set(model, Date.now() + this.ch.nghiSauHongMs);
          const lyDo = String((e as Error)?.message ?? e).slice(0, 300);
          for (const n of [...this.hang]) {
            if (n.model === model && this.roiHang(n)) {
              n.tuChoi(new LoiKheNang("KHE_NANG_HONG", `Đổi khe sang ${model} hỏng: ${lyDo}`));
            }
          }
          this.xacNhanLuc = -Infinity;
        },
      )
      .finally(async () => {
        this.dangDoiSang = null;
        if (hong) await this.xacNhan();
        this.danhGia();
      });
  }
}
