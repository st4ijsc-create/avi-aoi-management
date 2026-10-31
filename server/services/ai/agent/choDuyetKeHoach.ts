/**
 * ★★★ Đợt 11.3-C (2026-10-31) — MÓC HOST của cổng duyệt kế hoạch: nộp kế hoạch vào sổ rồi CHỜ NGƯỜI quyết (qua tRPC `aiAgent.duyetKeHoach`).
 *
 * Sự thật nằm ở SỔ (`ai_agent_runs.keHoach*`), không ở bộ nhớ: chờ = hỏi lại sổ mỗi nhịp; bus trong bộ nhớ chỉ ĐÁNH THỨC nhanh
 * (khuôn `busDuyetAgent`). Hệ quả an toàn:
 *   • FAIL-CLOSED: không nộp được ⇒ BÁC; đọc sổ lỗi ⇒ tiếp tục chờ (không bao giờ tự duyệt); hàng biến mất / băm đổi ⇒ BÁC;
 *   • chỉ nhận "duyệt" khi sổ nói ĐÚNG: trạng thái `duyet`, băm KHỚP băm đã nộp, giờ duyệt có, và người duyệt LÀ chủ lượt;
 *   • huỷ lượt (signal) ⇒ chốt `bac` có điều kiện (không đè quyết định đã có của người); quá trần chờ ⇒ chốt `het-gio`;
 *   • trong lúc chờ KHÔNG giữ khe model / cổng ưu tiên (cổng giữ theo từng lượt gọi model; chờ nằm GIỮA hai lượt model).
 */
import type { CongKeHoach, KetQuaChoDuyetKeHoach } from "@shared/agentCore";
import { chotKeHoachDangCho, docKeHoach, nopKeHoach } from "../../../db/aiAgentKeHoach";

/** Trần chờ NGƯỜI duyệt kế hoạch (dieu-phoi duyệt 15 phút). */
export const TRAN_CHO_DUYET_KE_HOACH_MS = 15 * 60_000;
export const NHIP_HOI_SO_MS = 1_000;

const danhThuc = new Map<string, Set<() => void>>();

/** `aiAgent.duyetKeHoach` gọi sau khi GHI SỔ xong để lượt đang chờ thấy ngay (không phải đợi nhịp hỏi sổ). */
export function baoKeHoachDaQuyet(runId: string): void {
  for (const f of [...(danhThuc.get(runId) ?? [])]) {
    try {
      f();
    } catch {
      /* một người nghe hỏng không chặn người khác */
    }
  }
}

export interface PhuThuocChoDuyet {
  nop: typeof nopKeHoach;
  doc: typeof docKeHoach;
  chot: typeof chotKeHoachDangCho;
  now: () => number;
  /** Ngủ tối đa `ms` hoặc tới khi `thucDay()` được gọi / `signal` abort. */
  ngu: (ms: number, signal: AbortSignal, dangKyThucDay: (f: () => void) => () => void) => Promise<void>;
  tranMs: number;
  nhipMs: number;
}

const nguThat: PhuThuocChoDuyet["ngu"] = (ms, signal, dangKy) =>
  new Promise<void>((xong) => {
    let h: ReturnType<typeof setTimeout> | null = null;
    let huyDangKy = () => undefined as void;
    const ket = () => {
      if (h) clearTimeout(h);
      huyDangKy();
      signal.removeEventListener("abort", ket);
      xong();
    };
    h = setTimeout(ket, ms);
    h.unref?.();
    huyDangKy = dangKy(ket);
    signal.addEventListener("abort", ket, { once: true });
  });

export const PHU_THUOC_MAC_DINH: PhuThuocChoDuyet = {
  nop: nopKeHoach,
  doc: docKeHoach,
  chot: chotKeHoachDangCho,
  now: Date.now,
  ngu: nguThat,
  tranMs: TRAN_CHO_DUYET_KE_HOACH_MS,
  nhipMs: NHIP_HOI_SO_MS,
};

/** Móc cho MỘT lượt gốc (userId = chủ lượt). */
export function taoChoDuyetKeHoach(y: { userId: number; runId: string }, dep: Partial<PhuThuocChoDuyet> = {}): CongKeHoach["choDuyet"] {
  const d: PhuThuocChoDuyet = { ...PHU_THUOC_MAC_DINH, ...dep };
  return async ({ bam, viec, signal, daSanSang }): Promise<KetQuaChoDuyetKeHoach> => {
    // 1) nộp vào sổ — máy chủ tự làm sạch + tính băm LẠI; lệch băm với lõi (hai bên không cùng hàm/cùng đầu vào) ⇒ BÁC
    const nop = await d.nop(y.userId, y.runId, viec);
    if (!nop || nop.bam !== bam) return { ketQua: "bac" };
    const han = d.now() + d.tranMs;
    daSanSang(); // sổ ĐÃ có kế hoạch chờ ⇒ lõi mới phát `ke-hoach-cho-duyet` (UI bấm duyệt là thủ tục tìm thấy ngay)

    // 2) chờ
    for (;;) {
      if (signal.aborted) {
        await d.chot(y.userId, y.runId, bam, "bac");
        return { ketQua: "bac" };
      }
      const h = await d.doc(y.userId, y.runId);
      if (h === null) {
        // `doc` trả null cả khi lỗi sổ thoáng qua lẫn khi hàng biến mất; hàng biến mất ⇒ còn null mãi tới hết giờ ⇒ het-gio (không bao giờ duyệt)
      } else if (h.bam !== bam) {
        return { ketQua: "bac" }; // kế hoạch bị thay sau lưng ta
      } else if (h.trangThai === "duyet") {
        if (h.duyetLuc && h.duyetBoi === y.userId) return { ketQua: "duyet", luc: h.duyetLuc.toISOString() };
        return { ketQua: "bac" }; // 'duyet' mà thiếu giờ/người duyệt, hoặc không phải chủ lượt ⇒ không tin
      } else if (h.trangThai === "bac") {
        return { ketQua: "bac" };
      } else if (h.trangThai === "het-gio") {
        return { ketQua: "het-gio" };
      }
      if (d.now() >= han) {
        await d.chot(y.userId, y.runId, bam, "het-gio");
        // người có thể vừa quyết ngay sát hạn: chốt có điều kiện nên không đè; đọc lại để trả đúng sự thật
        const cuoi = await d.doc(y.userId, y.runId);
        if (cuoi && cuoi.bam === bam && cuoi.trangThai === "duyet" && cuoi.duyetLuc && cuoi.duyetBoi === y.userId) {
          return { ketQua: "duyet", luc: cuoi.duyetLuc.toISOString() };
        }
        return { ketQua: cuoi?.trangThai === "bac" ? "bac" : "het-gio" };
      }
      await d.ngu(Math.min(d.nhipMs, Math.max(1, han - d.now())), signal, (f) => {
        const tap = danhThuc.get(y.runId) ?? new Set<() => void>();
        tap.add(f);
        danhThuc.set(y.runId, tap);
        return () => {
          tap.delete(f);
          if (tap.size === 0) danhThuc.delete(y.runId);
        };
      });
    }
  };
}
