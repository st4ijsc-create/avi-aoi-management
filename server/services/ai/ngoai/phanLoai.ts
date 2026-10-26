/**
 * ★ Đợt 10.3 B2 — MỨC DỮ LIỆU của nội dung gửi AI NGOÀI: `ky-thuat` (mã, câu hỏi kỹ thuật) | `van-hanh` (dữ liệu đo / sản xuất /
 * thiết bị / khách hàng — chỉ ra ngoài khi nhà máy bật "dữ liệu vận hành"). CỔNG tự suy mức (rà kiem-dinh mục 4) — người gọi không khai.
 *
 * Luồng — taint theo LƯỢT, ĐƠN ĐIỆU (quyết định kiem-dinh B, dieu-phoi duyệt): mọi node ĐÃ CHẠY trong lượt góp mức nguồn của nó;
 * `van-hanh` thắng; node không có trong bảng ⇒ `van-hanh`. Chặt hơn "theo item" (một nhánh đọc dữ liệu vận hành làm CẢ lượt thành
 * vận hành, kể cả nhánh không dùng nó) — cái giá của việc biểu thức `{{ }}` tham chiếu được mọi bước trước. Luồng con (`luong.goi-con`,
 * công cụ của `ai.agent`) ⇒ phân loại TĨNH toàn bộ định nghĩa con (đệ quy, ghim phiên bản) — lỗi đọc / vòng / quá sâu ⇒ `van-hanh`.
 * Mức do ĐỘNG CƠ tính (`taoMucDuLieuLuot`, gắn vào `NguCanhChay.mucDuLieu` không liệt kê / không ghi được) — node không hạ được.
 *
 * Chat / lập trình / KB: nội dung do MÁY CHỦ ghép (ngữ cảnh KB, kết quả tool, số liệu) phân loại tại điểm ghép (`mucChoBeMat`); văn bản
 * NGƯỜI DÙNG TỰ DÁN và payload `kich-hoat.thu-cong` coi là `ky-thuat` — trách nhiệm người dán / nhập (spec §9).
 */
import type { FlowDefinition } from "../../../../shared/flow/model";

export type MucDuLieu = "ky-thuat" | "van-hanh";
export type MucNguonNut = MucDuLieu | "ke-thua";

/**
 * Mức NGUỒN của từng loại node đã đăng ký — census `phanLoaiNut.census.test.ts` đỏ khi registry có loại chưa có ở đây.
 * `ke-thua` = node chỉ biến đổi dữ liệu đã có (không mang dữ liệu mới vào lượt).
 */
export const PHAN_LOAI_NGUON_NUT: Readonly<Record<string, MucNguonNut>> = Object.freeze({
  // kích hoạt
  "kich-hoat.thu-cong": "ky-thuat", // payload người chạy tự nhập — trách nhiệm người nhập (spec §9)
  "kich-hoat.lich": "ky-thuat",
  "kich-hoat.su-kien": "van-hanh", // sự kiện nhà máy (cảnh báo, máy, lô)
  "kich-hoat.webhook": "van-hanh", // dữ liệu hệ thống ngoài đẩy vào
  "kich-hoat.mcp": "van-hanh", // bên gọi MCP cấp dữ liệu
  // biến đổi / điều khiển luồng
  "du-lieu.dat": "ke-thua",
  "du-lieu.ma": "ke-thua",
  "logic.neu": "ke-thua",
  "logic.gop": "ke-thua",
  "logic.chon": "ke-thua",
  "logic.gom": "ke-thua",
  "logic.cho": "ke-thua",
  "logic.dung-loi": "ke-thua",
  "logic.loc": "ke-thua",
  "logic.sap-xep": "ke-thua",
  "luong.goi-con": "ke-thua", // + phân loại TĨNH định nghĩa con (xem `taoMucDuLieuLuot`)
  // AI (đầu ra suy từ đầu vào)
  "ai.llm": "ke-thua",
  "ai.trich-xuat": "ke-thua",
  "ai.phan-loai": "ke-thua",
  "ai.tom-tat": "ke-thua",
  "ai.sinh-ma": "ke-thua",
  "ai.agent": "ke-thua", // + phân loại TĨNH các luồng con khai làm công cụ
  "ai.tra-tri-thuc": "van-hanh", // kho tri thức gồm tài liệu vận hành
  // người
  "nguoi.duyet": "ke-thua",
  "nguoi.bieu-mau": "van-hanh", // người vận hành điền số liệu
  // đọc / ghi ra ngoài
  "du-lieu.so-lieu": "van-hanh",
  "ot.doc-tag": "van-hanh",
  "ot.de-xuat-lenh": "van-hanh",
  "ot.de-xuat-luong": "van-hanh",
  "bao-tri.tao-phieu": "van-hanh",
  "tich-hop.http-doc": "van-hanh",
  "tich-hop.http-gui": "van-hanh", // phản hồi của hệ thống ngoài
  "tich-hop.mcp-goi": "van-hanh",
  "tich-hop.thong-bao": "ke-thua",
});

/** Mức nguồn của MỘT loại node; loại lạ ⇒ `van-hanh` (fail-closed). */
export function mucNguonNut(loaiNut: string): MucNguonNut {
  return Object.prototype.hasOwnProperty.call(PHAN_LOAI_NGUON_NUT, loaiNut) ? PHAN_LOAI_NGUON_NUT[loaiNut]! : "van-hanh";
}

/** Gộp đơn điệu: `van-hanh` thắng; `ke-thua` không hạ. */
export function capNhatMucLuot(hienTai: MucDuLieu, loaiNut: string): MucDuLieu {
  return hienTai === "van-hanh" || mucNguonNut(loaiNut) === "van-hanh" ? "van-hanh" : "ky-thuat";
}

export function gopMuc(...ds: readonly MucDuLieu[]): MucDuLieu {
  return ds.includes("van-hanh") ? "van-hanh" : "ky-thuat";
}

/** Chat / lập trình / lượt agent: kỹ thuật trừ khi một phần máy chủ ghép vào (KB, kết quả tool) là vận hành. */
export function mucChoBeMat(_beMat: "chat" | "coding" | "agent-turn", phanDaGhep: readonly MucDuLieu[]): MucDuLieu {
  return gopMuc(...phanDaGhep);
}

export type DocDinhNghiaCon = (flowId: string, version: number) => Promise<FlowDefinition | null>;

const SAU_TOI_DA = 8;

/** Các luồng con mà MỘT node trỏ tới (`luong.goi-con` / công cụ của `ai.agent`). */
function conCuaNut(nut: { type: string; parameters?: Record<string, unknown> }): Array<{ flowId: unknown; version: unknown }> {
  const t = nut.parameters ?? {};
  if (nut.type === "luong.goi-con") return [{ flowId: t.flowId, version: t.version }];
  if (nut.type === "ai.agent") return (Array.isArray(t.luongCon) ? t.luongCon : []) as Array<{ flowId: unknown; version: unknown }>;
  return [];
}

/**
 * Mức TĨNH của cả định nghĩa (mọi node, đệ quy vào luồng con ghim phiên bản). Dùng cho: luồng con của một lượt; cấm admin TỰ duyệt
 * luồng có node `van-hanh` (Task 8). Đọc con lỗi / không ghim phiên bản / vòng / quá sâu ⇒ `van-hanh`.
 */
export async function mucTinhCuaDinhNghia(def: FlowDefinition, docCon: DocDinhNghiaCon, sau = 0, dangXet = new Set<string>()): Promise<MucDuLieu> {
  if (sau > SAU_TOI_DA) return "van-hanh";
  let muc: MucDuLieu = "ky-thuat";
  for (const nut of def.nodes ?? []) {
    muc = capNhatMucLuot(muc, nut.type);
    if (muc === "van-hanh") return muc;
    for (const c of conCuaNut(nut)) {
      if (typeof c.flowId !== "string" || typeof c.version !== "number") return "van-hanh";
      const khoa = `${c.flowId}@${c.version}`;
      if (dangXet.has(khoa)) return "van-hanh";
      let con: FlowDefinition | null;
      try {
        con = await docCon(c.flowId, c.version);
      } catch {
        return "van-hanh";
      }
      if (!con) return "van-hanh";
      dangXet.add(khoa);
      const m = await mucTinhCuaDinhNghia(con, docCon, sau + 1, dangXet);
      dangXet.delete(khoa);
      if (m === "van-hanh") return m;
    }
  }
  return muc;
}

/**
 * Hàm `mucDuLieu()` của MỘT bước trong lượt: các node ĐÃ CHẠY XONG (ảnh chụp tại lúc dựng ngữ cảnh) + phân loại tĩnh luồng con của
 * chúng. Kết quả đệm theo lần gọi đầu.
 */
export function taoMucDuLieuLuot(def: FlowDefinition, daChayIds: readonly string[], docCon: DocDinhNghiaCon): () => Promise<MucDuLieu> {
  const ids = Object.freeze([...daChayIds]);
  let dem: Promise<MucDuLieu> | null = null;
  return () =>
    (dem ??= (async () => {
      const theoId = new Map((def.nodes ?? []).map((n) => [n.id, n]));
      for (const id of ids) {
        const nut = theoId.get(id);
        if (!nut) return "van-hanh";
        if (capNhatMucLuot("ky-thuat", nut.type) === "van-hanh") return "van-hanh";
        if (conCuaNut(nut).length && (await mucTinhCuaDinhNghia({ ...def, nodes: [nut] } as FlowDefinition, docCon)) === "van-hanh") return "van-hanh";
      }
      return "ky-thuat";
    })());
}

/** Gắn `mucDuLieu` vào ngữ cảnh: KHÔNG liệt kê, KHÔNG ghi đè được (node không hạ mức). */
export function ganMucDuLieu<T extends object>(ngu: T, f: () => Promise<MucDuLieu>): T {
  Object.defineProperty(ngu, "mucDuLieu", { value: f, enumerable: false, writable: false, configurable: false });
  return ngu;
}
