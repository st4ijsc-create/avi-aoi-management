/**
 * BoChonNapUI.tsx — BA Ô CHỌN Nhà máy / Toà / Tầng (Đợt 10 lô F, mục F1).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ CHỦ SỞ HỮU YÊU CẦU NGUYÊN VĂN: *"chỉ cho phép load từng toà 1, cho thêm
 *     ô chọn toà"*. NHƯNG LÝ DO KHÔNG PHẢI LÝ DO HỌ NGHĨ.
 * ════════════════════════════════════════════════════════════════════════════
 * Câu đó đi kèm giả định "xem cùng lúc 7 toà bị vượt quá" (§11e.2). Lô E đo
 * được ở quy mô thật (549 máy/tầng, 4 nhà máy): **3 draw call, 57–59 FPS** —
 * ngân sách §4 (≤150 call, ≥30 FPS) đạt rộng rãi. GPU **không phải** nút thắt.
 *
 * ⇒ Ô chọn này KHÔNG mang ngưỡng chặn theo số máy, và không được mang. Nó tồn
 *   tại vì lý do khác hẳn: trước bản này màn `/twin` nạp `factories[0]` →
 *   `toaNha[0]` → `tangs[0]` — ba chỉ số `[0]` viết cứng — nên **không có lối
 *   vào nào** tới tầng thứ hai, toà thứ hai, nhà máy thứ hai. Đây là màn DUY
 *   NHẤT trong hệ có **0 `<select>`** (đối chứng `FactoryFloorEditor.tsx`: 9).
 *
 * Thêm một giới hạn "cho an toàn" ở đây là bịa ra ràng buộc mà phép đo đã bác
 * bỏ — đúng lớp lỗi mà brief lô F gọi tên: *"Đừng thêm giới hạn giả."*
 *
 * ★ `<select>` DOM thật, KHÔNG phải combobox tự vẽ: §9.9 đòi mọi hành động làm
 *   được bằng bàn phím và đọc được bằng trình đọc màn hình. `<select>` gốc cho
 *   cả hai miễn phí và đúng trên mọi nền tảng; một `div[role=combobox]` phải tự
 *   cài lại toàn bộ và thường sai ở đúng chỗ không ai kiểm.
 */
import { useTranslation } from "react-i18next";

import type { MucChon } from "./boChonNap";

export interface BoChonNapUIProps {
  nhaMay: readonly MucChon[];
  toaNha: readonly MucChon[];
  tang: readonly MucChon[];
  nhaMayId: number | null;
  toaNhaId: number | null;
  tangId: number | null;
  onDoiNhaMay: (id: number) => void;
  onDoiToaNha: (id: number) => void;
  onDoiTang: (id: number) => void;
  /** Đang tải danh sách ⇒ khoá ô lại, KHÔNG hiện một danh sách rỗng gây hiểu nhầm. */
  dangTai?: boolean;
  /** ★ Đợt 45 (mục 2) — header gọn (< 1100 px): ô chọn hẹp hơn (6,5 rem thay 8 rem). */
  gon?: boolean;
}

/** Một ô chọn. Tách ra để ba ô không thể lệch nhau về hành vi/ a11y. */
function OChon({
  nhan,
  testid,
  muc,
  giaTri,
  onDoi,
  dangTai,
  gon,
}: {
  nhan: string;
  testid: string;
  muc: readonly MucChon[];
  giaTri: number | null;
  onDoi: (id: number) => void;
  dangTai: boolean;
  gon: boolean;
}) {
  /*
   * ★★★ MỘT Ô CHỌN CÓ ≤ 1 MỤC VẪN PHẢI HIỆN, KHÔNG ĐƯỢC ẨN.
   *
   * Ẩn nó đi khi nhà máy chỉ có một toà là "tối ưu" hấp dẫn — và là cách chắc
   * chắn nhất để lỗi `[0]` quay lại mà không ai thấy: người dùng không có cách
   * nào phân biệt "hệ chỉ có một toà" với "hệ có bốn toà nhưng UI chỉ nạp toà
   * đầu". Đó chính xác là thứ đã xảy ra suốt các đợt trước.
   *
   * ⇒ Ô luôn hiện; nó tự `disabled` khi không có gì để chọn, và nhãn nói rõ.
   */
  const rong = muc.length === 0;
  return (
    /*
     * ════════════════════════════════════════════════════════════════════════
     * ★★★ NHÃN CHỮ Ở `sr-only`, KHÔNG BỊ XOÁ — VÀ ĐÂY LÀ MỘT PHÉP ĐO, KHÔNG
     *     PHẢI MỘT SỞ THÍCH
     * ════════════════════════════════════════════════════════════════════════
     * Đo được (Playwright 1280×720): ba ô kèm nhãn chữ rộng **437 px**; cộng
     * breadcrumb 226 + cụm phải 335 = **998 px** trong một header rộng **968**
     * ⇒ header XUỐNG DÒNG, cao **85 px** thay vì 48. Ba mươi bảy pixel đó trừ
     * thẳng vào canvas — tức bản vá **F1 tự ăn mất một phần bản vá F4**.
     *
     * ⇒ Bỏ nhãn NHÌN THẤY, giữ nhãn NGHE ĐƯỢC: `aria-label` trên `<select>` vẫn
     *   nói đủ tên cho trình đọc màn hình (§9.9), và với mắt thường mỗi ô đã tự
     *   mô tả bằng nội dung của nó ("Tầng 1", tên toà, tên nhà máy) — cùng ba ô
     *   xếp cạnh nhau theo thứ tự phân cấp.
     * ⚠ Ai sửa lại thành nhãn hiện: ĐO `header.height` sau đó. Nó phải ở 48.
     */
    <label className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
      <span className="sr-only">{nhan}</span>
      <select
        /* ★ Đợt 45 (mục 2) — chế độ GỌN (header < 1100 px): ô hẹp hơn để breadcrumb còn chỗ; vẫn 3 ô. */
        className={
          "h-6 min-w-0 truncate rounded border bg-background px-1 py-0 text-[11px] text-foreground disabled:opacity-60 " +
          (gon ? "max-w-[6.5rem]" : "max-w-[8rem]")
        }
        data-testid={testid}
        data-so-muc={muc.length}
        aria-label={nhan}
        /* ★ Đợt 47 (N6) — ô hẹp (6,5–8 rem) cắt tên toà/nhà máy dài: `title` = tên đầy đủ của mục đang chọn. */
        title={muc.find((m) => m.id === giaTri)?.nhan ?? nhan}
        disabled={dangTai || rong}
        value={giaTri ?? ""}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isSafeInteger(n) && n > 0) onDoi(n);
        }}
      >
        {/*
          Ô rỗng CHỈ hiện khi thật sự chưa có giá trị — không phải một mục
          "Tất cả" giả: `canhThietKe` không có chế độ "mọi tầng", nên một mục
          như thế sẽ hứa điều đường dữ liệu không làm được (G7).
        */}
        {giaTri === null ? <option value="">—</option> : null}
        {muc.map((m) => (
          <option key={m.id} value={m.id}>
            {m.nhan}
          </option>
        ))}
      </select>
    </label>
  );
}

export function BoChonNapUI(props: BoChonNapUIProps) {
  const { t } = useTranslation();
  const dangTai = props.dangTai ?? false;
  const gon = props.gon ?? false;
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="bo-chon-nap">
      <OChon
        nhan={t("twin3d.vanHanh.chonNhaMay", "Nhà máy")}
        testid="chon-nha-may"
        muc={props.nhaMay}
        giaTri={props.nhaMayId}
        onDoi={props.onDoiNhaMay}
        dangTai={dangTai}
        gon={gon}
      />
      <OChon
        nhan={t("twin3d.vanHanh.chonToaNha", "Toà")}
        testid="chon-toa-nha"
        muc={props.toaNha}
        giaTri={props.toaNhaId}
        onDoi={props.onDoiToaNha}
        dangTai={dangTai}
        gon={gon}
      />
      <OChon
        nhan={t("twin3d.vanHanh.chonTang", "Tầng")}
        testid="chon-tang"
        muc={props.tang}
        giaTri={props.tangId}
        onDoi={props.onDoiTang}
        dangTai={dangTai}
        gon={gon}
      />
    </div>
  );
}
