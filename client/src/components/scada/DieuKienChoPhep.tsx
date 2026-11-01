/**
 * R1b-2b-2b B-T11 (M4, mục 2) — khối "Điều kiện cho phép" trên faceplate: CHẠY KHÔ `scadaCommands.dieuKienChoPhep` (C5) khi giá trị nhập hợp lệ.
 *
 *   • CHỈ HIỂN THỊ. KHÔNG khoá nút "Đổi…" theo kết quả — máy chủ là trọng tài ở `request` (chạy khô chỉ biết các cổng TĨNH, `chuaTinh` nói rõ
 *     phần chưa kiểm: khoá chọn, xác minh mã, hạn gửi).
 *   • KHÔNG POLL (dieu-phoi chốt): hỏi khi người dùng đổi giá trị, sau debounce 400 ms; không `refetchInterval`, không `refetchOnWindowFocus`;
 *     không retry. Trần máy chủ 30 lượt / phút / adapter.
 *   • Từ chối (`tuChoi {code, params}`) = ĐÚNG lỗi `request` sẽ trả ⇒ dịch bằng CÙNG hàm (`moTaLoiLenh` + `cauLoiLenh`) như lỗi của request.
 *   • Lỗi của chính cuộc chạy khô (kể cả `rateLimited`) ⇒ ẨN khối, không chặn thao tác.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { mapTrpcError } from "@/lib/trpcErrors";
import { cauLoiLenh } from "./HopThoaiLenh";
import { moTaLoiLenh } from "./ketQuaLenh";

export const DEBOUNCE_DIEU_KIEN_MS = 400;
type GiaTri = number | boolean | string;

export function DieuKienChoPhep({ adapterId, tagKey, giaTri, laEdge }: { adapterId: number; tagKey: string; giaTri: GiaTri | null; laEdge: boolean }) {
  const { t, i18n } = useTranslation();
  // debounce theo GIÁ TRỊ (không theo tham chiếu): gõ nhanh 5 ký tự ⇒ một lượt
  const khoaGiaTri = giaTri === null ? null : JSON.stringify(giaTri);
  const [daLoc, setDaLoc] = useState<GiaTri | null>(null);
  useEffect(() => {
    if (khoaGiaTri === null) {
      setDaLoc(null);
      return;
    }
    const h = setTimeout(() => setDaLoc(JSON.parse(khoaGiaTri) as GiaTri), DEBOUNCE_DIEU_KIEN_MS);
    return () => clearTimeout(h);
  }, [khoaGiaTri]);

  const q = trpc.scadaCommands.dieuKienChoPhep.useQuery(
    { adapterId, tagKey, value: daLoc as GiaTri },
    { enabled: daLoc !== null && khoaGiaTri !== null, retry: false, refetchOnWindowFocus: false, refetchInterval: false },
  );

  // giá trị đã đổi/xoá mà chưa tới lượt hỏi ⇒ kết quả cũ không còn đúng với ô nhập ⇒ ẩn
  if (khoaGiaTri === null || daLoc === null || JSON.stringify(daLoc) !== khoaGiaTri || q.isError || !q.data) return null;
  const d = q.data;

  return (
    <div data-testid="dieu-kien" className="space-y-1 rounded-sm border px-3 py-2 text-sm">
      <p className="text-xs font-medium text-muted-foreground">{t("scada.dieuKien.tieuDe")}</p>
      {d.quaCongTinh ? (
        <>
          <p data-testid="dieu-kien-ket-qua" data-ket-qua={d.canTotp ? "duoc-phep-totp" : "duoc-phep"} className="font-medium">
            {d.canTotp ? t("scada.dieuKien.duocPhepTotp") : t("scada.dieuKien.duocPhep")}
          </p>
          {d.canhBao.length > 0 && (
            <ul data-testid="dieu-kien-canh-bao" className="list-disc pl-4 text-xs">
              {d.canhBao.map((w) => (
                <li key={w}>{t(`scada.lenh.canhBaoMa.${w}`, { defaultValue: w })}</li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p data-testid="dieu-kien-ket-qua" data-ket-qua="khong-duoc-phep" className="font-medium">
          {t("scada.dieuKien.khongDuocPhep", {
            lyDo: (() => {
              const loi = { data: { appCode: d.tuChoi.code, appParams: d.tuChoi.params } };
              return cauLoiLenh(t, moTaLoiLenh(loi, "request", { laEdge, locale: i18n.language }), mapTrpcError(loi));
            })(),
          })}
        </p>
      )}
      <p data-testid="dieu-kien-chua-tinh" className="text-xs text-muted-foreground">
        {t("scada.dieuKien.chuaTinh", { ds: d.chuaTinh.map((c) => t(`scada.dieuKien.chuaTinhMuc.${c}`)).join(", ") })}
      </p>
    </div>
  );
}
