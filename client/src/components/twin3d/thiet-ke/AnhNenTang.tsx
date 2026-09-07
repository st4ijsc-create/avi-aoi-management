/**
 * AnhNenTang.tsx — ẢNH NỀN CAD + CÔNG CỤ ĐẶT TỈ LỆ cho một tầng (#43, §7.4).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐÂY LÀ NỬA CÒN THIẾU CỦA #43 — SERVER ĐÃ XONG TỪ ĐỢT 3
 * ════════════════════════════════════════════════════════════════════════════
 * §11c.2 xếp #43 vào lớp lỗi **L-4**: `twinCanhRouter.taiAnhNen` có thật,
 * `twin_tang.anhNenUrl`/`anhNenKey`/`tiLeMmMoiPx`/`daHieuChuan` có thật, khoá
 * i18n `twin3d.tang.anhNen`/`datTiLe`/`daHieuChuan`/`chuaHieuChuan` đã viết đủ
 * ba thứ tiếng — và `grep taiAnhNen client/src` chỉ trúng chính các khoá i18n
 * đó. Làm từ trên xuống rồi **dừng ngay trước component**.
 *
 * §11c.2 rút ra một chỉ báo QA rất rẻ từ đây: *"khoá i18n tồn tại cho một tính
 * năng không có UI là chỉ báo sớm rất tốt"*. Tệp này đóng đúng khe đó.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ TẢI ẢNH VÀ HIỆU CHUẨN LÀ HAI VIỆC, VÀ PHẢI TÁCH RỜI
 * ════════════════════════════════════════════════════════════════════════════
 * Docblock của `taiAnhNen` nói thẳng: *"`daHieuChuan` KHÔNG được đặt true ở
 * đây. Tải ảnh lên chỉ cho ta pixel."* Giao diện phải phản ánh đúng điều đó,
 * nếu không nó biến một phép đo có xuất xứ thành một con số ai cũng tin.
 *
 * Nên khối này có HAI bước rời nhau và người dùng thấy cả hai:
 *   Bước 1 — chọn tệp → tải lên → huy hiệu "Chưa hiệu chuẩn" (vàng).
 *   Bước 2 — click hai điểm trên ảnh + gõ khoảng cách thật → huy hiệu
 *            "Đã hiệu chuẩn" (xanh) kèm số mm/px.
 *
 * ★ Bước 2 gọi LẠI `taiAnhNen` với chính ảnh vừa tải? KHÔNG. Nó gọi với
 *   `anhBase64` của ảnh đó lần nữa sẽ tạo một tệp thứ hai trên đĩa cho cùng một
 *   bức ảnh. Xem `luuTiLe` — ta gửi lại đúng payload đã có trong bộ nhớ, và ghi
 *   chú vì sao đó là đánh đổi có ý thức chứ không phải sơ suất.
 *
 * ★★★ BẪY HOÁN VỊ TRỤC — KHÔNG ÁP DỤNG Ở TỆP NÀY, và nói ra để không ai lo:
 *   mọi số ở đây là toạ độ ẢNH (px) và milimét MẶT BẰNG. Không có chiều cao,
 *   không có `scene.z`. Chỗ dùng `tiLeMmMoiPx` để đặt ảnh xuống sàn 3D mới phải
 *   nhớ `yMm` của DB → `scene.z` (xem `heToaDo.ts`), và chỗ đó KHÔNG ở đây.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, ImageUp, Loader2, Ruler, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { toastTrpcError } from "@/lib/trpcErrors";
import { trpc } from "@/lib/trpc";

import {
  doiChieuVoiSan,
  kichThuocAnhMm,
  laAnhNenHopLe,
  tinhTiLe,
  type DiemPx,
} from "./tiLeAnhNen";

/** Bề rộng khung xem trước (px màn hình). Ảnh co vừa khung, tỉ lệ giữ nguyên. */
const KHUNG_PX = 460;

export interface AnhNenTangProps {
  tangId: number;
  /** Bề rộng sàn đã khai (mm) — để đối chiếu với ảnh sau khi hiệu chuẩn. */
  sanRongMm: number;
  /** Trạng thái hiện tại của tầng, từ `chiTietToaNha`. */
  anhNenUrl?: string | null;
  tiLeMmMoiPx?: number | null;
  daHieuChuan?: boolean;
  /** Gọi sau khi ghi xong để màn tải lại `chiTietToaNha`. */
  onDaGhi?: () => void;
}

export function AnhNenTang({
  tangId,
  sanRongMm,
  anhNenUrl,
  tiLeMmMoiPx,
  daHieuChuan = false,
  onDaGhi,
}: AnhNenTangProps) {
  const { t } = useTranslation();
  const oTep = useRef<HTMLInputElement | null>(null);
  const anhRef = useRef<HTMLImageElement | null>(null);

  /** base64 của ảnh đang thao tác — giữ để bước hiệu chuẩn ghi lại được. */
  const [base64, setBase64] = useState<string | null>(null);
  const [urlXem, setUrlXem] = useState<string | null>(null);
  /** Kích thước THẬT của ảnh (px), không phải kích thước hiển thị. */
  const [coAnh, setCoAnh] = useState<{ rong: number; cao: number } | null>(null);
  const [diem, setDiem] = useState<DiemPx[]>([]);
  const [khoangCachThat, setKhoangCachThat] = useState("");
  const [dangDo, setDangDo] = useState(false);

  const taiM = trpc.twinCanh.taiAnhNen.useMutation();

  const anhHienTai = urlXem ?? anhNenUrl ?? null;

  /** Chọn tệp: đọc base64 + đo kích thước thật, CHƯA gửi lên server. */
  const chonTep = useCallback(
    (tep: File) => {
      if (!laAnhNenHopLe(tep.name)) {
        toast.error(t("twin3d.anhNen.duoiKhongNhan"));
        return;
      }
      setDangDo(true);
      const r = new FileReader();
      r.onerror = () => {
        setDangDo(false);
        toast.error(t("twin3d.anhNen.docHong"));
      };
      r.onload = () => {
        const dataUrl = String(r.result ?? "");
        const img = new Image();
        img.onload = () => {
          setBase64(dataUrl);
          setUrlXem(dataUrl);
          setCoAnh({ rong: img.naturalWidth, cao: img.naturalHeight });
          setDiem([]);
          setDangDo(false);
        };
        img.onerror = () => {
          setDangDo(false);
          toast.error(t("twin3d.anhNen.docHong"));
        };
        img.src = dataUrl;
      };
      r.readAsDataURL(tep);
    },
    [t],
  );

  /** Bước 1 — tải lên, KHÔNG gắn cờ hiệu chuẩn (xem docblock đầu tệp). */
  const taiLen = useCallback(async () => {
    if (!base64) return;
    try {
      await taiM.mutateAsync({ tangId, anhBase64: base64 });
      toast.success(t("twin3d.anhNen.daTai"));
      onDaGhi?.();
    } catch (e) {
      toastTrpcError(e);
    }
  }, [base64, taiM, tangId, t, onDaGhi]);

  /**
   * Click lên ảnh để đặt điểm hiệu chuẩn.
   *
   * ★★★ QUY TỌA ĐỘ VỀ PIXEL ẢNH GỐC, KHÔNG DÙNG PIXEL MÀN HÌNH.
   *   Ảnh được co vừa khung 460 px; một ảnh 3200 px hiển thị ở 460 px có hệ số
   *   ~6,96. Lấy toạ độ chuột thô làm px ảnh cho ra tỉ lệ sai đúng bằng hệ số
   *   đó — nhà xưởng nhỏ đi 7 lần, và không gì nổ. `naturalWidth / clientWidth`
   *   là hệ số duy nhất đúng, và nó phải đọc TẠI LÚC CLICK (khung co giãn được).
   */
  const datDiem = useCallback((e: React.MouseEvent<HTMLImageElement>) => {
    const img = anhRef.current;
    if (!img || img.clientWidth === 0) return;
    const hop = img.getBoundingClientRect();
    const heSo = img.naturalWidth / img.clientWidth;
    const p: DiemPx = {
      x: (e.clientX - hop.left) * heSo,
      y: (e.clientY - hop.top) * heSo,
    };
    setDiem((cu) => (cu.length >= 2 ? [p] : [...cu, p]));
  }, []);

  const ketTiLe = useMemo(
    () => tinhTiLe(diem[0] ?? null, diem[1] ?? null, Number(khoangCachThat)),
    [diem, khoangCachThat],
  );

  /** Đối chiếu bề rộng ảnh (đã quy mm) với bề rộng sàn đã khai. */
  const doiChieu = useMemo(() => {
    if (!ketTiLe.ok || !coAnh) return null;
    const kt = kichThuocAnhMm(coAnh.rong, coAnh.cao, ketTiLe.ketQua.mmMoiPx);
    if (!kt) return null;
    return doiChieuVoiSan(kt.rongMm, sanRongMm);
  }, [ketTiLe, coAnh, sanRongMm]);

  /**
   * Bước 2 — ghi tỉ lệ + `daHieuChuan = true`.
   *
   * ⚠ ĐÁNH ĐỔI KHAI RÕ: thủ tục `taiAnhNen` nhận `anhBase64` là trường BẮT BUỘC,
   *   nên bước này gửi lại đúng ảnh đã tải và server lưu một tệp thứ hai (khoá
   *   có `Date.now()` nên không đè). Một hàng `twin_tang` chỉ trỏ tới tệp mới
   *   nhất, tệp cũ thành mồ côi trên đĩa.
   *
   *   KHÔNG sửa lược đồ đầu vào ở lô này (brief cấm đổi hợp đồng ngoài phạm vi,
   *   và `taiAnhNen` là thủ tục có sẵn đang chạy). Cách sửa đúng cho đợt sau là
   *   một thủ tục `datTiLeTang` chỉ nhận `{tangId, tiLeMmMoiPx}` — nó cũng là
   *   thứ mà công cụ "Đặt tỉ lệ" LẼ RA phải gọi. Ghi lại ở đây thay vì để lời
   *   khai "#43 xong" che mất một tệp mồ côi mỗi lần hiệu chuẩn.
   */
  const luuTiLe = useCallback(async () => {
    if (!ketTiLe.ok || !base64) return;
    try {
      await taiM.mutateAsync({
        tangId,
        anhBase64: base64,
        tiLeMmMoiPx: ketTiLe.ketQua.mmMoiPx,
        daHieuChuan: true,
      });
      toast.success(t("twin3d.anhNen.daHieuChuanXong"));
      onDaGhi?.();
    } catch (e) {
      toastTrpcError(e);
    }
  }, [ketTiLe, base64, taiM, tangId, t, onDaGhi]);

  return (
    <div className="border-t p-2" data-testid="khoi-anh-nen">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <p className="text-[11px] font-medium text-muted-foreground">
          {t("twin3d.tang.anhNen")}
        </p>
        {/* ★★★ NT-3/NT-4 — huy hiệu nói XUẤT XỨ của con số, không chỉ có/không.
            Một tỉ lệ chưa hiệu chuẩn mà UI vẽ như đã hiệu chuẩn là đúng lớp lỗi
            mà `taiAnhNen` dựng cả một docblock để chống. */}
        {anhNenUrl ? (
          daHieuChuan ? (
            <Badge variant="outline" className="gap-1 text-[10px]" data-testid="huy-hieu-da-hieu-chuan">
              <CheckCircle2 className="h-3 w-3 text-success" />
              {t("twin3d.tang.daHieuChuan")}
              {tiLeMmMoiPx ? ` · ${Number(tiLeMmMoiPx).toFixed(2)} mm/px` : ""}
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1 text-[10px]" data-testid="huy-hieu-chua-hieu-chuan">
              <AlertTriangle className="h-3 w-3 text-warning" />
              {t("twin3d.tang.chuaHieuChuan")}
            </Badge>
          )
        ) : null}
      </div>

      <input
        ref={oTep}
        type="file"
        accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
        className="hidden"
        data-testid="o-chon-anh-nen"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) chonTep(f);
        }}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 text-[11px]"
          data-testid="nut-chon-anh-nen"
          disabled={dangDo}
          onClick={() => oTep.current?.click()}
        >
          {dangDo ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ImageUp className="h-3.5 w-3.5" />
          )}
          {t("twin3d.tang.anhNen")}
        </Button>
        {base64 ? (
          <Button
            size="sm"
            className="h-7 text-[11px]"
            data-testid="nut-tai-anh-nen"
            disabled={taiM.isPending}
            onClick={() => void taiLen()}
          >
            {t("twin3d.anhNen.taiLen")}
          </Button>
        ) : null}
      </div>

      {anhHienTai ? (
        <div className="mt-1.5">
          <p className="mb-1 flex items-center gap-1 text-[10px] text-muted-foreground">
            <Ruler className="h-3 w-3" />
            {t("twin3d.anhNen.huongDan")}
          </p>
          <div className="relative inline-block" style={{ maxWidth: KHUNG_PX }}>
            {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
            <img
              ref={anhRef}
              src={anhHienTai}
              alt={t("twin3d.tang.anhNen")}
              className="max-w-full cursor-crosshair rounded border"
              data-testid="anh-nen-xem-truoc"
              onClick={datDiem}
              onLoad={(e) => {
                const el = e.currentTarget;
                if (!coAnh) setCoAnh({ rong: el.naturalWidth, cao: el.naturalHeight });
              }}
            />
            {/* Chấm hai điểm hiệu chuẩn — vẽ ở toạ độ MÀN HÌNH, quy ngược từ px ảnh. */}
            {coAnh
              ? diem.map((p, i) => (
                  <span
                    key={i}
                    data-testid={`diem-hieu-chuan-${i}`}
                    className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-2 ring-background"
                    style={{
                      left: `${(p.x / coAnh.rong) * 100}%`,
                      top: `${(p.y / coAnh.cao) * 100}%`,
                    }}
                  />
                ))
              : null}
          </div>

          <div className="mt-1.5 flex flex-wrap items-end gap-2">
            <div className="grid gap-1">
              <Label className="text-[10px]">{t("twin3d.anhNen.khoangCachThat")}</Label>
              <Input
                className="h-7 w-32 text-xs"
                type="number"
                min={1}
                value={khoangCachThat}
                onChange={(e) => setKhoangCachThat(e.target.value)}
                placeholder="12000"
                data-testid="o-khoang-cach-that"
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              data-testid="nut-dat-ti-le"
              disabled={!ketTiLe.ok || taiM.isPending || !base64}
              onClick={() => void luuTiLe()}
            >
              {t("twin3d.tang.datTiLe")}
            </Button>
            {diem.length > 0 ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-[11px]"
                data-testid="nut-xoa-diem"
                onClick={() => setDiem([])}
              >
                {t("twin3d.anhNen.xoaDiem")}
              </Button>
            ) : null}
          </div>

          {/* Kết quả / lý do — CON SỐ, không phải "được/không được". */}
          {ketTiLe.ok ? (
            <p className="mt-1 text-[10px] text-muted-foreground" data-testid="ket-qua-ti-le">
              {ketTiLe.ketQua.khoangCachPx.toFixed(0)} px ·{" "}
              {ketTiLe.ketQua.mmMoiPx.toFixed(2)} mm/px
            </p>
          ) : diem.length === 2 || khoangCachThat !== "" ? (
            <p className="mt-1 text-[10px] text-warning" data-testid="ly-do-ti-le">
              {t(`twin3d.anhNen.loi.${ketTiLe.loi}`)}
            </p>
          ) : null}

          {/* ★ Đối chiếu với sàn đã khai — phải hỏi TRƯỚC khi đặt máy lên ảnh. */}
          {doiChieu?.vuotNguong ? (
            <p className="mt-0.5 text-[10px] text-warning" data-testid="canh-bao-lech-san">
              {t("twin3d.anhNen.lechSan", {
                anh: (doiChieu.rongAnhMm / 1000).toFixed(1),
                san: (doiChieu.rongSanMm / 1000).toFixed(1),
              })}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default AnhNenTang;
