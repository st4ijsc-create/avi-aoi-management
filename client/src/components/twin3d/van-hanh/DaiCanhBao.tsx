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
  /**
   * ★★★ TASK 10 — XỬ LÝ **TẠI CHỖ**, đường THỨ HAI cạnh `onChonCanhBao`.
   *
   * ════════════════════════════════════════════════════════════════════════
   * VÌ SAO PHẢI LÀ MỘT ĐƯỜNG THỨ HAI, KHÔNG PHẢI ĐỔI ĐƯỜNG CŨ
   * ════════════════════════════════════════════════════════════════════════
   * Đo được trên `/twin`: ngăn xử lý render **0 nút với mọi vai**, vì sau QĐ-23
   * mọi cú bấm máy RỜI trang sang `/twin/may/:id` (`dichManRieng` redirect cả
   * `?chon=machine:`), nên `machineIdChon` của thân `/twin` luôn `null`. Một
   * tầng 21 cảnh báo là 21 lần đi-về, đúng ngược với mục tiêu tài liệu đặt ra
   * (*"hành động ở ngăn bên phải, ngữ cảnh ở cảnh 3D bên trái"*).
   *
   * QĐ-23 là quyết định của chủ dự án và **không được đụng** (lưới
   * `cuaVaoTwin.unit.test.ts` ghim nguyên văn `onChonCanhBao`). Nên bấm DÒNG
   * vẫn mở màn Máy 3D như cũ; nút này mở ngăn xử lý NGAY TẠI `/twin`.
   *
   * ⚠ `undefined` ⇒ KHÔNG render nút nào. Một nút không làm gì là chế độ hỏng
   *   câm, và một nút hứa "xử lý" trên dòng KHÔNG gắn máy cũng vậy — nên nút
   *   chỉ hiện khi `c.machineId !== null`.
   */
  onXuLyTaiCho?: (c: CanhBaoDai) => void;
  /**
   * ★★★ NHÃN PHẠM VI — câu người dùng đọc được, nói con số `(N)` ở tiêu đề đang
   * đếm trên mẫu số nào.
   *
   * ════════════════════════════════════════════════════════════════════════
   * VÌ SAO CẦN: `andon.active` **không nhận `factoryId`** (`andonRouter.ts`),
   * nên dải này đếm cảnh báo của MỌI nhà máy trong phạm vi tài khoản, trong khi
   * cảnh 3D bên trái vẽ đúng MỘT nhà máy. Vai giám đốc thấy "Cảnh báo (55)" của
   * ba công ty cạnh một cảnh một nhà máy và không có câu nào nói ra điều đó.
   *
   * Chủ dự án chốt (2026-09-15): **KHÔNG đổi cách đếm, chỉ thêm nhãn.** Thu hẹp
   * phép đếm theo cảnh sẽ giấu mất cảnh báo của nhà máy khác — tệ hơn hẳn một
   * con số rộng đã được khai rõ.
   *
   * ⚠ `null`/`undefined` ⇒ KHÔNG in dòng trống (NT-3.5: rỗng khác 0).
   */
  nhanPhamVi?: string | null;
}

function DongCanhBao({
  c,
  tonDong,
  bayGio,
  onChon,
  onXuLy,
  nhanTonDong,
  nhanAck,
  nhanXuLy,
}: {
  c: CanhBaoDai;
  tonDong: boolean;
  bayGio: number;
  onChon?: (c: CanhBaoDai) => void;
  onXuLy?: (c: CanhBaoDai) => void;
  nhanTonDong: (n: number) => string;
  nhanAck: string;
  nhanXuLy: string;
}) {
  const kieu = KIEU_MUC[c.muc];
  /**
   * ★★★ PH-30 — DÒNG PHỤ DANH TÍNH. Chỉ vẽ khi CÓ ít nhất một ô.
   *
   * Hai ô `null` phải cho đúng một dòng tiêu đề như trước, không phải một dòng
   * phụ rỗng: panel trái có trần chiều cao `max-h-[328px]` tính theo SỐ HÀNG
   * (docblock chỗ dựng ở `TwinVanHanh.tsx`), nên một dòng trống ở mọi hàng ăn
   * mất đúng những hàng mà mục 13 vừa mua được.
   *
   * ★ `?? undefined` ở `data-*` chứ không `?? ""`: React BỎ HẲN thuộc tính khi
   *   giá trị `undefined`, nên "chưa biết" đọc từ DOM là *thuộc tính vắng mặt*
   *   chứ không phải chuỗi rỗng — phép đo nghiệm thu phân biệt được hai ca.
   *
   * ⚠⚠ `data-testid` của dòng phụ KHÔNG được bắt đầu bằng `canh-bao-`. Bộ đếm
   *   dòng của lưới là `queryAllByTestId(/^canh-bao-/)`; một tiền tố trùng làm
   *   nó đếm cả dòng phụ và khai **gấp đôi** số cảnh báo đang hiện. Bản viết
   *   đầu của mục này dùng `canh-bao-danh-tinh-…` và lưới cũ đã kêu ngay
   *   (15 → 30) — giữ lại ghi chú vì cái bẫy nằm ở phía người đặt tên, không
   *   phải ở phía lưới.
   */
  const coDanhTinh = c.maMay !== null || c.tenNhaMay !== null;
  /*
   * ★★★ TASK 10 — nút "xử lý tại chỗ" là ANH EM của nút dòng, KHÔNG lồng trong nó.
   *
   * Nút trong nút là HTML không hợp lệ (trình duyệt tự tách cây, và bấm con sẽ
   * kích hoạt cả cha) — mà bấm cha ở đây nghĩa là RỜI TRANG, đúng thứ nút này
   * sinh ra để tránh. Nên `<li>` thành một hàng flex: dòng `flex-1`, nút bên phải.
   *
   * ⚠⚠ `data-testid` KHÔNG được bắt đầu bằng `canh-bao-`: bộ đếm dòng của mọi
   *   lưới cũ là `queryAllByTestId(/^canh-bao-/)`, một tiền tố trùng sẽ khai gấp
   *   đôi số cảnh báo đang hiện (đúng cái bẫy mà PH-30 đã dính ở dòng phụ).
   */
  const coXuLy = onXuLy !== undefined && c.machineId !== null;
  return (
    <li className="flex items-start">
      <button
        type="button"
        data-testid={`canh-bao-${c.nguon}-${c.idNguon}`}
        data-muc={c.muc}
        data-pha={c.pha}
        data-ton-dong={tonDong ? "1" : "0"}
        data-ma-may={c.maMay ?? undefined}
        data-nha-may={c.tenNhaMay ?? undefined}
        className="flex min-w-0 flex-1 items-start gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-accent/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
        onClick={() => onChon?.(c)}
      >
        {/* Hình dạng + màu — mã hoá dư thừa (§10.3 luật 2). `aria-hidden` vì mức
            đã được nói bằng CHỮ ở `sr-only` bên dưới; đọc cả hai là lặp. */}
        <span aria-hidden className={cn("shrink-0 leading-4", kieu.lop)}>
          {kieu.hinh}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate">{c.tieuDe}</span>
          {/* RB-8.3 — hai ô này là DỮ LIỆU (`machines.ma`, `factories.name`),
              KHÔNG phải nhãn giao diện ⇒ không `t()`. Dấu phân cách `·` chỉ vẽ
              khi CẢ HAI ô có chữ, nếu không nó đứng trơ ở đầu/cuối dòng và
              trông như dữ liệu bị cắt. */}
          {coDanhTinh ? (
            <span
              className="block truncate text-[10px] text-text-2"
              data-testid={`danh-tinh-${c.nguon}-${c.idNguon}`}
            >
              {c.maMay}
              {c.maMay !== null && c.tenNhaMay !== null ? " · " : null}
              {c.tenNhaMay}
            </span>
          ) : null}
          <span className="mt-0.5 flex flex-wrap items-center gap-1">
            {tonDong ? (
              <span className="rounded border border-warning/40 bg-warning/15 px-1 text-[10px] text-warning">
                {nhanTonDong(soNgayTonDong(c, bayGio))}
              </span>
            ) : null}
            {c.pha === "acknowledged" ? (
              <span className="rounded border border-border px-1 text-[10px] text-text-2">
                {nhanAck}
              </span>
            ) : null}
          </span>
        </span>
      </button>
      {coXuLy ? (
        <button
          type="button"
          data-testid={`xu-ly-${c.nguon}-${c.idNguon}`}
          data-machine-id={c.machineId ?? undefined}
          className="mr-1 mt-1 shrink-0 rounded border border-border px-1 py-0.5 text-[10px] leading-4 text-text-2 hover:bg-accent hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
          /* Mã hoá dư thừa: CHỮ đọc được, không chỉ một icon — §10.3 luật 2. */
          title={nhanXuLy}
          onClick={() => onXuLy?.(c)}
        >
          {nhanXuLy}
        </button>
      ) : null}
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
  onXuLyTaiCho,
  nhanPhamVi = null,
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
  /*
   * ⚠ KHÔNG truyền `defaultValue` chuỗi làm đối số thứ hai trong TỆP NÀY: mọi
   *   `t()` ở đây theo khuôn `t(khoa)` / `t(khoa, {n})`, và lưới DOM của nó mock
   *   `t` bằng `o && "n" in o` — một chuỗi ở vị trí ấy làm `in` ném lỗi và 38 ca
   *   đỏ cùng lúc. Khoá được thêm đủ ba locale nên không có ca "thiếu bản dịch".
   */
  const nhanXuLy = t("twin3d.daiCanhBao.xuLyTaiCho");

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="dai-canh-bao">
      <div className="flex items-center justify-between gap-2 border-b px-2 py-1.5">
        <span className="text-xs font-semibold">
          {t("twin3d.daiCanhBao.tieuDe")} ({nhanTong})
        </span>
        {phamVi !== null ? (
          <span
            className="rounded border border-border px-1 text-[10px] text-text-2"
            data-testid="dai-theo-nhanh"
          >
            {t("twin3d.daiCanhBao.theoNhanh")}
          </span>
        ) : null}
      </div>

      {/*
        ★★★ NHÃN PHẠM VI — con số `(N)` ở trên nói về TẬP NÀO.

        Đây là dòng CHỮ, không phải một `data-*`: người vận hành đọc màn hình,
        không đọc DOM. Nó đứng ngay dưới con số vì hai thứ chỉ có nghĩa cùng nhau
        — một mẫu số đặt ở chỗ khác trên màn là một mẫu số không ai ghép lại.
      */}
      {nhanPhamVi ? (
        <p
          className="truncate border-b px-2 pb-1 text-[10px] text-text-2"
          data-testid="dai-pham-vi"
          title={nhanPhamVi}
        >
          {nhanPhamVi}
        </p>
      ) : null}

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
          <p className="px-2 py-2 text-xs text-text-2" data-testid="dai-chua-do">
            —
          </p>
        ) : theoPhamVi.length === 0 ? (
          <p className="px-2 py-2 text-xs text-text-2" data-testid="dai-trong">
            {t("twin3d.daiCanhBao.trong")}
          </p>
        ) : theoMuc.length === 0 ? (
          // Khác hẳn ô trên: CÓ cảnh báo, chỉ là không ở mức đang lọc. Gộp hai câu
          // làm một sẽ nói "không có cảnh báo" trong khi nhà máy đang đỏ.
          <p className="px-2 py-2 text-xs text-text-2" data-testid="dai-trong-muc">
            {t("twin3d.daiCanhBao.trongMuc")}
          </p>
        ) : (
          <>
            {nhom.homNay.length > 0 ? (
              <>
                <p
                  className="sticky top-0 z-10 bg-background px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-2"
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
                      onXuLy={onXuLyTaiCho}
                      nhanTonDong={nhanTonDong}
                      nhanAck={t("twin3d.daiCanhBao.daAck")}
                      nhanXuLy={nhanXuLy}
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
                      onXuLy={onXuLyTaiCho}
                      nhanTonDong={nhanTonDong}
                      nhanAck={t("twin3d.daiCanhBao.daAck")}
                      nhanXuLy={nhanXuLy}
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
