/**
 * DaiCanhBao.tsx — dải cảnh báo hợp nhất của màn Vận hành (§11 #12/#13/#14/#15).
 *
 * ★ Toàn bộ LOGIC nằm ở `daiCanhBaoLogic.ts` (gộp seed+socket, dedupe theo thực
 *   thể, cap 100, tách nhóm >24h, chip lọc mức, lọc theo phạm vi nhánh) và có 35
 *   test node. Tệp này CHỈ vẽ và NỐI — `.tsx` không nằm trong `include` node của
 *   vitest, nên logic lọt vào đây là logic không đo được (§1.6).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ SPEC SAI — §11c.3 đã đo: `DaiCanhBao.tsx` KHÔNG TỒN TẠI trước đợt này
 * ════════════════════════════════════════════════════════════════════════════
 * §11.2 ghi #12-#14 có đích là `DaiCanhBao.tsx` như thể tệp đã có. Đo được (3
 * mẫu grep: trần, `./X`, `@/…/X`) ⇒ **0 kết quả**. Nguy hiểm hơn: §11c.3 ghi rõ
 * hệ quả — người đọc dễ đánh dấu xong nhầm cho `LopCanhBao.tsx`, vốn là **badge
 * 3D screen-space §10.3**, một tính năng KHÁC hẳn. Hai tệp cùng nói về "cảnh
 * báo" nhưng: `LopCanhBao` neo badge lên vật thể trong cảnh 3D; tệp này là danh
 * sách 2D có nhóm và bộ lọc. Đây là tệp MỚI, viết trong Đợt 8.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO DEDUPE LÀ TÍNH NĂNG, KHÔNG PHẢI TỐI ƯU — ĐO ĐƯỢC
 * ════════════════════════════════════════════════════════════════════════════
 * `server/_core/socket.ts:1392-1394` phát MỘT `andon:event` vào BA phòng
 * (`global`, `line:{id}`, `machine:{id}`). Một client nghe nhiều phòng nhận cùng
 * một raise 2-3 lần. Cộng với seed đổi id mỗi refetch (xem docblock
 * `daiCanhBaoLogic.ts`), một dải KHÔNG dedupe sẽ hiện cùng một sự cố thành 2-4
 * dòng — và người vận hành đếm dòng để ước lượng mức độ nghiêm trọng.
 *
 * ★ RB-8.3 — component KHÔNG gọi `t()` lên dữ liệu (tiêu đề cảnh báo đến từ DB,
 *   đã là câu người viết). `t()` chỉ dùng cho nhãn giao diện.
 * ★ §10.3 luật 2 — MÃ HOÁ DƯ THỪA: mỗi mức có hình dạng + màu + chữ. Màu đơn
 *   thuần không bao giờ là dấu hiệu duy nhất (~8% nam giới mù màu đỏ-lục).
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import {
  MUC_THEO_UU_TIEN,
  demTheoMuc,
  gopCanhBao,
  locTheoMuc,
  locTheoPhamVi,
  soNgayTonDong,
  tachNhom,
  type CanhBaoDai,
  type ChonMuc,
  type MucDoCanhBao,
  type TapPhamVi,
} from "./daiCanhBaoLogic";

/**
 * Mã hoá DƯ THỪA cho từng mức (§10.3 luật 2).
 *
 * ⚠ Ba token màu nằm trong bảng ≤ 7 mã của §10.2 (`--destructive`, `--warning`,
 *   `--info`, `--muted-foreground`) — KHÔNG thêm mã mới ở đây.
 * ★ Hình dạng CỐ Ý trùng với `LopCanhBao.tsx` (▲ đỏ, ◆ vàng, ● call): badge 3D
 *   và dòng 2D của cùng một cảnh báo phải trông là **một thứ**, nếu không người
 *   dùng không nối được cái họ thấy trên cảnh với cái họ thấy trên dải.
 */
const KIEU_MUC: Readonly<Record<MucDoCanhBao, { hinh: string; lop: string }>> = {
  red: { hinh: "▲", lop: "text-destructive" },
  call: { hinh: "●", lop: "text-info" },
  yellow: { hinh: "◆", lop: "text-warning" },
  green: { hinh: "■", lop: "text-muted-foreground" },
};

export interface DaiCanhBaoProps {
  /** Cảnh báo từ `andon.active` — đã chuẩn hoá bằng `chuanHoaHang`. */
  seed: readonly CanhBaoDai[];
  /** Cảnh báo đến qua socket `andon:event` — đã chuẩn hoá bằng `chuanHoaHang`. */
  song?: readonly CanhBaoDai[];
  /**
   * #15 — phạm vi nhánh đang chọn. `null` = không lọc.
   *
   * ★ `null` và một `TapPhamVi` RỖNG là hai thứ khác nhau: `null` = "chưa chọn
   *   nhánh nào" (hiện tất cả), rỗng = "nhánh này thật sự không có máy nào"
   *   (hiện `[]`). Gộp hai ca làm một là cách chắc chắn để dải hiện sai.
   */
  phamVi?: TapPhamVi | null;
  /** Chip mức đang chọn (state do người gọi giữ, để deep-link được). */
  chonMuc?: ChonMuc;
  onChonMuc?: (m: ChonMuc) => void;
  /**
   * Mốc "bây giờ" để tính tuổi (#13). THAM SỐ chứ không `Date.now()` bên trong:
   * người gọi đã có một nhịp tick sẵn, và đọc đồng hồ ở đây làm component vẽ ra
   * kết quả khác nhau giữa hai lần render cùng props.
   */
  bayGio: number;
  /** true = truy vấn còn đang chạy ⇒ hiện `—`, KHÔNG hiện "0 cảnh báo" (NT-3). */
  dangTai?: boolean;
  /**
   * true = truy vấn LỖI hoặc CHƯA TỪNG CHẠY ⇒ cũng hiện `—`.
   *
   * ★★★ G15 — một chỉ số có BA trạng thái: *đã đo* · *đang đo* · **chưa từng đo**.
   *   Dải rỗng vì `andon.active` trả 403 (hoặc vì `factoryId` null nên query
   *   `enabled:false`) trông y hệt "nhà máy đang yên ổn". Đó là lời nói dối tệ
   *   nhất một màn giám sát có thể nói.
   */
  khongDoDuoc?: boolean;
  onChonCanhBao?: (c: CanhBaoDai) => void;
}

function DongCanhBao({
  c,
  tonDong,
  bayGio,
  onChon,
  nhanTonDong,
  nhanAck,
}: {
  c: CanhBaoDai;
  tonDong: boolean;
  bayGio: number;
  onChon?: (c: CanhBaoDai) => void;
  nhanTonDong: (n: number) => string;
  nhanAck: string;
}) {
  const kieu = KIEU_MUC[c.muc];
  return (
    <li>
      <button
        type="button"
        data-testid={`canh-bao-${c.nguon}-${c.idNguon}`}
        data-muc={c.muc}
        data-pha={c.pha}
        data-ton-dong={tonDong ? "1" : "0"}
        className="flex w-full items-start gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-accent/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
        onClick={() => onChon?.(c)}
      >
        {/* Hình dạng + màu — mã hoá dư thừa (§10.3 luật 2). `aria-hidden` vì mức
            đã được nói bằng CHỮ ở `sr-only` bên dưới; đọc cả hai là lặp. */}
        <span aria-hidden className={cn("shrink-0 leading-4", kieu.lop)}>
          {kieu.hinh}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate">{c.tieuDe}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-1">
            {tonDong ? (
              <span className="rounded border border-warning/40 bg-warning/15 px-1 text-[10px] text-warning">
                {nhanTonDong(soNgayTonDong(c, bayGio))}
              </span>
            ) : null}
            {c.pha === "acknowledged" ? (
              <span className="rounded border border-border px-1 text-[10px] text-muted-foreground">
                {nhanAck}
              </span>
            ) : null}
          </span>
        </span>
      </button>
    </li>
  );
}

export function DaiCanhBao({
  seed,
  song,
  phamVi = null,
  chonMuc = "tat_ca",
  onChonMuc,
  bayGio,
  dangTai = false,
  khongDoDuoc = false,
  onChonCanhBao,
}: DaiCanhBaoProps) {
  const { t } = useTranslation();

  /**
   * ĐƯỜNG ỐNG — thứ tự bốn bước KHÔNG hoán vị được:
   *   gộp+dedupe+cap → lọc phạm vi (#15) → lọc mức (#14) → tách nhóm 24h (#13)
   *
   * ★ Cap phải nằm ở bước ĐẦU (trong `gopCanhBao`) chứ không sau khi lọc: trần
   *   là để chặn mảng lớn vô hạn từ socket, và áp nó sau bộ lọc nghĩa là bộ nhớ
   *   vẫn phình theo mọi cảnh báo đã nhận, chỉ phần hiển thị bị cắt.
   */
  const dai = useMemo(() => gopCanhBao(seed, song ?? []), [seed, song]);
  const theoPhamVi = useMemo(() => locTheoPhamVi(dai, phamVi), [dai, phamVi]);
  const dem = useMemo(() => demTheoMuc(theoPhamVi), [theoPhamVi]);
  const theoMuc = useMemo(() => locTheoMuc(theoPhamVi, chonMuc), [theoPhamVi, chonMuc]);
  const nhom = useMemo(() => tachNhom(theoMuc, bayGio), [theoMuc, bayGio]);

  // ★★★ NT-3/G15 — `—` khi CHƯA ĐO ĐƯỢC, `0` chỉ khi thật sự đã đo và bằng 0.
  const chuaDo = dangTai || khongDoDuoc;
  const nhanTong = chuaDo ? "—" : String(theoPhamVi.length);

  const nhanTonDong = (n: number) => t("twin3d.daiCanhBao.tonDongNgay", { n });

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="dai-canh-bao">
      <div className="flex items-center justify-between gap-2 border-b px-2 py-1.5">
        <span className="text-xs font-semibold">
          {t("twin3d.daiCanhBao.tieuDe")} ({nhanTong})
        </span>
        {phamVi !== null ? (
          <span
            className="rounded border border-border px-1 text-[10px] text-muted-foreground"
            data-testid="dai-theo-nhanh"
          >
            {t("twin3d.daiCanhBao.theoNhanh")}
          </span>
        ) : null}
      </div>

      {/* #14 — chip lọc mức độ. LUÔN HIỆN kể cả khi kết quả rỗng: ẩn chip đi thì
          người dùng lọc vào một mức không có gì rồi không còn nút nào để quay
          lại — bộ lọc tự nhốt chính nó. */}
      <div
        className="flex flex-wrap gap-1 border-b px-2 py-1.5"
        role="group"
        aria-label={t("twin3d.daiCanhBao.tieuDe")}
      >
        {(["tat_ca", ...MUC_THEO_UU_TIEN] as ChonMuc[]).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={chonMuc === m}
            data-testid={`chip-muc-${m}`}
            onClick={() => onChonMuc?.(m)}
            className={cn(
              "rounded border px-1.5 py-0.5 text-[11px]",
              chonMuc === m
                ? "border-primary/40 bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:bg-muted/60",
            )}
          >
            {t(`twin3d.daiCanhBao.${m === "tat_ca" ? "tatCa" : m}`)}
            {chuaDo ? null : <span className="ml-1 tabular-nums">{dem[m]}</span>}
          </button>
        ))}
      </div>

      {/* ★ Đợt 45 (mục 8) — ô cuộn RIÊNG của dải, có bóng mép (`cuon-doc-bong`, index.css) để hàng
          cuối mờ dần thay vì bị dải tab "Máy | Cây" cắt cụt; tiêu đề nhóm dính đầu ô khi cuộn. */}
      <div className="cuon-doc-bong min-h-0 flex-1 overflow-y-auto" data-testid="dai-canh-bao-cuon">
        {chuaDo ? (
          // Ba trạng thái, và đây là ô thứ ba (G15): KHÔNG in "0 cảnh báo".
          <p className="px-2 py-2 text-xs text-muted-foreground" data-testid="dai-chua-do">
            —
          </p>
        ) : theoPhamVi.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground" data-testid="dai-trong">
            {t("twin3d.daiCanhBao.trong")}
          </p>
        ) : theoMuc.length === 0 ? (
          // Khác hẳn ô trên: CÓ cảnh báo, chỉ là không ở mức đang lọc. Gộp hai câu
          // làm một sẽ nói "không có cảnh báo" trong khi nhà máy đang đỏ.
          <p className="px-2 py-2 text-xs text-muted-foreground" data-testid="dai-trong-muc">
            {t("twin3d.daiCanhBao.trongMuc")}
          </p>
        ) : (
          <>
            {nhom.homNay.length > 0 ? (
              <>
                <p
                  className="sticky top-0 z-10 bg-background px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                  data-testid="nhom-hom-nay"
                >
                  {t("twin3d.daiCanhBao.homNay")} ({nhom.homNay.length})
                </p>
                <ul>
                  {nhom.homNay.map((c) => (
                    <DongCanhBao
                      key={`${c.nguon}:${c.idNguon}`}
                      c={c}
                      tonDong={false}
                      bayGio={bayGio}
                      onChon={onChonCanhBao}
                      nhanTonDong={nhanTonDong}
                      nhanAck={t("twin3d.daiCanhBao.daAck")}
                    />
                  ))}
                </ul>
              </>
            ) : null}

            {/* #13 — nhóm tồn đọng. ISA-18.2 gọi đây là alarm "stale": phải PHƠI
                RA chứ không giấu, vì một cảnh báo treo 3 ngày là dấu hiệu quy
                trình xử lý hỏng, không phải một dòng cũ đáng cuộn qua. */}
            {nhom.tonDong.length > 0 ? (
              <>
                <p
                  className="sticky top-0 z-10 border-t bg-background px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-warning"
                  data-testid="nhom-ton-dong"
                >
                  {t("twin3d.daiCanhBao.tonDong")} ({nhom.tonDong.length})
                </p>
                <ul>
                  {nhom.tonDong.map((c) => (
                    <DongCanhBao
                      key={`${c.nguon}:${c.idNguon}`}
                      c={c}
                      tonDong
                      bayGio={bayGio}
                      onChon={onChonCanhBao}
                      nhanTonDong={nhanTonDong}
                      nhanAck={t("twin3d.daiCanhBao.daAck")}
                    />
                  ))}
                </ul>
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

export default DaiCanhBao;
