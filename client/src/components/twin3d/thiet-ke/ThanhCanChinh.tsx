/**
 * ThanhCanChinh.tsx — nối 12 công cụ của `hinhHocCanChinh.ts` vào UI (§7.2).
 *
 * ★ Tệp này KHÔNG chứa số học nào. Mọi phép tính đã ở `hinhHocCanChinh.ts` (69
 *   test) và `phamViLine.ts` (49 test); ở đây chỉ có nút và một `<select>`. Nếu
 *   một công thức lọt vào đây thì nó nằm ngoài tầm với của vitest.
 *
 * ★★★ HOÁN VỊ TRỤC — bẫy chết người của tệp này.
 *   `hinhHocCanChinh` làm việc trên trục SCENE (y = ĐỘ CAO, z = mặt bằng), còn
 *   `twin_dat_cho` dùng trục DB (y = mặt bằng, z = độ cao). Cầu nối là
 *   `bboxCuaDatCho` (DB → scene) và `apDichVaoDatCho` (scene → DB) của
 *   `trangThaiThietKe.ts`, đã có test vòng tròn. Ở đây TUYỆT ĐỐI không tự cộng
 *   `dich.z` vào `viTriZMm` — làm thế là nhấc máy lên trời, và không lỗi nào nổ.
 *
 * ★ §10C.4 — ba công cụ Line dùng `phamViLine.ts`, và cả ba là MỘT lệnh undo
 *   (không phải một chuỗi thao tác), khớp `lichSuThaoTac.ts`.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlignHorizontalJustifyCenter,
  AlignVerticalJustifyCenter,
  AlignStartVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignEndHorizontal,
  Copy,
  Ruler,
  RotateCw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { metSangMm } from "../heToaDo";
import {
  SO_LUONG_NHAN_BAN_TOI_DA,
  type HuongCanh,
  type TrucScene,
} from "../hinhHocCanChinh";

export interface ThanhCanChinhProps {
  soDangChon: number;
  onCanh: (huong: HuongCanh) => void;
  onDanDeu: (truc: TrucScene) => void;
  onNhanBanTuyenTinh: (buocMm: number, soLuong: number, truc: TrucScene) => void;
  onNhanBanToaTron: (soLuong: number, gocDo: number) => void;
  /** Bật/tắt chế độ đo khoảng cách (click 2 điểm trong cảnh). */
  dangDo: boolean;
  onBatDo: (bat: boolean) => void;
  /** Khoảng cách đo được, mm. `null` = chưa đủ 2 điểm. */
  ketQuaDoMm: number | null;
}

const CAC_HUONG: { huong: HuongCanh; khoa: string; Icon: typeof AlignStartVertical }[] = [
  { huong: "trai", khoa: "twin3d.congCu.canTrai", Icon: AlignStartVertical },
  { huong: "giua_ngang", khoa: "twin3d.congCu.canGiua", Icon: AlignHorizontalJustifyCenter },
  { huong: "phai", khoa: "twin3d.congCu.canPhai", Icon: AlignEndVertical },
  { huong: "tren", khoa: "twin3d.canChinh.canTren", Icon: AlignStartHorizontal },
  { huong: "giua_doc", khoa: "twin3d.canChinh.canGiuaDoc", Icon: AlignVerticalJustifyCenter },
  { huong: "duoi", khoa: "twin3d.canChinh.canDuoi", Icon: AlignEndHorizontal },
];

export function ThanhCanChinh({
  soDangChon,
  onCanh,
  onDanDeu,
  onNhanBanTuyenTinh,
  onNhanBanToaTron,
  dangDo,
  onBatDo,
  ketQuaDoMm,
}: ThanhCanChinhProps) {
  const { t } = useTranslation();
  // `canhTheoBien` trả nguyên trạng với < 2 vật; `danDeu` với < 3. Nút bị vô
  // hiệu theo ĐÚNG hai ngưỡng đó — nút bấm được mà không làm gì là cách nhanh
  // nhất khiến người dùng nghĩ tính năng hỏng.
  const duCanh = soDangChon >= 2;
  const duDan = soDangChon >= 3;

  const [buocM, setBuocM] = useState("2.5");
  const [soLuong, setSoLuong] = useState("3");
  const [gocDo, setGocDo] = useState("45");

  const soLuongHopLe = (() => {
    const n = Number(soLuong);
    return Number.isInteger(n) && n >= 2 && n <= SO_LUONG_NHAN_BAN_TOI_DA ? n : null;
  })();

  return (
    <div
      className="flex flex-wrap items-center gap-1 border-b px-2 py-1"
      data-testid="thanh-can-chinh"
    >
      {CAC_HUONG.map(({ huong, khoa, Icon }) => (
        <Tooltip key={huong}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={!duCanh}
              data-testid={`nut-canh-${huong}`}
              onClick={() => onCanh(huong)}
            >
              <Icon className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent className="text-xs">
            {t(khoa)}
            {!duCanh ? ` — ${t("twin3d.canChinh.canChon2")}` : ""}
          </TooltipContent>
        </Tooltip>
      ))}

      <Separator orientation="vertical" className="mx-1 h-5" />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px]"
            disabled={!duDan}
            data-testid="nut-dan-deu-x"
            onClick={() => onDanDeu("X")}
          >
            {t("twin3d.canChinh.danDeuNgang")}
          </Button>
        </TooltipTrigger>
        <TooltipContent className="text-xs">
          {duDan ? t("twin3d.congCu.raiDeu") : t("twin3d.canChinh.canChon3")}
        </TooltipContent>
      </Tooltip>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-[11px]"
        disabled={!duDan}
        data-testid="nut-dan-deu-z"
        onClick={() => onDanDeu("Z")}
      >
        {t("twin3d.canChinh.danDeuDoc")}
      </Button>

      <Separator orientation="vertical" className="mx-1 h-5" />

      {/* Nhân bản tuyến tính */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-[11px]"
            disabled={soDangChon < 1}
            data-testid="nut-nhan-ban-tuyen-tinh"
          >
            <Copy className="h-3.5 w-3.5" />
            {t("twin3d.canChinh.nhanBanTuyenTinh")}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 space-y-2">
          <div className="grid gap-1">
            <label className="text-[11px] text-muted-foreground">
              {t("twin3d.canChinh.buoc")}
            </label>
            <Input
              className="h-7 text-xs"
              value={buocM}
              onChange={(e) => setBuocM(e.target.value)}
              data-testid="o-buoc-nhan-ban"
            />
          </div>
          <div className="grid gap-1">
            <label className="text-[11px] text-muted-foreground">
              {t("twin3d.canChinh.soLuong")}
            </label>
            <Input
              className="h-7 text-xs"
              value={soLuong}
              onChange={(e) => setSoLuong(e.target.value)}
              data-testid="o-so-luong-nhan-ban"
            />
          </div>
          <div className="flex gap-1">
            <Button
              size="sm"
              className="h-7 flex-1 text-[11px]"
              disabled={soLuongHopLe === null}
              data-testid="nut-ap-dung-nhan-ban-x"
              onClick={() => {
                const b = Number(buocM.replace(",", "."));
                if (Number.isFinite(b) && soLuongHopLe !== null) {
                  onNhanBanTuyenTinh(metSangMm(b), soLuongHopLe, "X");
                }
              }}
            >
              X
            </Button>
            <Button
              size="sm"
              className="h-7 flex-1 text-[11px]"
              disabled={soLuongHopLe === null}
              data-testid="nut-ap-dung-nhan-ban-z"
              onClick={() => {
                const b = Number(buocM.replace(",", "."));
                if (Number.isFinite(b) && soLuongHopLe !== null) {
                  onNhanBanTuyenTinh(metSangMm(b), soLuongHopLe, "Z");
                }
              }}
            >
              Z
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {/* Nhân bản toả tròn */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-[11px]"
            disabled={soDangChon < 1}
            data-testid="nut-nhan-ban-toa-tron"
          >
            <RotateCw className="h-3.5 w-3.5" />
            {t("twin3d.canChinh.nhanBanToaTron")}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 space-y-2">
          <div className="grid gap-1">
            <label className="text-[11px] text-muted-foreground">
              {t("twin3d.canChinh.goc")}
            </label>
            <Input
              className="h-7 text-xs"
              value={gocDo}
              onChange={(e) => setGocDo(e.target.value)}
              data-testid="o-goc-toa-tron"
            />
          </div>
          <div className="grid gap-1">
            <label className="text-[11px] text-muted-foreground">
              {t("twin3d.canChinh.soLuong")}
            </label>
            <Input
              className="h-7 text-xs"
              value={soLuong}
              onChange={(e) => setSoLuong(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            className="h-7 w-full text-[11px]"
            disabled={soLuongHopLe === null}
            data-testid="nut-ap-dung-toa-tron"
            onClick={() => {
              const g = Number(gocDo.replace(",", "."));
              if (Number.isFinite(g) && soLuongHopLe !== null) {
                onNhanBanToaTron(soLuongHopLe, g);
              }
            }}
          >
            {t("twin3d.canChinh.apDung")}
          </Button>
        </PopoverContent>
      </Popover>

      <Separator orientation="vertical" className="mx-1 h-5" />

      <Button
        variant={dangDo ? "secondary" : "ghost"}
        size="sm"
        className="h-7 gap-1 px-2 text-[11px]"
        data-testid="nut-do-khoang-cach"
        onClick={() => onBatDo(!dangDo)}
      >
        <Ruler className="h-3.5 w-3.5" />
        {t("twin3d.canChinh.doKhoangCach")}
      </Button>
      {ketQuaDoMm !== null ? (
        <span className="text-[11px] tabular-nums text-muted-foreground" data-testid="ket-qua-do">
          {t("twin3d.canChinh.ketQuaDo", {
            n: (Math.round(ketQuaDoMm) / 1000).toFixed(3),
          })}
        </span>
      ) : null}
    </div>
  );
}

export default ThanhCanChinh;
