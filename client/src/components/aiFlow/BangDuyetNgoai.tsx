/**
 * Đợt 10.4 (T5) — BẢNG DUYỆT PHIÊN BẢN CÓ NODE AI NGOÀI trong Flow Studio. Mỗi PHIÊN BẢN luồng có node model ngoài phải được admin duyệt (`aiNgoai.duyetNgoai`)
 * trước khi bật/chạy; băm định nghĩa đổi ⇒ duyệt lại. Bảng HIỂN THỊ cái đang duyệt TRƯỚC nút Duyệt (kế hoạch §D8, rà kiem-dinh):
 * danh sách node ngoài (nhà cung cấp · model · mức dữ liệu tĩnh · tóm tắt lệnh ĐÃ QUA BỘ CHE), mức tĩnh của cả luồng, người tạo phiên bản, trạng thái duyệt/tự duyệt.
 * Nút Duyệt chỉ ADMIN thấy (tiện lợi — máy chủ kiểm lại mọi thứ); tự duyệt luồng có dữ liệu vận hành bị CẤM (nút khoá + nói trước, máy chủ cũng chặn).
 * Mọi chuỗi từ máy chủ hiển thị bằng nút văn bản (không Markdown/HTML).
 */
import { useTranslation } from "react-i18next";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { toastTrpcError } from "@/lib/trpcErrors";

/** Máy chủ cắt `tomTatLenh` ở 200 ký tự (sau bộ che) — chạm trần ⇒ báo rõ phần còn lại KHÔNG hiển thị ở đây. */
const TRAN_TOM_TAT_LENH = 200;

type MucTinh = "ky-thuat" | "van-hanh" | "ke-thua";
export type TomTatNgoai =
  | { coNodeNgoai: false }
  | {
      coNodeNgoai: true;
      daDuyet: boolean;
      duyetBoi?: number;
      duyetLuc?: string;
      tuDuyet: boolean;
      toanHeThong: boolean;
      taoBoi: number | null;
      mucTinhLuong: "ky-thuat" | "van-hanh";
      nodes: Array<{ nodeId: string; nhaCungCap: string; model: string; mucTinh: MucTinh; tomTatLenh: string }>;
    };

interface Props {
  flowId: string;
  version: number | null;
  ngoai: TomTatNgoai | undefined;
  laAdmin: boolean;
  nguoiDungId: number | null;
  /** Có thay đổi CHƯA LƯU trên canvas — duyệt chỉ áp cho phiên bản ĐÃ LƯU. */
  dirty?: boolean;
  /** Gọi sau khi duyệt thành công (làm mới chiTiet). */
  onDaDuyet?: () => void;
}

export function BangDuyetNgoai({ flowId, version, ngoai, laAdmin, nguoiDungId, dirty, onDaDuyet }: Props) {
  const { t } = useTranslation();
  const duyet = trpc.aiNgoai.duyetNgoai.useMutation({
    onSuccess: (r) => {
      toast.success(r.daDuyetTruoc ? t("kiemDinhNgoai.duyet.daCoTruoc", "Phiên bản này đã được duyệt từ trước.") : t("kiemDinhNgoai.duyet.thanhCong", "Đã duyệt phiên bản dùng AI ngoài."));
      onDaDuyet?.();
    },
    onError: (e) => toastTrpcError(e),
  });
  if (!ngoai || !ngoai.coNodeNgoai) return null;
  const tuTao = nguoiDungId !== null && ngoai.taoBoi === nguoiDungId;
  const camTuDuyet = tuTao && ngoai.mucTinhLuong === "van-hanh";
  const khoa = !laAdmin || ngoai.toanHeThong || ngoai.daDuyet || camTuDuyet || duyet.isPending || version === null || !!dirty;
  return (
    <section data-testid="bang-duyet-ngoai" className="border-b bg-amber-500/5 px-4 py-2 text-xs" aria-label={t("kiemDinhNgoai.duyet.tieuDe", "Phiên bản dùng AI ngoài")}>
      <div className="flex flex-wrap items-center gap-2">
        {ngoai.daDuyet ? <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden /> : <ShieldAlert className="h-4 w-4 text-amber-600" aria-hidden />}
        <span className="font-medium">{t("kiemDinhNgoai.duyet.tieuDe", "Phiên bản dùng AI ngoài")}</span>
        <Badge variant="outline" data-testid="bdn-trang-thai" className={ngoai.daDuyet ? "border-emerald-500 text-emerald-700" : "border-amber-500 text-amber-700"}>
          {ngoai.daDuyet ? t("kiemDinhNgoai.duyet.daDuyet", "Đã duyệt") : t("kiemDinhNgoai.duyet.chuaDuyet", "Chưa duyệt — chưa bật/chạy được")}
        </Badge>
        <Badge variant="outline" data-testid="bdn-muc-luong">
          {ngoai.mucTinhLuong === "van-hanh" ? t("kiemDinhNgoai.duyet.mucVanHanh", "Mức dữ liệu cả luồng: vận hành") : t("kiemDinhNgoai.duyet.mucKyThuat", "Mức dữ liệu cả luồng: kỹ thuật")}
        </Badge>
        {ngoai.taoBoi !== null && (
          <span data-testid="bdn-tao-boi" className="text-muted-foreground">
            {t("kiemDinhNgoai.duyet.taoBoi", "Tạo bởi người dùng")} #{ngoai.taoBoi}
          </span>
        )}
        {ngoai.daDuyet && ngoai.duyetBoi !== undefined && (
          <span data-testid="bdn-duyet-boi" className="text-muted-foreground">
            {t("kiemDinhNgoai.duyet.duyetBoi", "Duyệt bởi")} #{ngoai.duyetBoi}
            {ngoai.duyetLuc ? ` · ${ngoai.duyetLuc.slice(0, 16).replace("T", " ")} UTC` : ""}
          </span>
        )}
        {ngoai.daDuyet && ngoai.tuDuyet && (
          <Badge variant="outline" data-testid="bdn-tu-duyet" className="border-amber-500 text-amber-700">
            {t("kiemDinhNgoai.duyet.tuDuyetCo", "Tự duyệt (người tạo cũng là người duyệt)")}
          </Badge>
        )}
        {laAdmin && !ngoai.daDuyet && (
          <Button type="button" size="sm" className="ml-auto h-7" data-testid="bdn-nut-duyet" disabled={khoa} onClick={() => version !== null && duyet.mutate({ flowId, version })}>
            {duyet.isPending ? t("kiemDinhNgoai.duyet.dangDuyet", "Đang duyệt…") : t("kiemDinhNgoai.duyet.nutDuyet", "Duyệt phiên bản này")}
          </Button>
        )}
      </div>

      <table data-testid="bdn-bang-node" className="mt-2 w-full text-left text-[11px]">
        <thead className="text-muted-foreground">
          <tr>
            <th className="pr-2 font-medium">{t("kiemDinhNgoai.duyet.bang.node", "Node")}</th>
            <th className="pr-2 font-medium">{t("kiemDinhNgoai.duyet.bang.model", "Nhà cung cấp · model")}</th>
            <th className="pr-2 font-medium">{t("kiemDinhNgoai.duyet.bang.muc", "Mức dữ liệu (tĩnh)")}</th>
            <th className="font-medium">{t("kiemDinhNgoai.duyet.bang.lenh", "Lệnh gửi đi (đã che, 200 ký tự đầu)")}</th>
          </tr>
        </thead>
        <tbody>
          {ngoai.nodes.map((n) => (
            <tr key={n.nodeId} data-testid={`bdn-node-${n.nodeId}`} className="align-top">
              <td className="pr-2 font-mono">{n.nodeId}</td>
              <td className="pr-2 font-mono">
                {n.nhaCungCap} · {n.model}
              </td>
              <td className="pr-2">{n.mucTinh}</td>
              <td className="whitespace-pre-wrap break-words">
                {n.tomTatLenh}
                {n.tomTatLenh.length >= TRAN_TOM_TAT_LENH && (
                  <span data-testid={`bdn-cat-${n.nodeId}`} className="ml-1 text-amber-700">
                    {t("kiemDinhNgoai.duyet.biCat", "… (đã cắt — chỉ thấy phần đầu; kiểm tra TOÀN BỘ tham số của node trong bảng cấu hình trước khi duyệt)")}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-2 space-y-1">
        {ngoai.toanHeThong && (
          <p data-testid="bdn-toan-he-thong" role="alert" className="text-red-700">
            {t("kiemDinhNgoai.duyet.toanHeThong", "Luồng toàn hệ thống không dùng được AI ngoài (dữ liệu ngoài phải thuộc một nhà máy).")}
          </p>
        )}
        {!ngoai.daDuyet && !laAdmin && (
          <p data-testid="bdn-nho-admin" className="text-muted-foreground">
            {t("kiemDinhNgoai.duyet.nhoAdmin", "Cần quản trị viên duyệt phiên bản này (sau khi xem các node ở trên) trước khi bật hoặc chạy luồng.")}
          </p>
        )}
        {!ngoai.daDuyet && laAdmin && camTuDuyet && (
          <p data-testid="bdn-cam-tu-duyet" role="alert" className="text-red-700">
            {t("kiemDinhNgoai.duyet.camTuDuyet", "Bạn là người tạo phiên bản này và luồng có dữ liệu vận hành gửi AI ngoài — không được tự duyệt. Nhờ một quản trị viên khác.")}
          </p>
        )}
        {!ngoai.daDuyet && laAdmin && tuTao && !camTuDuyet && (
          <p data-testid="bdn-canh-bao-tu-duyet" className="text-amber-700">
            {t("kiemDinhNgoai.duyet.canhBaoTuDuyet", "Bạn là người tạo phiên bản này: duyệt sẽ được ghi nhận là TỰ DUYỆT (nhật ký mức cao).")}
          </p>
        )}
        {!ngoai.daDuyet && laAdmin && dirty && (
          <p data-testid="bdn-chua-luu" className="text-muted-foreground">
            {t("kiemDinhNgoai.duyet.chuaLuu", "Có thay đổi chưa lưu — lưu rồi duyệt; duyệt chỉ áp cho phiên bản đã lưu.")}
          </p>
        )}
      </div>
    </section>
  );
}
