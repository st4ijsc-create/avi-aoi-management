import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ChevronDown, ChevronUp, OctagonAlert } from "lucide-react";
import {
  anDuoc,
  apDaAn,
  demViec,
  nhomNangNhat,
  tachAnToan,
  type MucViec,
  type NhomViec,
} from "./daiHopNhatLogic";

/**
 * ════════════════════════════════════════════════════════════════════════════
 * `DaiHopNhat` — MỘT dải 26 px thay cho TÁM dải 280 px (spec §13b 14.4)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Toàn bộ lý lẽ (vì sao gộp, vì sao KHÔNG bỏ banner nào, ba luật cứng) nằm ở
 * docblock của `daiHopNhatLogic.ts`. Tệp này chỉ là phần VẼ.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ★★★ HAI ĐIỀU CƠ HỌC QUYẾT ĐỊNH BỐ CỤC — ĐỌC TRƯỚC KHI SỬA
 * ────────────────────────────────────────────────────────────────────────────
 * 1. **Phần MỞ là `absolute`, không phải `shrink-0`.** Đây là toàn bộ điểm của
 *    mục 14.1.1 (*"đổi từ chia-đất sang chồng-lớp"*). Nếu phần mở là một khối
 *    trong dòng chảy, bấm [xem] sẽ **đẩy canvas co lại** — tức là ta vừa chép
 *    lại đúng căn bệnh, chỉ khác ở chỗ nó xảy ra sau một cú bấm.
 *    Khuôn đúng đã có sẵn trong repo: `BangKpiNoi` là lớp phủ DOM trên canvas,
 *    **0 draw call**.
 *
 * 2. **`z-30`, không phải `z-10`.** ★★★ G41: nhãn drei ở z-index **20**
 *    (`LopNhan.tsx` `zIndexRange={[20,0]}`). Một lớp phủ ở `z-10` sẽ **HIỆN RA
 *    ĐỦ MÀ ĐỌC KHÔNG ĐƯỢC** — nhãn 3D xuyên qua đè lên chữ. Lô J đã trả giá cho
 *    đúng lỗi này, và **chỉ ẢNH bắt được** (không lưới nào, không lỗi nào nổ).
 *    `NganMoPhong` cũng ở `z-30` vì cùng lý do.
 *
 * ★ G63 KHÔNG áp dụng: thành phần này nằm NGOÀI `<Canvas>`, không có `useFrame`,
 *   nên `frameloop="demand"` không làm nó đứng im.
 */

/** Màu theo nhóm — ISA-101: xám là mặc định, **màu chỉ cho bất thường**. */
const MAU_NHOM: Readonly<Record<NhomViec, string>> = {
  // Đỏ bão hoà: màu bão hoà DUY NHẤT, và nó dành cho an toàn.
  anToan: "border-destructive bg-destructive/10 text-destructive",
  duLieu: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  phamVi: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
};

const CHAM_NHOM: Readonly<Record<NhomViec, string>> = {
  anToan: "bg-destructive",
  duLieu: "bg-amber-500",
  phamVi: "bg-sky-500",
};

export interface DaiHopNhatProps {
  muc: readonly MucViec[];
  /** Tra khoá `hanhDong.khoa` → hàm chạy. Khoá lạ ⇒ nút KHÔNG hiện. */
  hanhDong?: Readonly<Record<string, () => void>>;
}

export default function DaiHopNhat({ muc, hanhDong }: DaiHopNhatProps) {
  const { t } = useTranslation();
  const [mo, datMo] = useState(false);
  /** ★ `[ẩn]` chỉ sống trong PHIÊN này — không ghi server (luật 14.4.3). */
  const [daAn, datDaAn] = useState<ReadonlySet<string>>(() => new Set<string>());

  const sauKhiAn = useMemo(() => apDaAn(muc, daAn), [muc, daAn]);
  const { anToan, gopDuoc } = useMemo(() => tachAnToan(sauKhiAn), [sauKhiAn]);
  const so = useMemo(() => demViec(sauKhiAn), [sauKhiAn]);
  const nhomChinh = useMemo(() => nhomNangNhat(sauKhiAn), [sauKhiAn]);

  /**
   * ★★★ IM LẶNG THÌ CHIẾM 0 px — không phải 26 px.
   *
   * Trả `null` ở đây là phần lớn con số của đợt này: ca thường gặp nhất của
   * `/twin` là "không có việc gì", và một dải rỗng luôn hiện sẽ ăn 26 px của
   * canvas mãi mãi mà không nói gì.
   */
  if (so === 0) return null;

  const veMuc = (m: MucViec, trongDaiRieng: boolean) => (
    <div
      key={m.testId}
      className={
        "flex items-center gap-2 px-3 py-1 text-[11px] " +
        (trongDaiRieng ? "font-medium " : "border-t first:border-t-0 ") +
        MAU_NHOM[m.nhom]
      }
      /* ★★★ LUẬT CỨNG 3 — `data-testid` NGUYÊN VĂN của banner cũ. Đổi bố cục
         KHÔNG được đổi hợp đồng đo (bánh cóc e2e sẵn có tra đúng chuỗi này). */
      data-testid={m.testId}
      data-nhom={m.nhom}
      {...Object.fromEntries(Object.entries(m.dataPhu ?? {}).map(([k, v]) => [k, String(v)]))}
      {...(m.nhom === "anToan" ? { role: "alert" as const } : {})}
    >
      {m.nhom === "anToan" ? (
        <OctagonAlert className="h-3.5 w-3.5 shrink-0" />
      ) : (
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      )}
      <span className="min-w-0">{m.noiDung}</span>
      {m.hanhDong && hanhDong?.[m.hanhDong.khoa] ? (
        <button
          type="button"
          className="shrink-0 underline"
          data-testid={`${m.testId}-hanh-dong`}
          onClick={hanhDong[m.hanhDong.khoa]}
        >
          {m.hanhDong.nhan}
        </button>
      ) : null}
      {anDuoc(m) ? (
        <button
          type="button"
          className="ml-auto shrink-0 underline opacity-70 hover:opacity-100"
          data-testid={`${m.testId}-an`}
          onClick={() => datDaAn((cu) => new Set([...cu, m.testId]))}
        >
          {t("twin3d.daiHopNhat.an", "ẩn")}
        </button>
      ) : null}
    </div>
  );

  return (
    <>
      {/*
        ── ★★★ LUẬT CỨNG 1 — DẢI AN TOÀN HIỆN RIÊNG, ĐỎ, LUÔN MỞ ────────────
        KHÔNG gộp, KHÔNG thu, KHÔNG ẩn được. An toàn không xếp hàng sau bố cục
        (nguyên văn `TwinVanHanh.tsx:2370-2374`). Nó nằm TRONG dòng chảy (một
        dải `shrink-0` thật) chứ không nổi đè: một cảnh báo E-STOP bị canvas
        cuộn qua là một cảnh báo không tồn tại.
      */}
      {anToan.map((m) => veMuc(m, true))}

      {/* ── DẢI HỢP NHẤT — 26 px, và đây là thứ duy nhất còn lại ────────── */}
      {gopDuoc.length > 0 ? (
        <div className="relative shrink-0" data-testid="dai-hop-nhat-khung">
          <div
            className={
              "flex h-[26px] items-center gap-2 border-b px-3 text-[11px] " +
              MAU_NHOM[nhomChinh ?? "duLieu"]
            }
            data-testid="dai-hop-nhat"
            data-so-viec={so}
            data-mo={mo ? "1" : "0"}
          >
            <span
              className={"h-1.5 w-1.5 shrink-0 rounded-full " + CHAM_NHOM[nhomChinh ?? "duLieu"]}
              aria-hidden
            />
            <span className="min-w-0 truncate">
              {/* ★ Đợt 36: `count` ⇒ `tomTat_one`/`tomTat_other` (en) — "1 things to know". */}
              {t("twin3d.daiHopNhat.tomTat", "{{so}} việc cần biết", { so, count: so })}
            </span>
            <button
              type="button"
              className="ml-auto flex shrink-0 items-center gap-1 underline"
              data-testid="nut-mo-dai-hop-nhat"
              aria-expanded={mo}
              onClick={() => datMo((v) => !v)}
            >
              {mo ? t("common.hide", "ẩn") : t("common.view", "xem")}
              {mo ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          </div>

          {/*
            ★★★ `absolute` + `z-30` — xem HAI ĐIỀU CƠ HỌC ở docblock đầu tệp.
            Phần mở NỔI ĐÈ lên canvas; canvas KHÔNG co lại một pixel nào.
          */}
          {mo ? (
            <div
              className="absolute inset-x-0 top-full z-30 border-b bg-background/95 shadow-lg backdrop-blur-sm"
              data-testid="dai-hop-nhat-chi-tiet"
            >
              {gopDuoc.map((m) => veMuc(m, false))}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
