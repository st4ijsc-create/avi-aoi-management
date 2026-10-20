/**
 * ★★ Đợt 8.0 — SỔ ĐĂNG KÝ NODE của Luồng AI. Mỗi loại node = khai báo (`KhaiBaoNut`, `shared/flow/model.ts`) + hàm chạy.
 * Thêm node mới KHÔNG sửa động cơ. 8.0 chỉ có node lõi thuần; node AI / tích hợp / người / OT là pha 8.1–8.5.
 */
import { danhGiaThamSo, type ItemLuong, type NguCanhBieuThuc } from "../../../shared/flow/bieuThuc";
import type { KhaiBaoNut } from "../../../shared/flow/model";

export interface NguCanhChay {
  runId: string;
  flowId: string;
  nodeId: string;
  lan: number;
  /** `runId:nodeId:lan` — GIỐNG NHAU giữa các lần thử ⇒ đích ngoài khử trùng được (node idempotent). */
  idempotencyKey: string;
  inputs: Record<string, ItemLuong[]>;
  /** Đầu ra `main` của các node đã chạy xong trong lượt (cho `$node("id")`). */
  nodes: Record<string, ItemLuong[]>;
  env: Record<string, string>;
  run: { id: string; flowId: string; batDau: string };
  /**
   * Đợt 8.2 — bí mật đã giải mã của node (chỉ khi node có `credentialRef` và loại khai `nhanBiMat`). Động cơ gắn ô này
   * KHÔNG LIỆT KÊ ĐƯỢC (`JSON.stringify`/spread không mang theo); KHÔNG nằm trong `inputs`/`nodes`/biểu thức/bước/sự kiện.
   */
  biMat?: { giaTri: string; loai: string };
}

export type KetQuaChay = Record<string, ItemLuong[]>;

/**
 * Node xin CHỜ thay vì trả kết quả ngay (duyệt người, webhook, hẹn giờ): động cơ ghi `ai_flow_waits`, lượt ⇒ `cho-duyet`,
 * bước giữ `dang-chay`; `traLoiCho` (dongCo) đi tiếp với `items` ở cổng được chọn.
 */
export interface YeuCauCho {
  __cho: { kind: "duyet" | "webhook" | "thoi-gian"; items: ItemLuong[]; hetHanMs?: number; tokenHash?: string; payload?: Record<string, unknown> };
}

export interface DinhNghiaNut extends KhaiBaoNut {
  chay(thamSo: Record<string, unknown>, ngu: NguCanhChay): Promise<KetQuaChay | YeuCauCho>;
}

/** Ngữ cảnh biểu thức cho MỘT item. */
export function nguCanhItem(ngu: NguCanhChay, item: ItemLuong, input: ItemLuong[]): NguCanhBieuThuc {
  return { json: item.json, input, nodes: ngu.nodes, env: ngu.env, run: ngu.run };
}

const dangKy = new Map<string, DinhNghiaNut>();

export function dangKyNut(d: DinhNghiaNut): void {
  dangKy.set(d.type, d);
}

export function layNut(type: string): DinhNghiaNut | undefined {
  return dangKy.get(type);
}

/** Mọi loại node đã đăng ký (danh mục cho Flow Studio — `flow.danhMucNode`). */
export function danhSachNut(): DinhNghiaNut[] {
  return [...dangKy.values()];
}

/** Chỉ lưới: gỡ một loại node thử nghiệm. */
export function __goNutChoTest(type: string): void {
  dangKy.delete(type);
}

// ── node lõi ─────────────────────────────────────────────────────────────────────────────────────

dangKyNut({
  type: "kich-hoat.thu-cong",
  typeVersion: 1,
  laKichHoat: true,
  congVao: [],
  congRa: ["main"],
  tacDungPhu: "thuan",
  lapLai: "idempotent",
  async chay(_t, ngu) {
    return { main: ngu.inputs.main ?? [{ json: {} }] };
  },
});

/** Đặt trường cho từng item. `truong`: { tên: giá trị | "{{ biểu thức }}" } · `giuCu` (mặc định true). */
dangKyNut({
  type: "du-lieu.dat",
  typeVersion: 1,
  laKichHoat: false,
  congVao: ["main"],
  congRa: ["main"],
  tacDungPhu: "thuan",
  lapLai: "idempotent",
  async chay(thamSo, ngu) {
    const vao = ngu.inputs.main ?? [];
    const giuCu = thamSo.giuCu !== false;
    return {
      main: vao.map((item) => {
        const truong = danhGiaThamSo(thamSo.truong ?? {}, nguCanhItem(ngu, item, vao)) as Record<string, unknown>;
        return { json: giuCu ? { ...item.json, ...truong } : truong };
      }),
    };
  },
});

/** Rẽ nhánh từng item theo `dieuKien` (biểu thức) ⇒ cổng `dung` / `sai`. */
dangKyNut({
  type: "logic.neu",
  typeVersion: 1,
  laKichHoat: false,
  congVao: ["main"],
  congRa: ["dung", "sai"],
  tacDungPhu: "thuan",
  lapLai: "idempotent",
  async chay(thamSo, ngu) {
    const vao = ngu.inputs.main ?? [];
    const ra: KetQuaChay = { dung: [], sai: [] };
    for (const item of vao) {
      const v = danhGiaThamSo(thamSo.dieuKien ?? false, nguCanhItem(ngu, item, vao));
      (v ? ra.dung : ra.sai).push(item);
    }
    return ra;
  },
});

/** Gộp: CHỜ ĐỦ hai cổng `a`, `b` (cổng có nối) rồi nối item a trước b. */
dangKyNut({
  type: "logic.gop",
  typeVersion: 1,
  laKichHoat: false,
  congVao: ["a", "b"],
  congRa: ["main"],
  tacDungPhu: "thuan",
  lapLai: "idempotent",
  choDuCong: true,
  async chay(_t, ngu) {
    return { main: [...(ngu.inputs.a ?? []), ...(ngu.inputs.b ?? [])] };
  },
});
