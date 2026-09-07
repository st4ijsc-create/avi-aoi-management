/**
 * BanGhiBoCuc.tsx — CRUD BẢN GHI BỐ CỤC THEO TÊN (#55, §5.3 `twin_ban_ghi`).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ #55 LÀ LỚP LỖI L-3 — "BẢNG TỒN TẠI KHÔNG PHẢI LÀ TÍNH NĂNG TỒN TẠI"
 * ════════════════════════════════════════════════════════════════════════════
 * §11c.2 đo được: `drizzle/0351…:158` tạo bảng, `drizzle/schema/twin3d.ts:261`
 * khai kiểu, DB dev có **0 dòng**, và `grep twinBanGhi server/ client/` (trừ
 * schema) cho **0 kết quả**. Không một dòng mã nào đọc hay ghi nó.
 *
 * Lô này đóng cả ba tầng cùng lúc: db (`twinCanh.ts`), router (5 thủ tục), và
 * tệp này — giao diện. Thiếu tầng nào thì hai tầng kia lại thành một lớp L-3
 * mới, chỉ ở chỗ khác.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ BA HÀNH ĐỘNG, BA HẬU QUẢ KHÁC HẲN NHAU — UI PHẢI NÓI RÕ
 * ════════════════════════════════════════════════════════════════════════════
 *   • **Lưu**      — ghi bố cục đang sửa thành một bản có tên. Không ai thấy.
 *   • **Xuất bản** — ĐẨY bản đó ra `/twin`. Người đang trực ca THẤY NGAY.
 *   • **Khôi phục**— ghi đè bố cục đang sửa bằng ảnh chụp cũ. Mất công đang làm.
 *
 * Gộp ba thứ này thành "Lưu" là cách chắc chắn để ai đó xuất bản một bản nháp.
 * §5.3 nói thẳng vì sao cột `daXuatBan` tồn tại: *"Người đang dựng không làm rối
 * màn hình vận hành đang chạy."*
 *
 * ★ Khôi phục KHÔNG tự ghi vào DB — nó nạp ảnh chụp vào trạng thái đang sửa và
 *   để người dùng bấm "Lưu" của màn chính. Ghi thẳng sẽ bỏ qua undo/redo
 *   (`lichSuThaoTac.ts`) và người dùng mất đường lùi ngay tại thao tác nguy
 *   hiểm nhất của màn.
 *
 * ★ CHẶN-2 — component này CHỈ được dựng khi `coQuyenSua`; nó là đường GHI.
 */

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, History, Loader2, Save, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { toastTrpcError } from "@/lib/trpcErrors";
import { trpc } from "@/lib/trpc";

/** Một đặt chỗ ở dạng ảnh chụp — khớp ĐÚNG lược đồ Zod của `luuBanGhi`. */
export interface DatChoAnhChup {
  loaiThucThe: string;
  thucTheId: number;
  viTriXMm: number;
  viTriYMm: number;
  viTriZMm: number;
  quatX: number;
  quatY: number;
  quatZ: number;
  quatW: number;
  rongMm?: number | null;
  caoMm?: number | null;
  sauMm?: number | null;
  daKhoa?: boolean;
  hienThi?: boolean;
}

export interface BanGhiBoCucProps {
  tangId: number;
  /**
   * Ảnh chụp bố cục ĐANG SỬA — hàm, không phải giá trị.
   *
   * ★★★ HÀM CHỨ KHÔNG PHẢI PROP GIÁ TRỊ, và đây không phải chuyện hiệu năng:
   *   một prop giá trị được tính ở mỗi lượt render của màn cha, tức 42 object
   *   được dựng lại mỗi lần người dùng rê chuột. Hàm chỉ chạy khi người dùng
   *   thật sự bấm "Lưu" — và nó đọc trạng thái TẠI THỜI ĐIỂM BẤM, đúng thứ
   *   người dùng đang nhìn.
   */
  layAnhChup: () => DatChoAnhChup[];
  /** Nạp một ảnh chụp vào trạng thái đang sửa (KHÔNG ghi DB — xem docblock). */
  onKhoiPhuc: (datCho: DatChoAnhChup[]) => void;
}

export function BanGhiBoCuc({ tangId, layAnhChup, onKhoiPhuc }: BanGhiBoCucProps) {
  const { t } = useTranslation();
  const [nhan, setNhan] = useState("");
  const [dangKhoiPhuc, setDangKhoiPhuc] = useState<number | null>(null);

  const tienIch = trpc.useUtils();
  const dsQ = trpc.twinCanh.danhSachBanGhi.useQuery({ tangIds: [tangId] }, { retry: false });
  const luuM = trpc.twinCanh.luuBanGhi.useMutation();
  const xuatM = trpc.twinCanh.xuatBanBanGhi.useMutation();
  const xoaM = trpc.twinCanh.xoaBanGhi.useMutation();

  const lamMoi = useCallback(
    () => void tienIch.twinCanh.danhSachBanGhi.invalidate(),
    [tienIch],
  );

  const luu = useCallback(async () => {
    const ten = nhan.trim();
    if (ten === "") return;
    const datCho = layAnhChup();
    // ★ Chặn ở CLIENT nữa (server đã chặn bằng `.min(1)`): một ảnh chụp rỗng
    //   lưu được, xuất bản được, và màn Vận hành đọc ra nhà máy trống mà không
    //   lỗi nào nổ. Nói lý do ở đây rẻ hơn một lượt đi-về để nhận lỗi Zod.
    if (datCho.length === 0) {
      toast.error(t("twin3d.banGhi.rongKhongLuu"));
      return;
    }
    try {
      await luuM.mutateAsync({
        tangId,
        nhan: ten,
        anhChup: { phienBan: 1, ghiLuc: new Date().toISOString(), datCho },
      });
      toast.success(t("twin3d.banGhi.daLuu", { n: datCho.length }));
      setNhan("");
      lamMoi();
    } catch (e) {
      toastTrpcError(e);
    }
  }, [nhan, layAnhChup, luuM, tangId, t, lamMoi]);

  const xuatBan = useCallback(
    async (id: number) => {
      try {
        await xuatM.mutateAsync({ id });
        toast.success(t("twin3d.banGhi.daXuatBanXong"));
        lamMoi();
      } catch (e) {
        toastTrpcError(e);
      }
    },
    [xuatM, t, lamMoi],
  );

  const khoiPhuc = useCallback(
    async (id: number) => {
      setDangKhoiPhuc(id);
      try {
        // ★ Chỉ tới đây mới tải `anhChup` — danh sách cố ý KHÔNG mang nó theo.
        const ban = await tienIch.twinCanh.chiTietBanGhi.fetch({ id });
        onKhoiPhuc(ban.anhChup.datCho as DatChoAnhChup[]);
        toast.success(t("twin3d.banGhi.daKhoiPhuc", { n: ban.anhChup.datCho.length }));
      } catch (e) {
        toastTrpcError(e);
      } finally {
        setDangKhoiPhuc(null);
      }
    },
    [tienIch, onKhoiPhuc, t],
  );

  const xoa = useCallback(
    async (id: number) => {
      try {
        const kq = await xoaM.mutateAsync({ id });
        // ★ Nói ra khi vừa gỡ bản màn Vận hành đang đọc — thông tin này chỉ
        //   server biết (nó đọc cờ TRƯỚC khi xoá), nên nó phải đi kèm kết quả.
        if (kq.daTungXuatBan) toast.warning(t("twin3d.banGhi.xoaBanDangXuatBan"));
        else toast.success(t("twin3d.banGhi.daXoa"));
        lamMoi();
      } catch (e) {
        toastTrpcError(e);
      }
    },
    [xoaM, t, lamMoi],
  );

  const ds = dsQ.data ?? [];

  return (
    <div className="border-t p-2" data-testid="khoi-ban-ghi">
      <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">
        {t("twin3d.banGhi.tieuDe")}
      </p>

      <div className="flex items-center gap-1.5">
        <Input
          className="h-7 flex-1 text-xs"
          value={nhan}
          onChange={(e) => setNhan(e.target.value)}
          placeholder={t("twin3d.banGhi.nhan")}
          maxLength={255}
          data-testid="o-nhan-ban-ghi"
        />
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 text-[11px]"
          data-testid="nut-luu-ban-ghi"
          disabled={nhan.trim() === "" || luuM.isPending}
          onClick={() => void luu()}
        >
          {luuM.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Save className="h-3 w-3" />
          )}
          {t("twin3d.banGhi.luu")}
        </Button>
      </div>

      {/* ★ NT-3.5 — "đếm rỗng khác đếm bằng 0": đang tải hiện "—", không hiện
          "chưa có bản ghi nào". Hai câu đó nói về hai thế giới khác nhau. */}
      {dsQ.isLoading ? (
        <p className="mt-1.5 text-[10px] text-muted-foreground">—</p>
      ) : ds.length === 0 ? (
        <p className="mt-1.5 text-[10px] text-muted-foreground" data-testid="chua-co-ban-ghi">
          {t("twin3d.banGhi.chuaCo")}
        </p>
      ) : (
        <ul className="mt-1.5 space-y-1" data-testid="danh-sach-ban-ghi">
          {ds.map((b) => (
            <li
              key={b.id}
              className="flex flex-wrap items-center gap-1.5 rounded border px-1.5 py-1 text-[11px]"
              data-testid={`ban-ghi-${b.id}`}
            >
              <span className="font-medium">{b.nhan}</span>
              {/* ★ SỐ THỰC THỂ — "bản này có gì" là câu hỏi đầu tiên khi chọn
                  giữa hai bản ghi, và một cái tên không trả lời được nó. */}
              <span className="text-muted-foreground">
                {b.soDatCho} {t("twin3d.banGhi.thucThe")}
              </span>
              {b.daXuatBan ? (
                <Badge
                  variant="outline"
                  className="gap-1 text-[10px]"
                  data-testid={`da-xuat-ban-${b.id}`}
                >
                  <Check className="h-3 w-3 text-success" />
                  {t("twin3d.banGhi.daXuatBan")}
                </Badge>
              ) : null}

              <div className="ml-auto flex items-center gap-0.5">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  data-testid={`nut-khoi-phuc-${b.id}`}
                  aria-label={t("twin3d.banGhi.khoiPhuc")}
                  title={t("twin3d.banGhi.khoiPhuc")}
                  disabled={dangKhoiPhuc !== null}
                  onClick={() => void khoiPhuc(b.id)}
                >
                  {dangKhoiPhuc === b.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <History className="h-3 w-3" />
                  )}
                </Button>
                {!b.daXuatBan ? (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    data-testid={`nut-xuat-ban-${b.id}`}
                    aria-label={t("twin3d.banGhi.xuatBan")}
                    title={t("twin3d.banGhi.xuatBan")}
                    disabled={xuatM.isPending}
                    onClick={() => void xuatBan(b.id)}
                  >
                    <Upload className="h-3 w-3" />
                  </Button>
                ) : null}
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  data-testid={`nut-xoa-ban-ghi-${b.id}`}
                  aria-label={t("twin3d.banGhi.xoa")}
                  title={t("twin3d.banGhi.xoa")}
                  disabled={xoaM.isPending}
                  onClick={() => void xoa(b.id)}
                >
                  <Trash2 className="h-3 w-3 text-destructive" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default BanGhiBoCuc;
