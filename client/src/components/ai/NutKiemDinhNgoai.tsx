/**
 * Đợt 10.4 (T4b) — nút "Nhờ AI ngoài kiểm định" + hộp xác nhận/kết quả. Người BẤM (không tự động).
 *
 * Bất biến (kế hoạch §D4–D6, rà kiem-dinh):
 *   • Chỉ gửi ID lượt ĐÃ LƯU (`nguon`) — máy chủ tự đọc kho, tự suy nhà máy + mức dữ liệu; client KHÔNG gửi văn bản / mức / nhà máy; không có đường `van-ban`.
 *   • Nút CHỈ hiện khi danh mục có model ngoài với `duocDungO ∋ "kiem-dinh"` (nhà máy đã bật); không có ⇒ không render gì.
 *   • Hộp xác nhận hiện model, mức dữ liệu, ước token (BI QUAN 2–4×), chi phí, trần ngày còn lại, kích thước; `duocPhep=false` ⇒ nút gửi KHOÁ kèm lý do (chỉ tiện lợi — rào thật ở máy chủ, `chay` tự kiểm lại).
 *   • Gửi một lần: nút vô hiệu khi đang chạy (+ khoá đồng bộ chống bấm đúp); 409 / kết quả cũ (`tuBoNho`) được nói rõ.
 *   • AI ngoài KHÔNG có công cụ; kết quả hiển thị qua `HienThiKetQuaNgoai` (văn bản thuần).
 */
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { mapTrpcError } from "@/lib/trpcErrors";
import { useDanhMucModel } from "@/hooks/useDanhMucModel";
import { HienThiKetQuaNgoai, type VetKiemDinh } from "./HienThiKetQuaNgoai";

export type NguonKiemDinh =
  | { loai: "chat"; cuocTroChuyenId: number; tinNhanId: number }
  | { loai: "agent"; runId: string }
  | { loai: "coding"; phienId: string; chiSoLuot: number };

const TRAN_TIEU_CHI = 2000;

const fmt = (n: number | null | undefined, donVi = ""): string => (n === null || n === undefined ? "—" : `${n.toLocaleString("vi-VN")}${donVi}`);

export function NutKiemDinhNgoai({ nguon, className }: { nguon: NguonKiemDinh | null; className?: string }) {
  const { t } = useTranslation();
  const { danhMuc } = useDanhMucModel();
  const [mo, setMo] = useState(false);
  const modelNgoai = danhMuc.filter((m) => m.loai === "ngoai" && Array.isArray(m.duocDungO) && m.duocDungO.includes("kiem-dinh") && m.trangThai !== "tat");
  if (modelNgoai.length === 0) return null;
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        data-testid="nut-kiem-dinh-ngoai"
        className={className ?? "h-6 gap-1 px-1.5 text-[11px]"}
        disabled={nguon === null}
        title={nguon === null ? t("kiemDinhNgoai.nut.chuaLuu", "Lượt này chưa được lưu nên chưa kiểm định được.") : t("kiemDinhNgoai.nut.tip", "Nhờ một AI bên ngoài kiểm định lại câu trả lời này (người bấm; có che dữ liệu, có trần chi phí).")}
        onClick={() => setMo(true)}
      >
        <ShieldCheck className="h-3 w-3" />
        {t("kiemDinhNgoai.nut.nhan", "Nhờ AI ngoài kiểm định")}
      </Button>
      {mo && nguon !== null && <HopKiemDinhNgoai nguon={nguon} modelNgoai={modelNgoai.map((m) => ({ ma: m.ma, nhan: m.nhan }))} dong={() => setMo(false)} />}
    </>
  );
}

function HopKiemDinhNgoai({ nguon, modelNgoai, dong }: { nguon: NguonKiemDinh; modelNgoai: { ma: string; nhan: string }[]; dong: () => void }) {
  const { t } = useTranslation();
  const [model, setModel] = useState(modelNgoai[0]?.ma ?? "");
  const [tieuChi, setTieuChi] = useState("");
  const dangGui = useRef(false);
  const xem = trpc.aiKiemDinh.xemTruoc.useQuery({ chonModel: model, nguon }, { enabled: model !== "", retry: false, refetchOnWindowFocus: false, staleTime: 0 });
  const chay = trpc.aiKiemDinh.chay.useMutation({ onSettled: () => (dangGui.current = false) });
  const x = xem.data;
  const khoa = !x || !x.duocPhep || x.kichThuocByte > x.tranByte || chay.isPending || chay.isSuccess;
  const gui = () => {
    if (dangGui.current || khoa) return;
    dangGui.current = true;
    chay.mutate({ chonModel: model, nguon, ...(tieuChi.trim() ? { tieuChi: tieuChi.trim() } : {}) });
  };
  const vet: VetKiemDinh | undefined = chay.data ? { ...chay.data.vet, ...("tuBoNho" in chay.data && chay.data.tuBoNho ? { tuBoNho: true } : {}) } : undefined;
  return (
    <Dialog open onOpenChange={(v) => (!v ? dong() : undefined)}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto" data-testid="hop-kiem-dinh-ngoai">
        <DialogHeader>
          <DialogTitle>{t("kiemDinhNgoai.hop.tieuDe", "Nhờ AI ngoài kiểm định")}</DialogTitle>
          <DialogDescription>{t("kiemDinhNgoai.hop.moTa", "Câu hỏi và câu trả lời của lượt này được che dữ liệu nhạy cảm rồi gửi cho AI bên ngoài (trả phí). AI ngoài không có công cụ và không thể thao tác gì trên hệ thống.")}</DialogDescription>
        </DialogHeader>

        {!chay.isSuccess && (
          <div className="space-y-3 text-sm">
            <label className="block text-xs font-medium">
              {t("kiemDinhNgoai.hop.model", "Model ngoài")}
              <select data-testid="kdnh-model" className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={model} disabled={chay.isPending} onChange={(e) => setModel(e.target.value)}>
                {modelNgoai.map((m) => (
                  <option key={m.ma} value={m.ma}>
                    {m.nhan}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium">
              {t("kiemDinhNgoai.hop.tieuChi", "Tiêu chí (tuỳ chọn)")}
              <Textarea data-testid="kdnh-tieu-chi" className="mt-1 min-h-[60px] text-xs" maxLength={TRAN_TIEU_CHI} value={tieuChi} disabled={chay.isPending} onChange={(e) => setTieuChi(e.target.value)} />
              <span data-testid="kdnh-tieu-chi-canh-bao" className="mt-0.5 block text-[11px] font-normal text-amber-700">
                {t("kiemDinhNgoai.hop.tieuChiCanhBao", "Không dán dữ liệu vận hành (số liệu, tên khách hàng, khoá…) vào ô này — máy chủ chỉ che theo mẫu, không phân loại được nội dung bạn gõ.")}
              </span>
            </label>

            {xem.isError && (
              <p role="alert" data-testid="kdnh-loi-xem" className="rounded border border-red-500 p-2 text-xs text-red-700">
                {mapTrpcError(xem.error)}
              </p>
            )}
            {xem.isLoading && model !== "" && <p className="text-xs text-muted-foreground">{t("kiemDinhNgoai.hop.dangTinh", "Đang tính ước lượng…")}</p>}
            {x && (
              <div data-testid="kdnh-xem" className="space-y-1 rounded border p-2 text-xs">
                <p>
                  {x.nhaCungCap} · {x.model}
                </p>
                <p data-testid="kdnh-muc">
                  {t("kiemDinhNgoai.hop.muc", "Mức dữ liệu")}: <b>{x.mucDuLieu === "van-hanh" ? t("kiemDinhNgoai.hop.vanHanh", "dữ liệu vận hành") : t("kiemDinhNgoai.hop.kyThuat", "kỹ thuật")}</b>
                </p>
                {nguon.loai === "coding" && (
                  <p data-testid="kdnh-ghi-chu-coding" className="text-amber-700">
                    {t("kiemDinhNgoai.hop.codingVanHanh", "Nội dung lập trình được coi là dữ liệu vận hành.")}
                  </p>
                )}
                <p data-testid="kdnh-uoc">
                  {t("kiemDinhNgoai.hop.uoc", "Ước tính (bi quan, có thể cao hơn thật 2–4×)")}: {fmt(x.tokenUoc, " token")} · {x.chiPhiUocUsd === null ? t("kiemDinhNgoai.hop.chuaCoGia", "chưa có bảng giá") : `~$${x.chiPhiUocUsd.toFixed(4)}`}
                </p>
                {/* Q2 (dieu-phoi): người KHÔNG phải admin chỉ thấy trần CỦA MÌNH + "nhà máy còn đủ trần cho lượt này"; số token/USD của NHÀ MÁY chỉ có khi admin (khoá vắng ⇒ không hiện). */}
                <div data-testid="kdnh-tran" className="space-y-0.5">
                  <p data-testid="kdnh-tran-nguoi">
                    {t("kiemDinhNgoai.hop.tranNguoi", "Trần còn lại của bạn hôm nay")}: {x.conLaiTranNgay.nguoi.token === null ? t("kiemDinhNgoai.hop.chuaDatTran", "chưa đặt trần") : fmt(x.conLaiTranNgay.nguoi.token, " token")}
                    {x.conLaiTranNgay.nguoi.token !== null && x.conLaiTranNgay.nguoi.token < x.tokenUoc && (
                      <b data-testid="kdnh-tran-nguoi-het" className="ml-1 text-red-700">
                        {t("kiemDinhNgoai.hop.tranNguoiHet", "— không đủ cho lượt này")}
                      </b>
                    )}
                  </p>
                  <p data-testid="kdnh-tran-nha-may">
                    {t("kiemDinhNgoai.hop.nhaMayDuTran", "Nhà máy còn đủ trần cho lượt này")}:{" "}
                    <b className={x.conLaiTranNgay.nhaMay.duTranChoLuotNay ? "" : "text-red-700"}>{x.conLaiTranNgay.nhaMay.duTranChoLuotNay ? t("kiemDinhNgoai.hop.co", "có") : t("kiemDinhNgoai.hop.khong", "không")}</b>
                    {"token" in x.conLaiTranNgay.nhaMay || "usd" in x.conLaiTranNgay.nhaMay ? (
                      <span data-testid="kdnh-tran-nha-may-so" className="text-muted-foreground">
                        {" "}
                        ({fmt(x.conLaiTranNgay.nhaMay.token ?? null, " token")} / {x.conLaiTranNgay.nhaMay.usd === null || x.conLaiTranNgay.nhaMay.usd === undefined ? "—" : `$${x.conLaiTranNgay.nhaMay.usd}`})
                      </span>
                    ) : null}
                  </p>
                </div>
                <p className="text-muted-foreground">{t("kiemDinhNgoai.hop.kichThuoc", "Kích thước")}: {fmt(x.kichThuocByte, " byte")} / {fmt(x.tranByte, " byte")}</p>
                {x.kichThuocByte > x.tranByte && (
                  <p role="alert" data-testid="kdnh-qua-lon" className="text-red-700">
                    {t("kiemDinhNgoai.hop.quaLon", "Quá lớn để gửi — hãy kiểm định một lượt/đoạn nhỏ hơn.")}
                  </p>
                )}
                {!x.duocPhep && (
                  <p role="alert" data-testid="kdnh-khoa" className="text-red-700">
                    {t("kiemDinhNgoai.hop.khoa", "Chưa gửi được")}: {x.lyDo ? t(`errors.reason.${x.lyDo}`, x.lyDo) : ""}
                    {x.lyDo === "NGOAI_VUOT_TRAN" && (
                      <span data-testid="kdnh-khoa-tran-ai" className="ml-1">
                        {!x.conLaiTranNgay.nhaMay.duTranChoLuotNay ? t("kiemDinhNgoai.hop.tranNhaMayHet", "(trần của NHÀ MÁY đã hết)") : t("kiemDinhNgoai.hop.tranNguoiHetLyDo", "(trần CỦA BẠN đã hết)")}
                      </span>
                    )}
                  </p>
                )}
                <p className="text-muted-foreground">{t("kiemDinhNgoai.hop.cheDuLieu", "Nội dung được che trước khi rời máy. Đây là rào chống nhầm, không thay trách nhiệm của người gửi.")}</p>
              </div>
            )}

            {chay.isError && (
              <p role="alert" data-testid="kdnh-loi" className="rounded border border-red-500 p-2 text-xs text-red-700">
                {mapTrpcError(chay.error)}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={dong}>
                {t("kiemDinhNgoai.hop.huy", "Đóng")}
              </Button>
              <Button type="button" size="sm" data-testid="kdnh-gui" disabled={khoa} onClick={gui}>
                {chay.isPending ? t("kiemDinhNgoai.hop.dangGui", "Đang kiểm định…") : t("kiemDinhNgoai.hop.gui", "Gửi kiểm định (trả phí)")}
              </Button>
            </div>
          </div>
        )}

        {chay.isSuccess && chay.data && (
          <div data-testid="kdnh-ket-qua">
            <HienThiKetQuaNgoai ketQua={chay.data.ketQua} vet={vet} />
            <div className="mt-3 flex justify-end">
              <Button type="button" variant="outline" size="sm" onClick={dong}>
                {t("kiemDinhNgoai.hop.huy", "Đóng")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
