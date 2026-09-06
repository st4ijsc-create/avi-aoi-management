/**
 * HopThoaiSinh.tsx — hộp thoại Sinh tự động (§7.3).
 *
 * Luồng bắt buộc của spec: chỉnh tham số → **xem trước GHOST trong 3D** → bảng
 * tổng kết *"sẽ tạo N, GIỮ NGUYÊN M vật thể đã chỉnh tay"* → Áp dụng.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ XEM TRƯỚC VÀ GHI THẬT ĐI QUA CÙNG MỘT ĐƯỜNG MÃ
 * ════════════════════════════════════════════════════════════════════════════
 * `twinCanh.xemTruocSinh` (query) và `twinCanh.sinhTuDong` (mutation) đều gọi
 * `chuanBiSinh()` ở server, và `chuanBiSinh` gọi `sinhBoCuc()` — tức con số
 * người dùng ĐỌC trước khi bấm và hành vi CHẠY sau khi bấm là cùng một phép
 * tính. Nếu xem trước tự tính lại ở client thì bảng tổng kết là một lời khai
 * độc lập với hành vi, và nó sẽ đúng đúng cho tới ngày nó sai.
 *
 * ★ NT-4 — con số M ("giữ nguyên") đến từ `boQua` mà `sinhBoCuc` TỰ KHAI, không
 *   từ một phép đếm thứ hai. Xem docblock `xemTruocSinh.tongKetSinh`.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { Badge } from "@/components/ui/badge";
import { metSangMm, mmSangMet } from "../heToaDo";
import { CAU_HINH_SINH_MAC_DINH, type CauHinhSinh } from "../sinhBoCuc";
import type { TongKetSinh } from "./xemTruocSinh";

export interface HopThoaiSinhProps {
  mo: boolean;
  onDoiMo: (mo: boolean) => void;
  cauHinh: CauHinhSinh;
  onDoiCauHinh: (c: CauHinhSinh) => void;
  tongKet: TongKetSinh | null;
  soMaySeDoi: number;
  dangTinh: boolean;
  dangGhi: boolean;
  onXemTruoc: () => void;
  onApDung: () => void;
}

/** Một ô tham số, hiện MÉT lưu MILIMÉT — cùng quy ước với Inspector. */
function OThamSo({
  nhan,
  giaTriMm,
  onGhi,
  testId,
}: {
  nhan: string;
  giaTriMm: number;
  onGhi: (mm: number) => void;
  testId: string;
}) {
  return (
    <div className="grid gap-1">
      <Label className="text-[11px] text-muted-foreground">{nhan}</Label>
      <Input
        className="h-8 text-xs"
        inputMode="decimal"
        data-testid={testId}
        defaultValue={String(Math.round(mmSangMet(giaTriMm) * 1000) / 1000)}
        onBlur={(e) => {
          const n = Number(e.target.value.trim().replace(",", "."));
          // Giá trị <= 0 bị TỪ CHỐI im lặng (giữ số cũ): bước 0 làm thuật toán
          // xếp mọi máy chồng lên nhau tại một điểm — hợp lệ về kiểu, vô nghĩa
          // về bố cục, và người dùng sẽ tưởng thuật toán hỏng.
          if (Number.isFinite(n) && n > 0) onGhi(metSangMm(n));
        }}
      />
    </div>
  );
}

export function HopThoaiSinh({
  mo,
  onDoiMo,
  cauHinh,
  onDoiCauHinh,
  tongKet,
  soMaySeDoi,
  dangTinh,
  dangGhi,
  onXemTruoc,
  onApDung,
}: HopThoaiSinhProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={mo} onOpenChange={onDoiMo}>
      <DialogContent className="max-w-lg" data-testid="hop-thoai-sinh">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4" />
            {t("twin3d.sinh.tieuDe")}
          </DialogTitle>
          <DialogDescription className="text-xs">{t("twin3d.sinh.moTa")}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <OThamSo
            nhan={t("twin3d.sinh.buocChuyen")}
            giaTriMm={cauHinh.buocChuyenMm}
            testId="o-buoc-chuyen"
            onGhi={(mm) => onDoiCauHinh({ ...cauHinh, buocChuyenMm: mm })}
          />
          <OThamSo
            nhan={t("twin3d.sinh.buocTram")}
            giaTriMm={cauHinh.buocTramMm}
            testId="o-buoc-tram"
            onGhi={(mm) => onDoiCauHinh({ ...cauHinh, buocTramMm: mm })}
          />
          <OThamSo
            nhan={t("twin3d.sinh.buocMayTrongTram")}
            giaTriMm={cauHinh.buocMayTrongTramMm}
            testId="o-buoc-may-trong-tram"
            onGhi={(mm) => onDoiCauHinh({ ...cauHinh, buocMayTrongTramMm: mm })}
          />
          <OThamSo
            nhan={t("twin3d.sinh.loiDi")}
            giaTriMm={cauHinh.loiDiMm}
            testId="o-loi-di"
            onGhi={(mm) => onDoiCauHinh({ ...cauHinh, loiDiMm: mm })}
          />
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            disabled={dangTinh}
            data-testid="nut-xem-truoc-sinh"
            onClick={onXemTruoc}
          >
            {dangTinh ? t("twin3d.sinh.dangTinh") : t("twin3d.sinh.xemTruoc")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={() => onDoiCauHinh({ ...CAU_HINH_SINH_MAC_DINH })}
          >
            {t("common.reset", "Mặc định")}
          </Button>
        </div>

        {/* ── Bảng tổng kết — câu của §7.3 ─────────────────────────────────── */}
        {tongKet ? (
          <div className="rounded border p-3 text-xs" data-testid="tong-ket-sinh">
            <p className="font-medium" data-testid="tong-ket-se-tao">
              {t("twin3d.sinh.seTao", { n: tongKet.seTao })}
            </p>
            <p className="text-muted-foreground">
              {t("twin3d.sinh.seTaoMoi", { n: tongKet.seTaoMoi })} ·{" "}
              {t("twin3d.sinh.seGhiDe", { n: tongKet.seGhiDe })}
            </p>

            {/* ★★★ NT-4 — con số M, hiện ĐẬM vì đây là lời hứa người dùng dựa vào. */}
            <p className="mt-2 font-semibold text-emerald-700 dark:text-emerald-400" data-testid="tong-ket-giu-nguyen">
              {t("twin3d.sinh.giuNguyen", { n: tongKet.giuNguyen })}
            </p>
            <p className="text-[11px] leading-tight text-muted-foreground">
              {t("twin3d.sinh.giuNguyenGiaiThich")}
            </p>

            <p className="mt-2" data-testid="tong-ket-se-doi">
              {soMaySeDoi > 0
                ? t("twin3d.sinh.seDoi", { n: soMaySeDoi })
                : t("twin3d.sinh.khongDoi")}
            </p>

            {tongKet.canhBao.length > 0 ? (
              <div className="mt-2 space-y-1">
                {tongKet.canhBao.map((c) => (
                  <Badge
                    key={c}
                    variant="outline"
                    className="flex w-fit items-start gap-1 whitespace-normal border-amber-500/60 text-left text-[11px] text-amber-700 dark:text-amber-400"
                  >
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    {c}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onDoiMo(false)}>
            {t("twin3d.sinh.huy")}
          </Button>
          <Button
            size="sm"
            // ★ Áp dụng chỉ mở sau khi ĐÃ xem trước: bấm mù một lệnh ghi 80 hàng
            //   là đúng thứ mà bảng tổng kết sinh ra để chống.
            disabled={tongKet === null || dangGhi}
            data-testid="nut-ap-dung-sinh"
            onClick={onApDung}
          >
            {t("twin3d.sinh.apDung")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default HopThoaiSinh;
