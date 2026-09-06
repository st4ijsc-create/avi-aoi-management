/**
 * ThuVienAsset.tsx — dải thư viện asset dưới cùng màn Thiết kế (§7.1, §7.4).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★ PHẠM VI THẬT CỦA ĐỢT NÀY — nói thẳng thay vì để UI tự khai quá tay
 * ════════════════════════════════════════════════════════════════════════════
 * §7.4 mô tả một luồng nhập model đầy đủ: GLTFLoader trên trình duyệt →
 * `kiemTraAsset.ts` đo tam giác/material/bbox → chặn theo ngưỡng → upload →
 * ghi `equipment_3d_models` → sinh ảnh xem trước offscreen. Đợt này dựng **dải
 * asset và các thẻ khối dựng sẵn**; luồng UPLOAD còn là nợ N-2/N-3 của §12.1b
 * (`napGltfChoBanVe` vẫn là stub, `KhungXemTruoc3D` trả `null`).
 *
 * Nút "Tải mô hình lên" vì vậy hiện thông báo "sẽ có ở đợt sau" thay vì mở một
 * hộp chọn tệp rồi thất bại. Một nút mở được nhưng không hoàn thành được việc
 * là lời khai sai về năng lực của hệ — và nó tốn của người dùng một lần thử,
 * một tệp 15 MB, và niềm tin.
 *
 * ★ Thẻ khối dựng sẵn lấy TỪ `hinhKhoiMay.ts` (`DANH_SACH_KHOI`, 7 khối đã đo
 *   đúng 60 tam giác mỗi khối) — không chép danh sách ra đây. Chép ra là tạo
 *   nguồn sự thật thứ hai, và nó sẽ trôi khỏi bản gốc ở đợt thêm loại máy mới.
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { DANH_SACH_KHOI, type KhoiKey } from "../hinhKhoiMay";

/** Nhóm hạ tầng/kho — khớp `twinvatTheenum` của §5.3, không tự chế danh sách. */
const HA_TANG = ["tuong", "cot", "cua", "vachKe", "raoAnToan", "bienBao"] as const;
const KHO = ["ke", "pallet", "bangTai"] as const;

type Nhom = "may" | "haTang" | "kho";

function The({ nhan, testId }: { nhan: string; testId: string }) {
  return (
    <div
      className="flex shrink-0 cursor-grab items-center gap-1.5 rounded border bg-background px-2 py-1 text-[11px] hover:bg-muted"
      draggable
      data-testid={testId}
    >
      <Box className="h-3.5 w-3.5 text-muted-foreground" />
      {nhan}
    </div>
  );
}

export function ThuVienAsset() {
  const { t } = useTranslation();
  const [nhom, setNhom] = useState<Nhom>("may");
  const [loc, setLoc] = useState("");

  const the = useMemo(() => {
    const q = loc.trim().toLowerCase();
    const ds: { nhan: string; id: string }[] =
      nhom === "may"
        ? DANH_SACH_KHOI.map((k: KhoiKey) => ({ id: k, nhan: k.replace(/_/g, " ") }))
        : nhom === "haTang"
          ? HA_TANG.map((k) => ({ id: k, nhan: t(`twin3d.vatThe.${k}`) }))
          : KHO.map((k) => ({ id: k, nhan: t(`twin3d.vatThe.${k}`) }));
    return q === "" ? ds : ds.filter((x) => x.nhan.toLowerCase().includes(q));
  }, [nhom, loc, t]);

  return (
    <div className="border-t px-3 py-1.5" data-testid="thu-vien-asset">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">
          {t("twin3d.thuVien.tieuDe")}
        </span>
        <Tabs value={nhom} onValueChange={(v) => setNhom(v as Nhom)}>
          <TabsList className="h-7">
            <TabsTrigger value="may" className="h-6 px-2 text-[11px]">
              {t("twin3d.thuVien.may")}
            </TabsTrigger>
            <TabsTrigger value="haTang" className="h-6 px-2 text-[11px]">
              {t("twin3d.thuVien.haTang")}
            </TabsTrigger>
            <TabsTrigger value="kho" className="h-6 px-2 text-[11px]">
              {t("twin3d.thuVien.kho")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Input
          className="h-7 w-40 text-xs"
          value={loc}
          onChange={(e) => setLoc(e.target.value)}
          placeholder={t("twin3d.thuVien.loc")}
          data-testid="loc-thu-vien"
        />
        <Button
          size="sm"
          variant="outline"
          className="ml-auto h-7 gap-1.5 text-[11px]"
          data-testid="nut-tai-model"
          // Xem docblock đầu tệp: nợ N-2/N-3, KHÔNG mở hộp chọn tệp rồi hỏng.
          onClick={() => toast.info(t("twin3d.thuVien.sapCo"))}
        >
          <Upload className="h-3.5 w-3.5" />
          {t("twin3d.thuVien.taiLen")}
        </Button>
      </div>

      <div className="mt-1.5 flex gap-1.5 overflow-x-auto pb-0.5">
        {the.map((x) => (
          <The key={x.id} nhan={x.nhan} testId={`the-asset-${x.id}`} />
        ))}
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">{t("twin3d.thuVien.keoVaoCanh")}</p>
    </div>
  );
}

export default ThuVienAsset;
