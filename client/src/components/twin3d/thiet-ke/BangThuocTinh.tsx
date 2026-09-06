/**
 * BangThuocTinh.tsx — Inspector bên phải của màn Thiết kế (§7.1, §7.2 công cụ #7).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ Ô NHẬP LÀ NGUỒN SỰ THẬT, GIZMO CHỈ LÀ LỐI TẮT (§7.2 #7)
 * ════════════════════════════════════════════════════════════════════════════
 * Nghĩa cụ thể trong mã: mọi ô ở đây ghi THẲNG vào mô hình dữ liệu bằng số
 * người gõ, KHÔNG đi vòng qua gizmo và KHÔNG bị gizmo làm tròn. "Đặt máy này ở
 * đúng X = 12.500 mm" phải làm được bằng bàn phím kể cả khi snap đang bật —
 * nếu ô nhập cũng bị snap thì con số chính xác là bất khả thi, và cả Inspector
 * trở thành một cách gõ chậm hơn để làm đúng việc của con chuột.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐƠN VỊ — HIỆN MÉT, LƯU MILIMÉT
 * ════════════════════════════════════════════════════════════════════════════
 * Người dựng nhà xưởng nghĩ bằng mét ("máy cách tường 2,5 m"); DB nói milimét
 * (§5.1, một nguồn sự thật mm). Quy đổi nằm ở ĐÚNG hai hàm dưới đây và dùng
 * `heToaDo.ts`, không viết `/1000` rải rác — mỗi chỗ viết tay là một chỗ có thể
 * quên, và quên một chỗ cho ra nhà xưởng sai 1.000 lần (§10A.1).
 *
 * ★ NT-4 — badge vàng "chưa đo" khi `kichThuocDaDo === false`. Badge KHÔNG chỉ
 *   là trang trí: nó là chỗ hệ TỰ KHAI rằng con số đang hiện là giả định. Nút
 *   "Đánh dấu đã đo" là đường tắt nó, và bấm nút đó là một hành động có ý thức.
 */

import { useTranslation } from "react-i18next";
import { AlertTriangle, Lock, Eye, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { metSangMm, mmSangMet } from "../heToaDo";
import { gocTuQuatTrucDung, quatXoayQuanhTrucDung } from "../heToaDo";
import { daSnapGoc } from "../hinhHocCanChinh";
import type { DatChoDauVao, KhoaNode, NodeCay } from "./trangThaiThietKe";

export interface BangThuocTinhProps {
  node: NodeCay | null;
  datCho: DatChoDauVao | null;
  /** Số vật thể đang chọn — >1 thì hiện tóm tắt thay vì ô nhập. */
  soDangChon: number;
  buocGocDo: number;
  onSua: (khoa: KhoaNode, sua: Partial<DatChoDauVao>) => void;
  onGoKhoiMatBang: (khoa: KhoaNode) => void;
  /**
   * ★★★ CHẶN-2 — chế độ chỉ đọc: ẨN mọi ô nhập/công tắc/nút ghi, KHÔNG disable.
   *
   * ⚠ Inspector là đường vào THỨ HAI của màn Thiết kế (gizmo là đường thứ nhất).
   *   Ẩn gizmo mà để ô nhập sống thì chế độ chỉ-đọc chỉ đóng một nửa cửa — và
   *   nửa còn lại chính là đường mà QA đã đo được là SỐNG. Mặc định `false` để
   *   không đổi hành vi của chỗ gọi nào chưa truyền.
   */
  chiDoc?: boolean;
}

/** mm → mét để HIỆN. Làm tròn 3 chữ số: `numeric(14,3)` không giữ hơn thế. */
function hienMet(mm: number): string {
  return String(Math.round(mmSangMet(mm) * 1000) / 1000);
}

/**
 * Chuỗi người gõ (mét) → mm để LƯU.
 *
 * ★ Trả `null` cho chuỗi không phải số — người dùng đang gõ dở ("1." hoặc "-")
 *   là trạng thái bình thường, và ghi `NaN` vào toạ độ làm máy biến mất khỏi
 *   cảnh mà không lỗi nào nổ. `null` nghĩa "chưa có giá trị mới, giữ nguyên".
 */
function docMet(chuoi: string): number | null {
  const s = chuoi.trim().replace(",", ".");
  if (s === "" || s === "-" || s === "." || s === "-.") return null;
  const n = Number(s);
  return Number.isFinite(n) ? metSangMm(n) : null;
}

function OSo({
  nhan,
  giaTriMm,
  onGhi,
  disabled,
  testId,
}: {
  nhan: string;
  giaTriMm: number | null;
  onGhi: (mm: number) => void;
  disabled?: boolean;
  testId: string;
}) {
  return (
    <div className="grid gap-1">
      <Label className="text-[11px] text-muted-foreground">{nhan}</Label>
      <Input
        type="text"
        inputMode="decimal"
        className="h-7 text-xs"
        disabled={disabled}
        data-testid={testId}
        // ★ Ô KHÔNG ĐIỀU KHIỂN theo từng phím: `defaultValue` + `key` để nó nhận
        // giá trị mới khi gizmo dời máy, nhưng KHÔNG nhảy con trỏ khi đang gõ.
        key={giaTriMm === null ? "rong" : String(giaTriMm)}
        defaultValue={giaTriMm === null ? "" : hienMet(giaTriMm)}
        onBlur={(e) => {
          const mm = docMet(e.target.value);
          if (mm !== null) onGhi(mm);
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          const mm = docMet((e.target as HTMLInputElement).value);
          if (mm !== null) onGhi(mm);
        }}
      />
    </div>
  );
}

export function BangThuocTinh({
  node,
  datCho,
  soDangChon,
  buocGocDo,
  onSua,
  onGoKhoiMatBang,
  chiDoc = false,
}: BangThuocTinhProps) {
  const { t } = useTranslation();

  if (soDangChon > 1) {
    return (
      <div className="p-3 text-xs text-muted-foreground" data-testid="bang-thuoc-tinh">
        {t("twin3d.thuocTinh.nhieuVatThe", { n: soDangChon })}
      </div>
    );
  }

  if (!node) {
    return (
      <div className="p-3 text-xs text-muted-foreground" data-testid="bang-thuoc-tinh">
        {t("twin3d.thuocTinh.chuaChon")}
      </div>
    );
  }

  const gocDo = datCho
    ? (gocTuQuatTrucDung({
        x: datCho.quatX,
        y: datCho.quatY,
        z: datCho.quatZ,
        w: datCho.quatW,
      }) *
        180) /
      Math.PI
    : 0;
  const lechLuoi = datCho ? !daSnapGoc(gocDo, buocGocDo, 1e-6) : false;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto p-3" data-testid="bang-thuoc-tinh">
      <div className="mb-2">
        <p className="text-xs font-semibold">{node.nhan}</p>
        <p className="text-[11px] text-muted-foreground">{node.loai}</p>
      </div>

      {node.choXepCho || !datCho ? (
        <p className="rounded border border-dashed p-2 text-[11px] text-muted-foreground">
          {t("twin3d.khuChoXepChoMoTa")}
        </p>
      ) : chiDoc ? (
        /*
         * ★★★ CHẶN-2 — nhánh CHỈ ĐỌC. Vẫn HIỆN SỐ (người chỉ-xem có quyền xem
         * bố cục), nhưng không có một ô nhập, công tắc hay nút ghi nào trong
         * DOM. Phép đo nghiệm thu là `queryByTestId("o-vi-tri-x") === null`, và
         * một ô `disabled` sẽ làm phép đo đó ĐỎ — đúng như phải thế.
         */
        <div className="grid gap-1.5 text-[11px]" data-testid="thuoc-tinh-chi-doc">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("twin3d.thuocTinh.viTri")}</span>
            <span className="tabular-nums">
              {hienMet(datCho.viTriXMm)} · {hienMet(datCho.viTriYMm)} ·{" "}
              {hienMet(datCho.viTriZMm)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("twin3d.thuocTinh.xoayDo")}</span>
            <span className="tabular-nums">{Math.round(gocDo * 1000) / 1000}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("twin3d.thuocTinh.kichThuoc")}</span>
            <span className="tabular-nums">
              {datCho.rongMm === null ? "—" : hienMet(datCho.rongMm)} ·{" "}
              {datCho.caoMm === null ? "—" : hienMet(datCho.caoMm)} ·{" "}
              {datCho.sauMm === null ? "—" : hienMet(datCho.sauMm)}
            </span>
          </div>
          <div className="text-muted-foreground">
            {t("twin3d.nguon." + (datCho.nguon === "tay" ? "tay" : "sinh"))}
          </div>
        </div>
      ) : (
        <>
          {/* ★ NT-4 — badge vàng "chưa đo". */}
          {!datCho.kichThuocDaDo ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  className="mb-2 w-fit gap-1 border-amber-500/60 text-amber-700 dark:text-amber-400"
                  data-testid="badge-chua-do"
                >
                  <AlertTriangle className="h-3 w-3" />
                  {t("twin3d.chuaDo")}
                </Badge>
              </TooltipTrigger>
              <TooltipContent className="max-w-64 text-xs">
                {t("twin3d.chuaDoGiaiThich")}
              </TooltipContent>
            </Tooltip>
          ) : null}

          <p className="mb-2 text-[10px] leading-tight text-muted-foreground">
            {t("twin3d.thuocTinh.oNhapLaNguonSuThat")}
          </p>

          <Label className="mb-1 text-[11px] font-medium">{t("twin3d.thuocTinh.viTri")}</Label>
          <div className="mb-3 grid grid-cols-3 gap-1.5">
            <OSo
              nhan="X"
              giaTriMm={datCho.viTriXMm}
              disabled={datCho.daKhoa}
              testId="o-vi-tri-x"
              onGhi={(mm) => onSua(node.khoa, { viTriXMm: mm })}
            />
            <OSo
              nhan="Y"
              giaTriMm={datCho.viTriYMm}
              disabled={datCho.daKhoa}
              testId="o-vi-tri-y"
              onGhi={(mm) => onSua(node.khoa, { viTriYMm: mm })}
            />
            <OSo
              nhan="Z"
              giaTriMm={datCho.viTriZMm}
              disabled={datCho.daKhoa}
              testId="o-vi-tri-z"
              onGhi={(mm) => onSua(node.khoa, { viTriZMm: mm })}
            />
          </div>

          <div className="mb-3 grid gap-1">
            <Label className="text-[11px] text-muted-foreground">
              {t("twin3d.thuocTinh.xoayDo")}
            </Label>
            <Input
              type="text"
              inputMode="decimal"
              className="h-7 text-xs"
              disabled={datCho.daKhoa}
              data-testid="o-xoay"
              key={String(gocDo)}
              defaultValue={String(Math.round(gocDo * 1000) / 1000)}
              onBlur={(e) => {
                const n = Number(e.target.value.trim().replace(",", "."));
                if (!Number.isFinite(n)) return;
                const q = quatXoayQuanhTrucDung((n * Math.PI) / 180);
                onSua(node.khoa, { quatX: q.x, quatY: q.y, quatZ: q.z, quatW: q.w });
              }}
            />
            {lechLuoi ? (
              <span className="text-[10px] text-amber-600 dark:text-amber-400">
                {t("twin3d.thuocTinh.lechLuoi")}
              </span>
            ) : null}
          </div>

          <Label className="mb-1 text-[11px] font-medium">
            {t("twin3d.thuocTinh.kichThuoc")}
          </Label>
          <div className="mb-2 grid grid-cols-3 gap-1.5">
            <OSo
              nhan={t("twin3d.thuocTinh.rong")}
              giaTriMm={datCho.rongMm}
              disabled={datCho.daKhoa}
              testId="o-rong"
              onGhi={(mm) => onSua(node.khoa, { rongMm: mm })}
            />
            <OSo
              nhan={t("twin3d.thuocTinh.cao")}
              giaTriMm={datCho.caoMm}
              disabled={datCho.daKhoa}
              testId="o-cao"
              onGhi={(mm) => onSua(node.khoa, { caoMm: mm })}
            />
            <OSo
              nhan={t("twin3d.thuocTinh.sau")}
              giaTriMm={datCho.sauMm}
              disabled={datCho.daKhoa}
              testId="o-sau"
              onGhi={(mm) => onSua(node.khoa, { sauMm: mm })}
            />
          </div>

          {!datCho.kichThuocDaDo ? (
            <Button
              variant="outline"
              size="sm"
              className="mb-3 h-7 text-[11px]"
              data-testid="nut-danh-dau-da-do"
              onClick={() => onSua(node.khoa, { kichThuocDaDo: true })}
            >
              {t("twin3d.thuocTinh.danhDauDaDo")}
            </Button>
          ) : null}

          <div className="mb-3 grid gap-2">
            <label className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5" /> {t("twin3d.thuocTinh.khoa")}
              </span>
              <Switch
                checked={datCho.daKhoa}
                data-testid="cong-tac-khoa"
                onCheckedChange={(v) => onSua(node.khoa, { daKhoa: v })}
              />
            </label>
            <label className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5">
                <Eye className="h-3.5 w-3.5" /> {t("twin3d.thuocTinh.hienThi")}
              </span>
              <Switch
                checked={datCho.hienThi}
                data-testid="cong-tac-hien-thi"
                onCheckedChange={(v) => onSua(node.khoa, { hienThi: v })}
              />
            </label>
          </div>

          <div className="mb-3 text-[11px] text-muted-foreground">
            {t("twin3d.nguon." + (datCho.nguon === "tay" ? "tay" : "sinh"))}
          </div>

          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-[11px] text-destructive"
            data-testid="nut-go-khoi-mat-bang"
            onClick={() => {
              // ★ Câu xác nhận nói RÕ điều mã thật sự làm: xoá vị trí, GIỮ máy.
              if (window.confirm(t("twin3d.thuocTinh.goXacNhan", { ten: node.nhan }))) {
                onGoKhoiMatBang(node.khoa);
              }
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t("twin3d.thuocTinh.goKhoiMatBang")}
          </Button>
        </>
      )}
    </div>
  );
}

export default BangThuocTinh;
