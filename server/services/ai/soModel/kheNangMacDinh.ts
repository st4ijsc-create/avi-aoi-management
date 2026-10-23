/**
 * ★★ Đợt 7.1 — ĐƠN THỂ khe nặng của tiến trình + `BoPhucVu` thật (`/props` + `DieuPhoiDoiModel` chế độ TẠM).
 *
 * `quaKheNang` / `quaKheNangLuong` bọc lượt gửi tới llama-server (`aiLlamaServerClient`), đứng TRƯỚC cổng ưu tiên.
 * Tập phụ rỗng (không hồ sơ `nang` nào) hoặc cờ tắt ⇒ đi tắt: gọi thẳng — hành vi y như trước Đợt 7.1.
 * Chỉ tiến trình gọi `batTuDoiKheNang()` (API, ở `server/_core/index.ts`) được tự đổi khe.
 */
import { mucUuTienHienTai } from "../hangDoiUuTienLlm";
import { datNguonKheDangGiu, toBasename } from "../modelResolver";
import { layAnhSoModel } from "./anhSoModel";
import { CAU_HINH_MAC_DINH, KheNang, LoiKheNang, type BoPhucVuKheNang, type CauHinhKheNang, type ThongKeKheNang } from "./kheNang";
import { hoanDoiKheNangBat, modelKheNangPhu, modelNhaKheNang } from "./tapKheNang";
// ★ Đợt 9 — đếm đổi khe THỰC theo token /v1 (trần 3 / 10 phút trượt; ngoài /v1 ⇒ không đếm).
import { ghiDoiKheTheoNguCanh } from "./tranDoiKheToken";
import { docKhoaKhe } from "../khoaKhe";

function soEnv(ten: string, macDinh: number): number {
  const v = Number(process.env[ten]);
  return Number.isFinite(v) && v >= 0 ? v : macDinh;
}

const cauHinh: CauHinhKheNang = { ...CAU_HINH_MAC_DINH, tuDoi: false };
let kn: KheNang | null = null;
// ★ Đợt 9 (sửa 2026-10-22) — định tuyến vai trò so với model khe ĐANG GIỮ thật, không phải model NHÀ (xem `kheDangGiu`).
datNguonKheDangGiu(() => kn?.thongKe().dangGiu ?? null);

const boThat: BoPhucVuKheNang = {
  async modelDangGiu() {
    const { docProps } = await import("../doiModelLlamaServer");
    const url = (process.env.LLAMA_SERVER_URL || "").trim().replace(/\/+$/, "");
    if (!url) return null;
    try {
      return toBasename((await docProps(url, (...a) => fetch(...a), 3_000)).tenModel) || null;
    } catch {
      return null;
    }
  },
  khoaKhe() {
    return docKhoaKhe();
  },
  async doiSang(model) {
    const { layDieuPhoiDoiModel, LoiDoiModel } = await import("../doiModelLlamaServer");
    let xong;
    try {
      ({ xong } = await layDieuPhoiDoiModel().batDau(`${model}.gguf`, "khe-nang", { ben: false }));
    } catch (e) {
      if (e instanceof LoiDoiModel && e.code === "DA_DANG_CHAY") return;
      throw e;
    }
    const t0 = Date.now();
    const p = await xong;
    console.log(`[khe-nang] đổi khe → ${model}: ${p.ketQua}${p.loi ? ` (${p.loi})` : ""}`);
    // ★ Đợt 9 (2026-10-23, dieu-phoi) — GHI mỗi lần đổi khe vào `vram_events` (event `doi_khe`, có giờ) ⇒ đếm được "số lần đổi khe/giờ"
    //   sau khi bật trợ lý + tác nhân theo vai trò (ngưỡng báo > 6/giờ: đổi khe làm câu KB/vận hành xếp hàng sau). Log console không có giờ.
    try {
      const { logVramEvent } = await import("../../vram/vramEventLog");
      logVramEvent({
        event: "doi_khe",
        owner: "khe-nang",
        leaseKind: "external-process",
        priority: "interactive",
        detail: { den: model, ketQua: p.ketQua, ms: Date.now() - t0, ...(p.loi ? { loi: String(p.loi).slice(0, 200) } : {}) },
      });
    } catch {
      /* nhật ký là phần thêm — không bao giờ làm hỏng lượt đổi khe */
    }
    if (p.ketQua !== "thanh-cong") throw new LoiKheNang("KHE_NANG_HONG", p.loi ?? p.ketQua);
  },
};

function layKheNang(): KheNang {
  if (!kn) {
    Object.assign(cauHinh, {
      luuTruToiThieuMs: soEnv("AI_KHE_NANG_LUU_TRU_MS", CAU_HINH_MAC_DINH.luuTruToiThieuMs),
      choNenToiDaMs: soEnv("AI_KHE_NANG_CHO_NEN_MS", CAU_HINH_MAC_DINH.choNenToiDaMs),
      ranhDeDoiMs: soEnv("AI_KHE_NANG_RANH_MS", CAU_HINH_MAC_DINH.ranhDeDoiMs),
      veNhaSauMs: soEnv("AI_KHE_NANG_VE_NHA_MS", CAU_HINH_MAC_DINH.veNhaSauMs),
    });
    kn = new KheNang(boThat, cauHinh, () => modelNhaKheNang(process.env));
  }
  return kn;
}

/** Tiến trình API gọi một lần lúc khởi động. Worker KHÔNG gọi (đổi chéo tiến trình giết lượt của tiến trình kia). */
export function batTuDoiKheNang(): void {
  cauHinh.tuDoi = true;
}

function diTat(): boolean {
  return !hoanDoiKheNangBat(process.env) || modelKheNangPhu(layAnhSoModel(), modelNhaKheNang(process.env)).length === 0;
}

export async function quaKheNang<T>(model: string, fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (diTat()) return fn();
  const nha = await layKheNang().cho(toBasename(model) || modelNhaKheNang(process.env), mucUuTienHienTai(), signal, ghiDoiKheTheoNguCanh);
  try {
    return await fn();
  } finally {
    nha();
  }
}

export async function* quaKheNangLuong<T>(model: string, moLuong: () => AsyncGenerator<T>, signal?: AbortSignal): AsyncGenerator<T> {
  if (diTat()) {
    yield* moLuong();
    return;
  }
  const nha = await layKheNang().cho(toBasename(model) || modelNhaKheNang(process.env), mucUuTienHienTai(), signal, ghiDoiKheTheoNguCanh);
  try {
    yield* moLuong();
  } finally {
    nha();
  }
}

/**
 * ★ Đợt 9 (2026-10-23) — làm mới "khe đang giữ" (nguồn của `kheDangGiu` trong định tuyến vai trò) TRƯỚC khi định tuyến. Đi tắt
 * (hoán đổi tắt / không hồ sơ nặng) ⇒ không làm gì. Không ném (định tuyến vẫn chạy với giá trị đã có).
 */
export async function lamMoiKheDangGiu(): Promise<void> {
  if (diTat()) return;
  try {
    await layKheNang().xacNhanDangGiu();
  } catch {
    /* thăm dò hỏng: bộ lập lịch tự xử ở lượt xin khe */
  }
}

/** Cho tRPC tổng quan; `null` = khe nặng chưa từng được dùng trong tiến trình này. */
export function thongKeKheNang(): (ThongKeKheNang & { tuDoi: boolean }) | null {
  return kn ? { ...kn.thongKe(), tuDoi: cauHinh.tuDoi } : null;
}

/** ★ Đợt 9 — khoá khe đang hiệu lực (cho Trung tâm Model; null = không khoá). */
export function khoaKheHienTai() {
  return docKhoaKhe();
}

/** Chỉ lưới: thay đơn thể bằng một `KheNang` dựng với `BoPhucVu` giả (`null` = về mặc định). */
export function __datKheNangChoTest(k: KheNang | null, tuDoi = true): void {
  kn = k;
  cauHinh.tuDoi = tuDoi;
}

/** Chỉ lưới: `BoPhucVu` THẬT (đổi khe qua `DieuPhoiDoiModel` + ghi `vram_events` `doi_khe`). */
export const __boPhucVuThatChoTest: BoPhucVuKheNang = boThat;
