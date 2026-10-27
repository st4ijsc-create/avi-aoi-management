/**
 * Đợt 10.4 (T4) — BỘ HIỂN THỊ DUY NHẤT của `KetQuaKiemDinh` (kết quả AI NGOÀI): hộp kết quả, lịch sử chạy luồng, xuất báo cáo đều dùng cái này
 * (census: mọi chỗ render trường của kết quả phải import bộ này — kế hoạch §D3/N3).
 *
 * ⚠ Đầu ra AI ngoài là DỮ LIỆU KHÔNG TIN CẬY ⇒ MỌI chuỗi hiển thị bằng nút văn bản của React (`{chuoi}` / `<pre>`), KHÔNG Markdown, KHÔNG HTML thô,
 * KHÔNG ảnh/liên kết tự dựng, `viTri` chỉ là chữ (ký tự lạ thoát `\uXXXX`) — không bao giờ thành liên kết / nút mở tệp. Nút "Chép" chỉ đặt clipboard,
 * kèm cảnh báo cố định; KHÔNG có nút "Áp dụng". Dữ liệu vào được KIỂM LẠI bằng `parseKetQuaKiemDinh` (kể cả bản đọc từ lịch sử CSDL).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { parseKetQuaKiemDinh, thoatKyTuLa, type KetLuanKiemDinh, type MucLoiKiemDinh } from "@shared/ai/kiemDinhNgoai";

export interface VetKiemDinh {
  nhaCungCap: string;
  model: string;
  tokenVao: number | null;
  tokenRa: number | null;
  chiPhiUocUsd: number | null;
  soLanGoi?: number;
  tuBoNho?: boolean;
}

const MAU_KET_LUAN: Record<KetLuanKiemDinh, string> = {
  dat: "border-emerald-500 text-emerald-700",
  "can-sua": "border-amber-500 text-amber-700",
  sai: "border-red-500 text-red-700",
};
const MAU_MUC: Record<MucLoiKiemDinh, string> = {
  "nghiem-trong": "border-red-500 text-red-700",
  vua: "border-amber-500 text-amber-700",
  nhe: "border-slate-400 text-slate-600",
};

export function HienThiKetQuaNgoai({ ketQua, vet }: { ketQua: unknown; vet?: VetKiemDinh }) {
  const { t } = useTranslation();
  const [daChep, setDaChep] = useState(false);
  const kq = parseKetQuaKiemDinh(ketQua);
  if (!kq.ok) {
    return (
      <div role="alert" data-testid="kdn-khong-hop-le" className="rounded border border-red-500 p-2 text-xs text-red-700">
        {t("kiemDinhNgoai.khongHopLe", "Kết quả kiểm định không đúng định dạng nên không hiển thị.")}
      </div>
    );
  }
  const d = kq.data;
  const chep = async () => {
    try {
      await navigator.clipboard.writeText(d.banChuanHoa ?? "");
      setDaChep(true);
      toast.success(t("kiemDinhNgoai.daChep", "Đã chép bản chuẩn hoá."));
    } catch {
      toast.error(t("kiemDinhNgoai.chepLoi", "Không chép được — hãy bôi đen và chép tay."));
    }
  };
  return (
    <div data-testid="kdn-ket-qua" className="space-y-3 text-sm">
      <p className="text-xs text-muted-foreground">{t("kiemDinhNgoai.yKienNgoai", "Ý kiến của AI bên ngoài — cần người xem xét, có thể sai.")}</p>
      <div className="flex items-center gap-2">
        <span data-testid="kdn-ket-luan" className={`rounded border px-2 py-0.5 text-xs font-medium ${MAU_KET_LUAN[d.ketLuan]}`}>
          {t(`kiemDinhNgoai.ketLuan.${d.ketLuan}`, d.ketLuan)}
        </span>
        <span data-testid="kdn-diem" className="text-xs">
          {t("kiemDinhNgoai.diem", "Điểm")}: {d.diem}/100
        </span>
      </div>

      {d.loi.length > 0 && (
        <section>
          <h4 className="mb-1 text-xs font-semibold">{t("kiemDinhNgoai.loi", "Lỗi / góp ý")}</h4>
          <ul data-testid="kdn-loi" className="space-y-1">
            {d.loi.map((l, i) => (
              <li key={i} className="rounded border p-2">
                <span className={`mr-2 rounded border px-1.5 text-[10px] ${MAU_MUC[l.muc]}`}>{t(`kiemDinhNgoai.muc.${l.muc}`, l.muc)}</span>
                <span className="whitespace-pre-wrap break-words">{l.moTa}</span>
                {l.viTri !== undefined && l.viTri !== "" && (
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {t("kiemDinhNgoai.viTri", "Vị trí")}: <code data-testid="kdn-vi-tri">{thoatKyTuLa(l.viTri)}</code>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {d.banChuanHoa !== undefined && d.banChuanHoa !== "" && (
        <section>
          <div className="mb-1 flex items-center justify-between">
            <h4 className="text-xs font-semibold">{t("kiemDinhNgoai.banChuanHoa", "Bản chuẩn hoá (AI ngoài đề xuất)")}</h4>
            <button type="button" data-testid="kdn-chep" className="rounded border px-2 py-0.5 text-xs" onClick={() => void chep()}>
              {daChep ? t("kiemDinhNgoai.daChepNut", "Đã chép") : t("kiemDinhNgoai.chep", "Chép")}
            </button>
          </div>
          <pre data-testid="kdn-ban-chuan-hoa" className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded border bg-muted/40 p-2 text-xs">{d.banChuanHoa}</pre>
          <p data-testid="kdn-canh-bao-chep" className="mt-1 text-[11px] text-amber-700">
            {t("kiemDinhNgoai.canhBaoChep", "Kiểm tra kỹ trước khi chạy hoặc dán vào terminal/tệp. Nội dung do AI bên ngoài viết, không được tự áp dụng.")}
          </p>
        </section>
      )}

      {d.baiHocDeXuat.length > 0 && (
        <section>
          <h4 className="mb-1 text-xs font-semibold">{t("kiemDinhNgoai.baiHoc", "Bài học đề xuất")}</h4>
          <p className="mb-1 text-[11px] text-muted-foreground">{t("kiemDinhNgoai.baiHocGhiChu", "Chỉ là đề xuất — chưa được áp dụng; cần người duyệt.")}</p>
          <ul data-testid="kdn-bai-hoc" className="space-y-1">
            {d.baiHocDeXuat.map((b, i) => (
              <li key={i} className="rounded border p-2">
                <span className="mr-2 rounded border px-1.5 text-[10px]">{t(`kiemDinhNgoai.phamVi.${b.phamVi}`, b.phamVi)}</span>
                <span className="whitespace-pre-wrap break-words">{b.noiDung}</span>
                {b.viDu !== undefined && b.viDu !== "" && <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-muted/40 p-1 text-[11px]">{b.viDu}</pre>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {vet && (
        <p data-testid="kdn-vet" className="text-[11px] text-muted-foreground">
          {vet.nhaCungCap} · {vet.model}
          {vet.tokenVao !== null || vet.tokenRa !== null ? ` · ${vet.tokenVao ?? "?"} → ${vet.tokenRa ?? "?"} token` : ""}
          {vet.chiPhiUocUsd !== null ? ` · ~$${vet.chiPhiUocUsd.toFixed(4)}` : ""}
          {vet.soLanGoi === 2 ? ` · ${t("kiemDinhNgoai.thuLai", "đã thử lại 1 lần (tính phí hai lượt)")}` : ""}
          {vet.tuBoNho ? ` · ${t("kiemDinhNgoai.tuBoNho", "kết quả đã có từ lần gọi trước — không tính phí lần nữa")}` : ""}
        </p>
      )}
    </div>
  );
}
