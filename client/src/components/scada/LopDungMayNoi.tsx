/**
 * PHA 0 · C0-3 — LỚP NỔI "DỪNG MÁY" (một lần ở gốc App). Xem `dungMayNoi.ts`. Khi một `NutDungMay` nằm trong hộp thoại (faceplate) mà hộp
 * lồng khác phủ lên, lớp này dựng một nút DỪNG MÁY ở tầng trên cùng (portal vào `document.body`, z-index lớn hơn mọi Dialog / Sheet / Sonner,
 * `pointer-events:auto` để vẫn bấm được khi Radix đặt `pointer-events:none` lên `body`). Bấm ⇒ mở HỘP XÁC NHẬN CỦA ĐÚNG instance đó
 * (`HopDungMay`, cùng luồng một bước + băng E-STOP cứng) — KHÔNG có đường gửi lệnh thứ hai.
 *
 * Lớp tự gỡ `aria-hidden` mà Radix đặt lên anh em của hộp thoại: nút DỪNG phải còn trong cây truy cập (đọc màn hình) ngay khi hộp lồng mở.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { BIEN_MAU_DUNG } from "./DungMay";
import { layNutDungMay, ngheNutDungMay, nutBiChe, nutTrongHopThoai, type NutDungMayDangKy } from "./dungMayNoi";

/** z-index trên mọi lớp của ứng dụng (Sonner mặc định 999999999). */
export const Z_LOP_DUNG_MAY = 2_147_483_000;
/** Số máy tối đa hiện nổi cùng lúc (tránh tràn màn khi nhiều faceplate lồng nhau — bất thường). */
export const TOI_DA_NUT_NOI = 3;
const CHU_KY_KIEM_MS = 250;

export function LopDungMayNoi() {
  const { t } = useTranslation();
  const dangKy = useSyncExternalStore(ngheNutDungMay, layNutDungMay, layNutDungMay);
  const [bi, setBi] = useState<readonly NutDungMayDangKy[]>([]);

  // kiểm "bị che" 4 Hz + khi DOM đổi (Radix mở/đóng hộp lồng đổi `aria-hidden`) — chỉ chạy khi CÓ nút đăng ký
  useEffect(() => {
    if (dangKy.length === 0) {
      setBi((cu) => (cu.length === 0 ? cu : []));
      return;
    }
    const kiem = () => {
      const moi = dangKy.filter((d) => {
        const n = d.nut();
        return n !== null && nutTrongHopThoai(n) && nutBiChe(n);
      });
      setBi((cu) => (cu.length === moi.length && cu.every((x, i) => x.id === moi[i].id) ? cu : moi));
    };
    kiem();
    const h = setInterval(kiem, CHU_KY_KIEM_MS);
    const mo = new MutationObserver(kiem);
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-hidden", "data-aria-hidden", "inert", "data-state"] });
    return () => {
      clearInterval(h);
      mo.disconnect();
    };
  }, [dangKy]);

  // gỡ aria-hidden Radix đặt lên CHÍNH lớp này
  useEffect(() => {
    if (bi.length === 0) return;
    const go = () => document.querySelectorAll<HTMLElement>("[data-lop-dung-may-noi]").forEach((e) => e.removeAttribute("aria-hidden"));
    go();
    const mo = new MutationObserver(go);
    mo.observe(document.body, { attributes: true, subtree: false, attributeFilter: ["aria-hidden"], childList: true });
    return () => mo.disconnect();
  }, [bi.length]);

  if (bi.length === 0 || typeof document === "undefined") return null;
  const hien = bi.slice(-TOI_DA_NUT_NOI);
  return createPortal(
    <div
      data-lop-dung-may-noi=""
      data-testid="lop-dung-may-noi"
      role="region"
      aria-label={t("scada.dungMay.lopNoi.nhan", "Dừng máy khẩn cấp")}
      style={{ position: "fixed", top: 64, right: 16, zIndex: Z_LOP_DUNG_MAY, display: "flex", flexDirection: "column", gap: 8, pointerEvents: "auto" }}
    >
      {hien.map((d) => (
        <button
          key={d.id}
          type="button"
          data-testid="nut-dung-may-noi"
          data-machine-id={d.machineId}
          onClick={() => d.mo()}
          className="min-h-12 rounded-md px-5 text-sm font-bold tracking-wide shadow-lg focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2"
          style={{ backgroundColor: `var(${BIEN_MAU_DUNG})`, color: "var(--isa-field)", border: "3px solid var(--isa-field)", pointerEvents: "auto" }}
        >
          {t("scada.dungMay.lopNoi.nut", { may: d.tenMay, defaultValue: "DỪNG MÁY — {{may}}" })}
        </button>
      ))}
    </div>,
    document.body,
  );
}
