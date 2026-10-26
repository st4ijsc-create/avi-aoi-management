/**
 * SCADA R1b-2b-1 Task 1 (mục 59; điều phối 2026-10-26 Q1 + điều kiện 6; ruling C6 / C16; fix round 1) — khối "DỪNG MÁY khẩn cấp" trên trang
 * BUỘC ĐỔI MẬT KHẨU (nhánh khoá của `CongDoiMatKhau`). Người vận hành bị buộc đổi mật khẩu không tới được HMI (cổng client không render bảng
 * route) — khối này cho họ dừng máy trong khi chưa đổi.
 *
 *   • MỘT thủ tục đọc tối thiểu `scadaCommands.mayDungKhanCap` (máy trong phạm vi mà người gọi được dừng; máy chủ trả rỗng cho người không có
 *     quyền dừng ⇒ viewer không thấy khối). Dữ liệu chỉ có id / nhãn máy / nhãn chuyền / coDung / số adapter / gợi ý `tongHop` (C16).
 *   • Mỗi máy MỘT `NutDungMay` có sẵn (cùng hộp xác nhận một bước, cùng băng đỏ "DÙNG E-STOP CỨNG"); không nút / đường điều hướng nào khác.
 *     `coDung` null (khảo sát quá hạn / lỗi) ⇒ `NutDungMay` hiện "không kiểm được" — nút VẪN bấm được (dungMay tự quyết lúc gửi).
 *   • Gợi ý `tongHop` (điều phối M4 phương án b): "mot_phan" / "khong_toi" / "khong_ro" ⇒ MỘT dòng "Có thể không tới mọi thiết bị — dùng thêm
 *     E-STOP cứng". CHỈ là gợi ý: KHÔNG BAO GIỜ ẩn hay khoá nút DỪNG theo nó.
 *   • Đang tải ⇒ không hiện gì; lỗi (kể cả quá hạn 3 s của máy chủ) ⇒ MỘT dòng đỏ "Không tải được danh sách máy — dùng E-STOP cứng tại máy";
 *     NGOẠI LỆ (review M5): tường giấy phép / tính năng tắt (`FEATURE_DISABLED` — OT control chưa cấp phép) ⇒ KHÔNG hiện gì (không phải lỗi
 *     STOP; không báo động người không có SCADA); rỗng ⇒ không hiện.
 *   • Bị cắt (máy chủ đọc TRẦN + 1 hàng ⇒ `biCat`) ⇒ hiện TRẦN máy + dòng "danh sách có thể chưa đủ — dùng E-STOP cứng".
 *   • Màu: token DỪNG `--packml-abort` (không phải màu cảnh báo).
 */
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { TRAN_MAY_DUNG_KHAN_CAP } from "@shared/dungKhanCap";
import { BIEN_MAU_DUNG, NutDungMay } from "./DungMay";

/** Lỗi tường giấy phép / tính năng tắt (moduleGate: FORBIDDEN + appCode FEATURE_DISABLED) — không phải lỗi tải danh sách STOP. */
export function laLoiGiayPhep(e: unknown): boolean {
  const d = (e as { data?: { appCode?: unknown } } | null | undefined)?.data;
  return d?.appCode === "FEATURE_DISABLED";
}

export function KhoiDungKhanCap(): JSX.Element | null {
  const { t } = useTranslation();
  const q = trpc.scadaCommands.mayDungKhanCap.useQuery(undefined, { retry: false });
  if (q.isLoading) return null;
  if (q.isError) {
    if (laLoiGiayPhep(q.error)) return null;
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
  const biCat = q.data?.biCat === true || may.length > TRAN_MAY_DUNG_KHAN_CAP;
  const hien = may.slice(0, TRAN_MAY_DUNG_KHAN_CAP);
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
          <li key={m.machineId} data-testid={`may-khan-cap-${m.machineId}`} data-tong-hop={m.tongHop} className="space-y-1">
            <p className="text-sm">
              <span className="font-semibold">{m.ten}</span>
              {m.chuyen && <span className="text-muted-foreground">{` · ${m.chuyen}`}</span>}
            </p>
            <NutDungMay machineId={m.machineId} tenMay={m.ten} soAdapter={m.soAdapter ?? undefined} coGhimStop={m.coDung} />
            {/* gợi ý cấp máy (M4 b) — CHỈ một dòng; nút ở trên KHÔNG BAO GIỜ bị ẩn / khoá theo tongHop */}
            {m.tongHop !== "du" && (
              <p
                data-testid={`khan-cap-goi-y-${m.machineId}`}
                className="text-sm font-medium"
                style={{ color: `var(${BIEN_MAU_DUNG})` }}
              >
                {t("scada.dungMay.khanCap.khongToiMoi")}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default KhoiDungKhanCap;
