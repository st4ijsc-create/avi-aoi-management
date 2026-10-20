/**
 * ★★ Đợt 8.1 — NODE CON NGƯỜI: `nguoi.duyet` — dừng lượt chờ một người duyệt/bác (web/app), có hạn.
 * Không giữ tiến trình: động cơ ghi `ai_flow_waits`, giải phóng worker; `traLoiCho` (API `flow.duyet`) đi tiếp ở cổng
 * `dong-y` / `tu-choi`; quá hạn ⇒ cổng `het-han`. Item ra mang `duyet: { dongY, nguoi, lyDo }`.
 */
import { danhGiaThamSo } from "../../../../shared/flow/bieuThuc";
import { dangKyNut, nguCanhItem } from "../dangKyNut";

dangKyNut({
  type: "nguoi.duyet",
  typeVersion: 1,
  laKichHoat: false,
  congVao: ["main"],
  congRa: ["dong-y", "tu-choi", "het-han"],
  tacDungPhu: "thuan",
  // Tạo hàng chờ là ghi NỘI BỘ có khoá (runId,nodeId) — chạy lại không tạo hàng thứ hai (ON CONFLICT DO NOTHING).
  lapLai: "idempotent",
  async chay(thamSo, ngu) {
    const vao = ngu.inputs.main ?? [];
    const t = danhGiaThamSo(thamSo, nguCanhItem(ngu, vao[0] ?? { json: {} }, vao)) as Record<string, unknown>;
    const gio = Number(t.hetHanGio ?? 24);
    return {
      __cho: {
        kind: "duyet",
        items: vao,
        hetHanMs: Number.isFinite(gio) && gio > 0 ? Math.min(gio, 24 * 30) * 3600_000 : undefined,
        payload: {
          tieuDe: String(t.tieuDe ?? "Cần duyệt").slice(0, 200),
          noiDung: String(t.noiDung ?? "").slice(0, 4000),
          vaiTroDuyet: String(t.vaiTroDuyet ?? "supervisor").slice(0, 32),
        },
      },
    };
  },
});
