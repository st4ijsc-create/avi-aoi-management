/**
 * VeVung.tsx — CRUD VÙNG AN TOÀN (§11.7 #42, §7.3 "Vẽ vùng an toàn").
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐÂY LÀ ĐƯỜNG THAY THẾ ĐẦU TIÊN CHO `FactoryFloorEditor` — VÀ MÀN CŨ
 *     KHÔNG BỊ ĐỤNG TỚI
 * ════════════════════════════════════════════════════════════════════════════
 * §11c.3 đo được: spec ghi đích của #42 là `VeVungPolygon.tsx`, **tệp đó không
 * tồn tại**, và `FactoryFloorEditor.tsx:444` vẫn là **nơi DUY NHẤT** CRUD vùng
 * an toàn trong hệ. §11c.7 nói rõ: xoá `FactoryFloorEditor` hôm nay là **mất
 * tính năng thật**, không phải dọn dẹp — cổng ra §11 mới mở 18/62.
 *
 * ⇒ Tệp này DỰNG đường mới. Nó KHÔNG xoá, không sửa, không vô hiệu hoá màn cũ.
 *   Hai đường chạy song song cho tới khi chủ sở hữu quyết định.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VẼ TRÊN MẶT BẰNG 2D, KHÔNG RAYCAST TRONG 3D
 * ════════════════════════════════════════════════════════════════════════════
 * Vẽ polygon bằng cách click vào cảnh 3D đòi raycast xuống mặt sàn, và mọi cú
 * click trúng một MÁY sẽ đặt đỉnh lên nóc máy thay vì lên sàn — sai lệch bằng
 * đúng chiều cao máy, và **không có gì nổ**. Ba cách chữa đều đắt: bỏ qua máy
 * khi raycast (mất khả năng vẽ vùng bao quanh máy), thêm một mặt phẳng vô hình
 * (thêm draw call + chặn click chọn máy), hay chiếu lại xuống y=0 (đúng nhưng
 * người dùng không thấy con trỏ ở đâu).
 *
 * Bản vẽ mặt bằng SVG rẻ hơn và **chính xác hơn**: mọi click đều ở đúng cao độ
 * sàn theo định nghĩa, người dùng thấy toàn cảnh bố cục khi vẽ, và không đụng
 * gì tới RB-4 (0 canvas WebGL thêm). Kết quả hiện NGAY trong cảnh 3D qua
 * `LopVung`.
 *
 * ★ Toàn bộ hình học ở `vungAnToan.ts` (49 test). Tệp này chỉ nối nó với chuột.
 * ★ CHẶN-2 — component này CHỈ được dựng khi `coQuyenSua`; nó là đường GHI.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Pencil, Plus, Trash2, Undo2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toastTrpcError } from "@/lib/trpcErrors";
import { trpc } from "@/lib/trpc";

import { mmSangMet } from "../heToaDo";
import {
  MAU_VUNG_MAC_DINH,
  SO_DINH_TOI_DA,
  SO_DINH_TOI_THIEU,
  dienTichM2,
  docDiemDa,
  dungVungGhi,
  polygonHopLe,
  type DinhMm,
  type HangVung,
} from "./vungAnToan";

/** Cạnh bản vẽ mặt bằng (px). */
const CANH_VE_PX = 460;
const DEM_VE_PX = 10;

/** Bảng màu vùng — ISA-101 §10.1: vùng an toàn dùng màu cảnh báo, không màu trạng thái máy. */
const MAU_CHON = ["#f59e0b", "#ef4444", "#22c55e", "#3b82f6", "#a855f7"] as const;

export interface VeVungProps {
  tangId: number;
  /** Kích thước sàn (mm) — khung của bản vẽ mặt bằng. */
  sanRongMm: number;
  sanSauMm: number;
  /** Vùng hiện có, ĐÚNG hình dạng server trả về. */
  vung: readonly HangVung[];
  /** Máy đang vẽ — nền tham chiếu để người dùng biết vẽ vùng quanh cái gì. */
  mayNen: readonly { khoa: string; xMm: number; yMm: number; rongMm: number; sauMm: number }[];
  /** Vùng đang chọn trong cảnh 3D — đồng bộ hai chiều. */
  vungChon: string | null;
  onChonVung: (khoa: string | null) => void;
  /** Gọi sau khi ghi/xoá thành công để người gọi `invalidate` truy vấn cảnh. */
  onDaGhi: () => void | Promise<void>;
}

export function VeVung({
  tangId,
  sanRongMm,
  sanSauMm,
  vung,
  mayNen,
  vungChon,
  onChonVung,
  onDaGhi,
}: VeVungProps) {
  const { t } = useTranslation();
  const refSvg = useRef<SVGSVGElement | null>(null);

  const [dangVe, setDangVe] = useState(false);
  const [dinh, setDinh] = useState<DinhMm[]>([]);
  const [moLuu, setMoLuu] = useState(false);
  const [ten, setTen] = useState("");
  const [mau, setMau] = useState<string>(MAU_VUNG_MAC_DINH);
  /** id đang SỬA; `null` = đang TẠO mới. */
  const [suaId, setSuaId] = useState<number | null>(null);

  const luuM = trpc.twinCanh.luuVungAnToan.useMutation();
  const xoaM = trpc.twinCanh.xoaVungAnToan.useMutation();

  /* ── Phép chiếu mm ↔ px của bản vẽ mặt bằng ────────────────────────────
     ★ MỘT tỉ lệ cho cả hai trục (`min`) — cùng lý do như mini-map: hai tỉ lệ
       riêng làm bản vẽ lấp đầy khung nhưng bóp méo hình dạng xưởng, và người
       dùng vẽ một vùng "vuông" ra một hình chữ nhật.                       */
  const tiLe = useMemo(() => {
    const trong = CANH_VE_PX - DEM_VE_PX * 2;
    return Math.min(trong / Math.max(sanRongMm, 1), trong / Math.max(sanSauMm, 1));
  }, [sanRongMm, sanSauMm]);

  const mmSangPx = useCallback(
    (xMm: number, yMm: number) => ({ px: DEM_VE_PX + xMm * tiLe, py: DEM_VE_PX + yMm * tiLe }),
    [tiLe],
  );

  /**
   * px → mm. `getBoundingClientRect` chứ KHÔNG `offsetX`: click trúng một
   * `<polygon>` con cho `offset*` trong hệ của phần tử đó — cùng cạm bẫy đã ghi
   * ở `banDoNho.pxTuChuot`.
   */
  const chuotSangMm = useCallback(
    (e: React.MouseEvent): DinhMm | null => {
      const svg = refSvg.current;
      if (!svg || tiLe <= 0) return null;
      const r = svg.getBoundingClientRect();
      const heSoX = r.width > 0 ? CANH_VE_PX / r.width : 1;
      const heSoY = r.height > 0 ? CANH_VE_PX / r.height : 1;
      const px = (e.clientX - r.left) * heSoX;
      const py = (e.clientY - r.top) * heSoY;
      return { xMm: (px - DEM_VE_PX) / tiLe, yMm: (py - DEM_VE_PX) / tiLe };
    },
    [tiLe],
  );

  const themDinh = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!dangVe) return;
      const d = chuotSangMm(e);
      if (!d) return;
      setDinh((cu) => {
        if (cu.length >= SO_DINH_TOI_DA) {
          toast.error(t("twin3d.vung.quaNhieuDinh", { n: SO_DINH_TOI_DA }));
          return cu;
        }
        // Kẹp trong mặt sàn: một đỉnh ngoài tường là một vùng an toàn nằm ngoài
        // nhà xưởng, và không ai muốn lưu thứ đó.
        return [
          ...cu,
          {
            xMm: Math.min(Math.max(d.xMm, 0), sanRongMm),
            yMm: Math.min(Math.max(d.yMm, 0), sanSauMm),
          },
        ];
      });
    },
    [dangVe, chuotSangMm, sanRongMm, sanSauMm, t],
  );

  const boDinhCuoi = useCallback(() => setDinh((cu) => cu.slice(0, -1)), []);

  const huyVe = useCallback(() => {
    setDangVe(false);
    setDinh([]);
    setSuaId(null);
    setTen("");
    setMau(MAU_VUNG_MAC_DINH);
  }, []);

  /** Mở hộp thoại đặt tên. Cổng `polygonHopLe` chặn Ở ĐÂY, không đợi 400 từ server. */
  const moLuuVung = useCallback(() => {
    if (!polygonHopLe(dinh)) {
      toast.error(t("twin3d.vung.polygonKhongHopLe", { n: SO_DINH_TOI_THIEU }));
      return;
    }
    setMoLuu(true);
  }, [dinh, t]);

  const luu = useCallback(async () => {
    const payload = dungVungGhi(tangId, ten, dinh, {
      ...(suaId != null ? { id: suaId } : {}),
      mau,
    });
    if (!payload) {
      toast.error(t("twin3d.vung.polygonKhongHopLe", { n: SO_DINH_TOI_THIEU }));
      return;
    }
    try {
      await luuM.mutateAsync(payload);
      setMoLuu(false);
      huyVe();
      await onDaGhi();
      toast.success(t("twin3d.vung.daLuu"));
    } catch (e) {
      toastTrpcError(e);
    }
  }, [tangId, ten, dinh, suaId, mau, luuM, huyVe, onDaGhi, t]);

  const xoa = useCallback(
    async (id: number) => {
      try {
        await xoaM.mutateAsync({ id });
        if (vungChon === `vung:${id}`) onChonVung(null);
        await onDaGhi();
        toast.success(t("twin3d.vung.daXoa"));
      } catch (e) {
        toastTrpcError(e);
      }
    },
    [xoaM, vungChon, onChonVung, onDaGhi, t],
  );

  /** Nạp một vùng có sẵn vào chế độ vẽ để SỬA đỉnh. */
  const batDauSua = useCallback((h: HangVung) => {
    setSuaId(h.id);
    setDinh(docDiemDa(h.diemDa));
    setTen(h.ten);
    setMau(h.mau ?? MAU_VUNG_MAC_DINH);
    setDangVe(true);
  }, []);

  const dtDangVe = dinh.length >= SO_DINH_TOI_THIEU ? dienTichM2(dinh) : 0;

  /* ═════════════════════════════════════════════════════════════════════ */
  return (
    <div className="flex flex-col gap-2" data-testid="ve-vung">
      {/* ── Thanh lệnh ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5">
        {dangVe ? (
          <>
            <Badge variant="outline" className="text-[11px]" data-testid="ve-vung-dem-dinh">
              {t("twin3d.vung.demDinh", { n: dinh.length })}
              {dtDangVe > 0 ? ` · ${dtDangVe.toFixed(1)} m²` : ""}
            </Badge>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 px-2 text-[11px]"
              disabled={dinh.length === 0}
              data-testid="ve-vung-bo-dinh"
              onClick={boDinhCuoi}
            >
              <Undo2 className="h-3.5 w-3.5" />
              {t("twin3d.vung.boDinhCuoi")}
            </Button>
            <Button
              size="sm"
              className="h-7 gap-1 px-2 text-[11px]"
              disabled={!polygonHopLe(dinh)}
              data-testid="ve-vung-xong"
              onClick={moLuuVung}
            >
              <Check className="h-3.5 w-3.5" />
              {t("twin3d.vung.xong")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 px-2 text-[11px]"
              data-testid="ve-vung-huy"
              onClick={huyVe}
            >
              <X className="h-3.5 w-3.5" />
              {t("twin3d.vung.huy")}
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 px-2 text-[11px]"
            data-testid="ve-vung-bat-dau"
            onClick={() => {
              setSuaId(null);
              setDinh([]);
              setTen("");
              setMau(MAU_VUNG_MAC_DINH);
              setDangVe(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            {t("twin3d.vung.veMoi")}
          </Button>
        )}
      </div>

      {/* ── Bản vẽ mặt bằng ────────────────────────────────────────── */}
      <svg
        ref={refSvg}
        width="100%"
        viewBox={`0 0 ${CANH_VE_PX} ${CANH_VE_PX}`}
        className={`rounded border bg-muted/30 ${dangVe ? "cursor-crosshair" : "cursor-default"}`}
        role="application"
        aria-label={t("twin3d.vung.banVe")}
        data-testid="ve-vung-svg"
        onClick={themDinh}
      >
        {/* Khung sàn */}
        <rect
          x={DEM_VE_PX}
          y={DEM_VE_PX}
          width={sanRongMm * tiLe}
          height={sanSauMm * tiLe}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.3}
        />

        {/* Máy — NỀN THAM CHIẾU. Không có nó, người dùng vẽ vùng an toàn mà
            không biết mình đang bao quanh máy nào. */}
        {mayNen.map((m) => {
          const p = mmSangPx(m.xMm - m.rongMm / 2, m.yMm - m.sauMm / 2);
          return (
            <rect
              key={m.khoa}
              x={p.px}
              y={p.py}
              width={Math.max(m.rongMm * tiLe, 1)}
              height={Math.max(m.sauMm * tiLe, 1)}
              fill="currentColor"
              fillOpacity={0.18}
              data-testid="ve-vung-may-nen"
            />
          );
        })}

        {/* Vùng ĐÃ LƯU */}
        {vung.map((h) => {
          const d = docDiemDa(h.diemDa);
          if (d.length < SO_DINH_TOI_THIEU) return null;
          const khoa = `vung:${h.id}`;
          return (
            <polygon
              key={h.id}
              points={d.map((q) => { const p = mmSangPx(q.xMm, q.yMm); return `${p.px},${p.py}`; }).join(" ")}
              fill={h.mau ?? MAU_VUNG_MAC_DINH}
              fillOpacity={vungChon === khoa ? 0.45 : 0.25}
              stroke={h.mau ?? MAU_VUNG_MAC_DINH}
              strokeWidth={vungChon === khoa ? 2 : 1}
              className="cursor-pointer"
              data-testid="ve-vung-da-luu"
              data-khoa={khoa}
              onClick={(e) => {
                e.stopPropagation();
                onChonVung(vungChon === khoa ? null : khoa);
              }}
            />
          );
        })}

        {/* Polygon ĐANG VẼ */}
        {dinh.length > 0 ? (
          <>
            <polygon
              points={dinh.map((q) => { const p = mmSangPx(q.xMm, q.yMm); return `${p.px},${p.py}`; }).join(" ")}
              fill={mau}
              fillOpacity={0.3}
              stroke={mau}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              data-testid="ve-vung-dang-ve"
            />
            {dinh.map((q, i) => {
              const p = mmSangPx(q.xMm, q.yMm);
              return (
                <circle
                  key={i}
                  cx={p.px}
                  cy={p.py}
                  r={3.5}
                  fill={mau}
                  stroke="#fff"
                  strokeWidth={1}
                  data-testid="ve-vung-dinh"
                />
              );
            })}
          </>
        ) : null}
      </svg>

      {/* ── Danh sách vùng đã lưu ──────────────────────────────────── */}
      {vung.length === 0 ? (
        /* ★ NT-3 — "chưa có vùng nào" phải là một CÂU, không phải một khoảng
             trống. Đo được trước Đợt 8: `twin_vat_the` có 0 hàng `'vung'`, nên
             đây là trạng thái mặc định của mọi nhà máy hiện tại. */
        <p className="px-1 text-[11px] text-muted-foreground" data-testid="ve-vung-trong">
          {t("twin3d.vung.chuaCoVung")}
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5" data-testid="ve-vung-danh-sach">
          {vung.map((h) => {
            const khoa = `vung:${h.id}`;
            const d = docDiemDa(h.diemDa);
            return (
              <li
                key={h.id}
                className={`flex items-center gap-1.5 rounded px-1.5 py-1 text-[11px] ${
                  vungChon === khoa ? "bg-accent" : ""
                }`}
                data-testid="ve-vung-muc"
                data-khoa={khoa}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ background: h.mau ?? MAU_VUNG_MAC_DINH }}
                />
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left"
                  onClick={() => onChonVung(vungChon === khoa ? null : khoa)}
                  data-testid="ve-vung-chon"
                >
                  {h.ten}
                </button>
                <span className="shrink-0 text-muted-foreground">
                  {d.length >= SO_DINH_TOI_THIEU ? `${dienTichM2(d).toFixed(1)} m²` : "—"}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 shrink-0"
                  aria-label={t("twin3d.vung.sua")}
                  data-testid="ve-vung-sua"
                  onClick={() => batDauSua(h)}
                >
                  <Pencil className="h-3 w-3" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 shrink-0 text-destructive"
                  aria-label={t("twin3d.vung.xoa")}
                  data-testid="ve-vung-xoa"
                  disabled={xoaM.isPending}
                  onClick={() => void xoa(h.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {/* ── Hộp thoại đặt tên + màu ────────────────────────────────── */}
      <Dialog open={moLuu} onOpenChange={setMoLuu}>
        <DialogContent className="sm:max-w-md" data-testid="ve-vung-hop-thoai">
          <DialogHeader>
            <DialogTitle>
              {suaId != null ? t("twin3d.vung.suaVung") : t("twin3d.vung.vungMoi")}
            </DialogTitle>
            <DialogDescription>
              {t("twin3d.vung.tomTat", {
                n: dinh.length,
                dt: dtDangVe.toFixed(1),
              })}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ve-vung-ten" className="text-xs">
                {t("twin3d.vung.ten")}
              </Label>
              <Input
                id="ve-vung-ten"
                value={ten}
                onChange={(e) => setTen(e.target.value)}
                maxLength={255}
                data-testid="ve-vung-o-ten"
                placeholder={t("twin3d.vung.tenGoiY")}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">{t("twin3d.vung.mau")}</Label>
              <div className="flex gap-1.5">
                {MAU_CHON.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={c}
                    aria-pressed={mau === c}
                    className={`h-6 w-6 rounded ${mau === c ? "ring-2 ring-offset-1" : ""}`}
                    style={{ background: c }}
                    data-testid="ve-vung-mau"
                    onClick={() => setMau(c)}
                  />
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setMoLuu(false)}>
              {t("twin3d.vung.huy")}
            </Button>
            <Button
              disabled={ten.trim().length === 0 || luuM.isPending}
              data-testid="ve-vung-luu"
              onClick={() => void luu()}
            >
              {luuM.isPending ? t("twin3d.vung.dangLuu") : t("twin3d.vung.luu")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default VeVung;
