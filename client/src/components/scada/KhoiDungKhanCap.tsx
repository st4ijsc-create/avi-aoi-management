/**
 * SCADA R1b-2b-1 Task 1 (mục 59; điều phối 2026-10-26 Q1 + điều kiện 6; ruling C6 / C16) — khối "DỪNG MÁY khẩn cấp" trên trang BUỘC ĐỔI MẬT
 * KHẨU (nhánh khoá của `CongDoiMatKhau`). Người vận hành bị buộc đổi mật khẩu không tới được HMI (cổng client không render bảng route) —
 * khối này cho họ dừng máy trong khi chưa đổi.
 *
 *   • MỘT thủ tục đọc tối thiểu `scadaCommands.mayDungKhanCap` (máy trong phạm vi mà người gọi được dừng; máy chủ trả rỗng cho người không có
 *     quyền dừng ⇒ viewer không thấy khối). Dữ liệu chỉ có id / nhãn máy / nhãn chuyền / coDung / số adapter — không chi tiết adapter (C16).
 *   • Mỗi máy MỘT `NutDungMay` có sẵn (cùng hộp xác nhận một bước, cùng băng đỏ "DÙNG E-STOP CỨNG"); không nút / đường điều hướng nào khác.
 *   • Đang tải ⇒ không hiện gì; lỗi (kể cả quá hạn 3 s của máy chủ) ⇒ MỘT dòng đỏ "Không tải được danh sách máy — dùng E-STOP cứng tại máy";
 *     rỗng ⇒ không hiện.
 *   • Bị cắt (máy chủ đọc TRẦN + 1 hàng ⇒ `biCat`) ⇒ hiện TRẦN máy + dòng "danh sách có thể chưa đủ — dùng E-STOP cứng".
 *   • Màu: token DỪNG `--packml-abort` (không phải màu cảnh báo).
 */
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { BIEN_MAU_DUNG, NutDungMay } from "./DungMay";

/** = `TRAN_MAY_DUNG_KHAN_CAP` của máy chủ (`server/services/scada/mayDungKhanCap.ts`): số máy tối đa hiện trong khối. */
export const TRAN_HIEN_MAY_DUNG_KHAN_CAP = 200;

export function KhoiDungKhanCap(): JSX.Element | null {
  const { t } = useTranslation();
  const q = trpc.scadaCommands.mayDungKhanCap.useQuery(undefined, { retry: false });
  if (q.isLoading) return null;
  if (q.isError) {
    return (
      <p
        data-testid="khoi-dung-khan-cap-loi"
        role="alert"
        className="mx-auto w-full max-w-md px-4 pt-4 text-sm font-semibold"
        style={{ color: `var(${BIEN_MAU_DUNG})` }}
      >
        {t("scada.dungMay.khanCap.loiTai")}
      </p>
    );
  }
  const may = q.data?.may ?? [];
  if (may.length === 0) return null;
  // máy chủ báo cắt; phòng máy chủ cũ / mới hơn: nhiều hơn trần cũng là bị cắt
  const biCat = q.data?.biCat === true || may.length > TRAN_HIEN_MAY_DUNG_KHAN_CAP;
  const hien = may.slice(0, TRAN_HIEN_MAY_DUNG_KHAN_CAP);
  return (
    <section
      data-testid="khoi-dung-khan-cap"
      aria-labelledby="khoi-dung-khan-cap-tieu-de"
      className="mx-auto w-full max-w-md space-y-3 px-4 pt-4"
    >
      <div className="space-y-1 border-l-4 pl-3" style={{ borderLeftColor: `var(${BIEN_MAU_DUNG})` }}>
        <h2 id="khoi-dung-khan-cap-tieu-de" className="text-base font-bold tracking-wide">
          {t("scada.dungMay.khanCap.tieuDe")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("scada.dungMay.khanCap.moTa")}</p>
      </div>
      {biCat && (
        <p data-testid="khoi-dung-khan-cap-bi-cat" role="alert" className="text-sm font-semibold" style={{ color: `var(${BIEN_MAU_DUNG})` }}>
          {t("scada.dungMay.khanCap.biCat")}
        </p>
      )}
      <ul className="max-h-[50vh] space-y-3 overflow-y-auto">
        {hien.map((m) => (
          <li key={m.machineId} data-testid={`may-khan-cap-${m.machineId}`} className="space-y-1">
            <p className="text-sm">
              <span className="font-semibold">{m.ten}</span>
              {m.chuyen && <span className="text-muted-foreground">{` · ${m.chuyen}`}</span>}
            </p>
            <NutDungMay machineId={m.machineId} tenMay={m.ten} soAdapter={m.soAdapter ?? undefined} coGhimStop={m.coDung} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export default KhoiDungKhanCap;
