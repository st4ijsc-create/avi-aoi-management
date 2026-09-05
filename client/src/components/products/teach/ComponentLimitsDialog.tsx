/**
 * ComponentLimitsDialog.tsx — Khối C Task 11: dialog DẠY GIỚI HẠN (đơn + hàng loạt), gọi
 * `measurementPoint.setLimitsBatch` (Task 8). Nối vào nút "Dạy giới hạn" no-op của Task 10
 * (`ComponentLimitsTable.tsx: onEdit/onBatchEdit`).
 *
 * Ba quyết định chủ dự án (2026-09-03) hiện thực ở đây:
 *   1. Kỹ sư dạy giới hạn TRÊN HỆ — form chỉ nhập `lowerLimit`/`upperLimit`/`unit`/`heightMin`/
 *      `heightMax`. KHÔNG có trường hình học (roi/vị trí) — máy vẫn là nguồn sự thật của hình
 *      học điểm (xem `diemCayDayChoCanvas` trong `componentLimitsDialogLogic.ts`: hình học chỉ
 *      ĐỌC để vẽ canvas, không có input nào sửa nó).
 *   2. Đúng 5 trường `TEN_TRUONG_FORM` (`componentLimitsDialogLogic.ts`, khớp `TEN_COT_HIEN_THI`
 *      của Task 10) — nhãn lấy từ `POINT_LIMIT_SPEC` qua `pointLimits.*` (đã có sẵn từ Task 10,
 *      KHÔNG khai lại). `nominalValue` KHÔNG xuất hiện (không thuộc `POINT_LIMIT_SPEC`).
 *   3. R-KC-1 — canvas TRONG dialog: mở MỘT component ⇒ `MeasurementPointCanvas` chỉ-đọc highlight
 *      đúng ROI của điểm đó (fetch riêng qua `measurementPoint.getById`, vì `ComponentLimitsRow`
 *      của Task 10 KHÔNG mang roi (x/y/width/height) hay referenceImageUrl — bảng đó cố ý chỉ phơi 5 cột giới hạn).
 *      Hàng loạt (N>1): ẨN canvas (lựa chọn được brief cho phép — "highlight nhiều điểm HOẶC ẩn")
 *      vì mỗi component có `referenceImageUrl`/roi RIÊNG (per-component template path,
 *      `machineTemplateContract.ts: componentTemplate.templateImagePath`) — không có gì bảo đảm
 *      N component cùng chia sẻ một ảnh nền, và fetch N `getById` (tới 200 theo trần
 *      `setLimitsBatch`) chỉ để thử là phí không cần thiết.
 *
 * ⚠⚠ BÁC BỎ BRIEF (khai kỹ trong `componentLimitsDialogLogic.ts`, đọc trước khi sửa file này):
 *   - "sản phẩm sống ⇒ đã gửi duyệt N điểm": ĐO ĐƯỢC `setLimitsBatch` khi bị chặn CHỈ throw
 *     FORBIDDEN, KHÔNG ghi gì vào `threshold_approvals`. Dialog báo "CHƯA lưu, cần duyệt"
 *     (`docLoiCanDuyetNguong`/`thongBaoCanDuyet`), không bịa "đã gửi duyệt".
 *   - "heightMin/Max numeric(10,4)": schema thật `decimal(precision:15, scale:6)` cho CẢ BỐN
 *     trường số (`lowerLimit`/`upperLimit`/`heightMin`/`heightMax`) — kiểm bằng `laChuoiSoHopLe`.
 *
 * Sau lưu THÀNH CÔNG: invalidate `cayDay.listComponents` + `cayDay.thongKeGioiHan` (Task 9) —
 * KHÔNG tự sửa state cục bộ (đúng luật "không hai nguồn sự thật", `keHoachLamMoiSauLuu`).
 *
 * ── Vòng sửa 1 (review) ─────────────────────────────────────────────────────────────────────
 * Important (race dữ liệu thật) — xem docblock `coTheLuu` (`componentLimitsDialogLogic.ts`): đổi
 * điểm A→B ở chế độ đơn trong lúc `getById(B)` đang tải trước đây KHÔNG chặn Lưu, có thể ghi giá
 * trị của A lên B. Vá bằng HAI lớp: (a) `gia` reset NGAY khi tập `rows` đổi (kể cả đơn); (b) Lưu
 * khoá cứng qua `coTheLuu` (đơn: `chiTietQuery.isFetching`).
 * Minor: (1) `kiemTraForm` thêm so sánh `lowerLimit ≤ upperLimit`/`heightMin ≤ heightMax` khi cả
 * hai đã là số hợp lệ (server-side là nợ BG-113, không sửa ở vòng này); (2) hàng loạt hiện một
 * dòng giải thích vì sao canvas ẩn; (3) tooltip "Dạy giới hạn (sắp có)" ở `ComponentLimitsTable.tsx`
 * bỏ "(sắp có)" — nút đã hoạt động thật từ Task 11.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2, AlertTriangle, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toastTrpcError } from "@/lib/trpcErrors";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { MeasurementPointCanvas } from "@/components/measurement-point-canvas/MeasurementPointCanvas";
import { POINT_LIMIT_SPEC } from "@shared/pointLimitSpec";
import type { ComponentLimitsRow } from "./teachTreeLogic";
import {
  TEN_TRUONG_FORM,
  FORM_RONG,
  type FormGioiHan,
  type TenTruongForm,
  kiemTraForm,
  soTruongThayDoi,
  xayInputSetLimitsBatch,
  ketQuaThanhCong,
  docLoiCanDuyetNguong,
  thongBaoThanhCong,
  thongBaoCanDuyet,
  keHoachLamMoiSauLuu,
  diemCayDayChoCanvas,
  coTheLuu,
  type KetQuaCanDuyet,
} from "./componentLimitsDialogLogic";

export interface ComponentLimitsDialogProps {
  /** 1 phần tử = sửa đơn, N phần tử = sửa hàng loạt (áp cùng một bộ giá trị). */
  rows: ComponentLimitsRow[];
  captureRowId: number;
  productModelId: number;
  machineId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Nhãn 5 trường form — LỌC từ `POINT_LIMIT_SPEC`, đọc `i18nKey` có sẵn (`pointLimits.*`, Task 10). KHÔNG khai lại tay. */
const NHAN_TRUONG = new Map<string, string>(POINT_LIMIT_SPEC.map((m) => [m.field, m.i18nKey]));

function docChuoi(v: unknown): string {
  return v == null ? "" : String(v);
}

export function ComponentLimitsDialog({
  rows,
  captureRowId,
  productModelId,
  machineId,
  open,
  onOpenChange,
}: ComponentLimitsDialogProps) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const [gia, setGia] = useState<FormGioiHan>(FORM_RONG);
  // M-5 (vòng sửa 9) — giá trị ĐÃ TẢI của form đơn, chụp lại NGAY khi `chiTietQuery.data` về (xem
  // effect dưới) — baseline để `layTruongThayDoi`/`soTruongThayDoi` chỉ gửi trường THẬT SỰ đổi.
  // `null` ở hàng loạt (không có "giá trị đã tải" chung — N component có thể khác nhau) VÀ trong
  // lúc đơn đang tải/chưa tải (tránh so `gia` MỚI với baseline CŨ của điểm trước).
  const [giaGoc, setGiaGoc] = useState<FormGioiHan | null>(null);
  const [lyDoDoi, setLyDoDoi] = useState("");
  const [canDuyet, setCanDuyet] = useState<KetQuaCanDuyet | null>(null);
  // Lô 2 nhóm B (BG-123 phần UI) — tập trường bị đánh dấu "Xoá giới hạn" (gửi `null`, khác với ô
  // trống = "không đổi"/undefined). Đơn: nút X nhỏ cạnh MỖI ô ĐANG CÓ giá trị đã tải (giaGoc).
  // Hàng loạt: checkbox "Xoá trường này trên các điểm đã chọn" — không có "giá trị đã tải chung"
  // để so, nên hiện cho CẢ 5 trường luôn (đúng docChuoi/FORM_RONG hàng loạt vốn đã không tiền điền).
  const [xoaTruong, setXoaTruong] = useState<Set<TenTruongForm>>(new Set());

  const donMode = rows.length === 1;
  const diemDau = rows[0];

  // Đơn: nạp point-def ĐẦY ĐỦ — `ComponentLimitsRow` (Task 10) cố ý KHÔNG mang roi*/
  // referenceImageUrl (bảng chỉ phơi 5 cột giới hạn), nên canvas + tiền điền form cần một
  // nguồn khác: `measurementPoint.getById` (đã tenant-scope qua `phamViCua(ctx)`, có sẵn).
  const chiTietQuery = trpc.measurementPoint.getById.useQuery(
    { id: diemDau?.id ?? 0 },
    { enabled: open && donMode && diemDau != null },
  );

  // Mở dialog (hoặc đổi tập rows) ⇒ nạp lại form. LUÔN reset `gia` NGAY LẬP TỨC ở đây — kể cả đơn
  // (vòng sửa 1, Important: đổi từ điểm A sang điểm B trước đây KHÔNG reset `gia` cho đơn, để giá
  // trị của A còn hiển thị/gửi được trong lúc `getById(B)` đang tải — xem `coTheLuu` trong
  // `componentLimitsDialogLogic.ts`). Đơn sẽ được TIỀN ĐIỀN lại từ giá trị B ở effect dưới, ngay
  // khi `chiTietQuery.data` cho B về tới. Hàng loạt giữ RỖNG luôn — các component có thể đang giữ
  // giá trị KHÁC NHAU, tiền điền một giá trị bất kỳ sẽ trông như "giá trị chung" giả.
  useEffect(() => {
    if (!open) return;
    setCanDuyet(null);
    setLyDoDoi("");
    setGia(FORM_RONG);
    setGiaGoc(null); // M-5 — không baseline nào tin được cho tới khi chiTietQuery.data mới về.
    setXoaTruong(new Set()); // Lô 2 nhóm B — đổi mục tiêu (đơn A→B, hoặc đổi tập chọn) reset luôn ý định Xoá cũ.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, donMode, rows.map((r) => r.id).join(",")]);

  useEffect(() => {
    if (!open || !donMode || !chiTietQuery.data) return;
    const d = chiTietQuery.data as Record<string, unknown>;
    const daTai: FormGioiHan = {
      lowerLimit: docChuoi(d.lowerLimit),
      upperLimit: docChuoi(d.upperLimit),
      unit: docChuoi(d.unit),
      heightMin: docChuoi(d.heightMin),
      heightMax: docChuoi(d.heightMax),
    };
    setGia(daTai);
    setGiaGoc(daTai); // M-5 — baseline = ĐÚNG giá trị vừa tiền điền, để so sánh trước khi Lưu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, donMode, chiTietQuery.data]);

  const loiForm = useMemo(() => kiemTraForm(gia), [gia]);
  // M-5 (vòng sửa 9) — đơn: chỉ đếm trường THẬT SỰ đổi so với `giaGoc` (đếm cả 5 trường tiền điền
  // dù không sửa gì sẽ cho phép Lưu vô ích — sinh version + bump `pointsConfigVersion`, xem
  // `layTruongThayDoi`). Hàng loạt: `giaGoc` luôn `null` ⇒ hàm rơi về hành vi CŨ (đếm mọi trường
  // có nội dung), không đổi. Lô 2 nhóm B — con số này ĐÃ gồm cả trường bị đánh dấu Xoá
  // (`layTruongThayDoi` cộng chúng vào cùng object kết quả dưới dạng `null`).
  const soTruong = soTruongThayDoi(gia, giaGoc, xoaTruong);
  // Vòng sửa 1 (b) — đơn mode: khoá Lưu trong SUỐT lúc `getById` đang tải/tải lại (không riêng
  // lần đầu) — `isFetching` là tập CHA của `isLoading`, bắt cả trường hợp revisit-cache-nhưng-
  // đang-refetch-nền. Hàng loạt không phụ thuộc `getById` ⇒ luôn `false`.
  const dangTaiChiTietDon = donMode && chiTietQuery.isFetching;
  // `soTruong` (trên) đã CỘNG gộp cả phần Xoá qua `soTruongThayDoi(gia, giaGoc, xoaTruong)`, nên
  // `soTruongDaNhap` ở đây đã đủ để coTheLuu biết "có ít nhất một thay đổi" — không cần truyền lại
  // `soTruongXoa` riêng (tham số đó tồn tại cho lời gọi CŨ không đi qua `soTruongThayDoi`).
  const duocLuu = coTheLuu({ soHang: rows.length, loiForm, soTruongDaNhap: soTruong, dangTaiChiTietDon });

  const luuMutation = trpc.measurementPoint.setLimitsBatch.useMutation({
    onSuccess: (res) => {
      // Task 9 (`cayDay.listComponents`/`thongKeGioiHan`) là NGUỒN — đọc lại từ server, không tự
      // đếm/sửa state cục bộ ở đây (hai nguồn sự thật là đúng lớp lỗi dự án đã tốn nhiều lượt dọn).
      const ke = keHoachLamMoiSauLuu({ captureRowId, productModelId, machineId });
      void utils.cayDay.listComponents.invalidate(ke.listComponents);
      void utils.cayDay.thongKeGioiHan.invalidate(ke.thongKeGioiHan);
      const kq = ketQuaThanhCong(res);
      const tb = thongBaoThanhCong(kq.soDiem);
      toast.success(t(tb.khoa, tb.macDinh, tb.params));
      onOpenChange(false);
    },
    onError: (err) => {
      const bl = docLoiCanDuyetNguong(err);
      if (bl) {
        // Bị CHẶN bởi cửa duyệt ngưỡng — KHÔNG có gì được ghi/gửi. Giữ dialog MỞ (giá trị người
        // dùng vừa nhập không mất) để họ thấy lý do, KHÔNG invalidate (không gì đổi ở server).
        setCanDuyet(bl);
        const tb = thongBaoCanDuyet(bl);
        toast.error(t(tb.khoa, tb.macDinh));
        return;
      }
      toastTrpcError(err);
    },
  });

  const handleLuu = () => {
    if (rows.length === 0) return;
    // Vòng sửa 1 (b) — kiểm lại TRỰC TIẾP ở đây (không chỉ dựa vào `disabled` trên nút): nút bị
    // khoá khi đang tải, nhưng đây là lưới an toàn thứ hai bằng ĐÚNG hàm `coTheLuu` (một nguồn
    // quyết định, không lặp điều kiện hai nơi).
    if (dangTaiChiTietDon) {
      toast.error(t("teachLimits.errDangTaiChiTiet", "Đang tải dữ liệu điểm — đợi tải xong rồi lưu"));
      return;
    }
    if (loiForm.length > 0) {
      toast.error(t("teachLimits.errFormKhongHopLe", "Sửa các trường đang báo lỗi trước khi lưu"));
      return;
    }
    if (soTruong === 0) {
      // M-5 (vòng sửa 9) — đơn + đã có baseline (đã tiền điền) ⇒ "0 trường thay đổi" nghĩa là
      // KHÁC với "chưa nhập gì" (form CÓ giá trị, chỉ là giống hệt lúc tải) — nói đúng để người
      // dùng không thắc mắc "tôi nhập rồi mà sao báo chưa nhập".
      const thongBaoKhongDu =
        donMode && giaGoc !== null
          ? t("teachLimits.errKhongDoiGi", "Chưa có trường nào thay đổi so với giá trị đã lưu")
          : t("teachLimits.errChuaNhapGi", "Chưa nhập trường nào để lưu");
      toast.error(thongBaoKhongDu);
      return;
    }
    if (!duocLuu) return; // phòng thủ cuối — không nên tới đây nếu ba nhánh trên đã bắt hết
    setCanDuyet(null);
    const input = xayInputSetLimitsBatch(
      rows.map((r) => r.id),
      gia,
      lyDoDoi,
      giaGoc,
      xoaTruong,
    );
    luuMutation.mutate(input);
  };

  /** Lô 2 nhóm B — bật/tắt đánh dấu Xoá cho một trường. Bật Xoá thì xoá luôn nội dung đang gõ
   * trong ô đó ở state cục bộ (đồng bộ HÌNH ẢNH ô input với ý định — hàm thuần `layTruongThayDoi`
   * đã tự AN TOÀN dù ô còn chữ, xem test "xoá THẮNG nội dung gõ", nhưng để ô còn hiện số cũ trong
   * lúc đã bấm Xoá là gây hiểu lầm cho người dùng). */
  const toggleXoaTruong = (truong: TenTruongForm) => {
    setXoaTruong((prev) => {
      const next = new Set(prev);
      if (next.has(truong)) next.delete(truong);
      else next.add(truong);
      return next;
    });
    setGia((prev) => ({ ...prev, [truong]: "" }));
  };

  const diemCanvas =
    donMode && chiTietQuery.data
      ? diemCayDayChoCanvas(chiTietQuery.data as { componentExtId: string | null; code?: string | null; roiX: number | null; roiY: number | null; roiWidth: number | null; roiHeight: number | null })
      : null;
  const anhThamChieu = donMode
    ? ((chiTietQuery.data as { referenceImageUrl?: string | null } | undefined)?.referenceImageUrl ?? null)
    : null;

  const dangLuu = luuMutation.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (dangLuu) return; // đang gửi — không cho đóng nửa chừng
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {donMode
              ? t("teachLimits.tieuDeDon", "Dạy giới hạn — {{ten}}", {
                  ten: diemDau?.componentExtId ?? diemDau?.name ?? "",
                })
              : t("teachLimits.tieuDeHangLoat", "Dạy giới hạn hàng loạt ({{n}} linh kiện)", { n: rows.length })}
          </DialogTitle>
          <DialogDescription>
            {donMode
              ? t(
                  "teachLimits.moTaDon",
                  "Nhập giới hạn cho linh kiện này. Hình học (vị trí/ROI) do máy dạy — không sửa ở đây.",
                )
              : t(
                  "teachLimits.moTaHangLoat",
                  "Giá trị bạn nhập sẽ áp dụng cho TẤT CẢ {{n}} linh kiện đã chọn — bỏ trống trường nào thì trường đó GIỮ NGUYÊN theo từng linh kiện.",
                  { n: rows.length },
                )}
          </DialogDescription>
        </DialogHeader>

        {!donMode && (
          <div className="space-y-1.5">
            <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto rounded-md border bg-muted/30 p-2">
              {rows.map((r) => (
                <Badge key={r.id} variant="outline">
                  {r.componentExtId ?? r.name}
                </Badge>
              ))}
            </div>
            {/* Vòng sửa 1 (Minor #2) — giải thích vì sao canvas không hiện ở hàng loạt (R-KC-1 cho
                phép "highlight nhiều điểm HOẶC ẩn"; chọn ẩn vì mỗi component có ảnh tham chiếu riêng). */}
            <p className="text-xs text-muted-foreground">
              {t(
                "teachLimits.hangLoatAnCanvas",
                "Chọn nhiều điểm — mỗi điểm có ảnh tham chiếu riêng, canvas chỉ hiện khi sửa đơn.",
              )}
            </p>
          </div>
        )}

        {donMode && (
          <div className="overflow-hidden rounded-lg border bg-muted/20">
            {chiTietQuery.isLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : anhThamChieu && diemCanvas ? (
              <MeasurementPointCanvas
                imageUrl={anhThamChieu}
                points={[diemCanvas]}
                selectedIndex={0}
                onSelectIndex={() => {}}
                onChangePoints={() => {}}
                isEditMode={false}
                isDrawing={false}
                drawTool="rect"
                pointRadius={diemCanvas.radius}
                zoomLevel={100}
                className="max-h-80"
              />
            ) : (
              <p className="p-6 text-center text-sm text-muted-foreground">
                {t("teachLimits.khongCoAnh", "Máy chưa gửi ảnh/toạ độ ROI tham chiếu cho linh kiện này.")}
              </p>
            )}
          </div>
        )}

        {canDuyet && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{t("teachLimits.canDuyetTieuDe", "Chưa lưu")}</AlertTitle>
            <AlertDescription>
              {t(thongBaoCanDuyet(canDuyet).khoa, thongBaoCanDuyet(canDuyet).macDinh)}
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {TEN_TRUONG_FORM.map((truong: TenTruongForm) => {
            const loi = loiForm.find((l) => l.truong === truong);
            const khoaNhan = NHAN_TRUONG.get(truong) ?? truong;
            const daXoa = xoaTruong.has(truong);
            // Đơn: nút X chỉ hiện khi trường ĐANG CÓ giá trị đã tải (giaGoc) — xoá một trường vốn
            // đã trống không có ý nghĩa gì (không có gì để xoá). Hàng loạt: giaGoc luôn null (N
            // component có thể khác nhau, xem docblock effect ở trên) — hiện checkbox "Xoá trên
            // các điểm đã chọn" cho CẢ 5 trường luôn, vì không có "giá trị hiện tại chung" để so.
            const coTheXoaDon = donMode && giaGoc !== null && giaGoc[truong].trim() !== "";
            return (
              <div key={truong} className="space-y-1.5">
                <div className="flex items-center justify-between gap-1">
                  <Label htmlFor={`cld-${truong}`}>{t(khoaNhan)}</Label>
                  {donMode && coTheXoaDon && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 text-muted-foreground hover:text-destructive"
                      aria-label={t("teachLimits.xoaTruong", "Xoá giới hạn {{ten}}", { ten: t(khoaNhan) })}
                      title={t("teachLimits.xoaTruong", "Xoá giới hạn {{ten}}", { ten: t(khoaNhan) })}
                      aria-pressed={daXoa}
                      onClick={() => toggleXoaTruong(truong)}
                      disabled={dangLuu}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                <Input
                  id={`cld-${truong}`}
                  value={gia[truong]}
                  onChange={(e) => setGia((prev) => ({ ...prev, [truong]: e.target.value }))}
                  inputMode={truong === "unit" ? "text" : "decimal"}
                  aria-invalid={loi ? true : undefined}
                  className={loi ? "border-destructive" : undefined}
                  disabled={dangLuu || daXoa}
                  placeholder={daXoa ? t("teachLimits.seXoa", "Sẽ bị xoá") : undefined}
                />
                {loi && <p className="text-xs text-destructive">{t(loi.khoa, loi.macDinh)}</p>}
                {!donMode && (
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Checkbox
                      checked={daXoa}
                      onCheckedChange={() => toggleXoaTruong(truong)}
                      disabled={dangLuu}
                      aria-label={t(
                        "teachLimits.xoaTruongHangLoat",
                        "Xoá trường này trên các điểm đã chọn",
                      )}
                    />
                    {t("teachLimits.xoaTruongHangLoat", "Xoá trường này trên các điểm đã chọn")}
                  </label>
                )}
              </div>
            );
          })}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="cld-ly-do">{t("teachLimits.lyDoDoi", "Lý do đổi (không bắt buộc)")}</Label>
          <Textarea
            id="cld-ly-do"
            value={lyDoDoi}
            onChange={(e) => setLyDoDoi(e.target.value)}
            maxLength={500}
            rows={2}
            disabled={dangLuu}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={dangLuu}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleLuu} disabled={dangLuu || !duocLuu}>
            {dangLuu && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {donMode
              ? t("common.save")
              : t("teachLimits.luuHangLoat", "Lưu cho {{n}} linh kiện", { n: rows.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
