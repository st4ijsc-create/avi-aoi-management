/**
 * NganMoPhong.tsx — §11 #30 (what-if năng suất) + #35 (phát lại workflow).
 *
 * Ngăn "Mô phỏng": mặt **SẼ THẾ NÀO NẾU** duy nhất của `/twin`. Mọi bề mặt khác
 * trên màn Vận hành trả lời *"nhà máy ĐANG thế nào"* — đó là digital **shadow**.
 * §12b.2 G-2 xếp what-if là *"mặt mô phỏng duy nhất trong cả 4 trang — đúng
 * nghĩa digital **twin**"*, và đây là chỗ nó sống.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ LỚP PHỦ DOM, `z-30`, `pointer-events-none` — BA THỨ ĐỀU LÀ SỐ ĐO (G41)
 * ════════════════════════════════════════════════════════════════════════════
 *   • **DOM chứ không chữ trong cảnh**: `troika-three-text` tốn **1 draw call
 *     mỗi nhãn**; cảnh này đo được **3 draw calls** (§4 trần 150, nhãn cap 30).
 *     Một bảng mô phỏng 12 dòng dựng trong cảnh là +12 draw call, và chữ sẽ
 *     xoay theo camera / bị máy che / nhỏ dần khi zoom ra — không đọc được đúng
 *     lúc cần đọc. Xem `BangKpiNoi.tsx` cùng khuôn (0 draw call).
 *   • **`z-30` chứ không `z-10`**: `LopNhan.tsx:180` render nhãn qua drei
 *     `<Html fullscreen zIndexRange={[20, 0]}>` ⇒ nhãn ở **z-index 20**. Bảng ở
 *     `z-10` sẽ **hiện ra đủ mà đọc không được** — chuỗi "SIM-L2-ICT · Unknown"
 *     phủ kín số. Lô J đã trả giá cho đúng lỗi này và bắt được bằng ẢNH, không
 *     phải bằng assertion.
 *   • **`pointer-events-none` trên khung ngoài**: canvas nằm dưới và nhận drag
 *     để xoay camera. Một lớp phủ "trong suốt" mà vẫn bắt sự kiện làm chết một
 *     mảng thao tác xoay — hỏng CÂM, không lỗi nào nổ. Riêng các control phải
 *     bấm được nên chúng bật lại `pointer-events-auto` cho CHÍNH chúng.
 *
 * ★ G63 KHÔNG áp dụng ở đây: ngăn này là DOM **anh em** của `<Canvas>`, không
 *   nằm trong cây three. Nó không có hoạt ảnh trong cảnh nào cần `useFrame`
 *   dưới `frameloop="demand"`; thanh phát lại chạy bằng `setInterval` của DOM.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ HONEST-NULL LÀ TOÀN BỘ GIÁ TRỊ CỦA NGĂN NÀY (G50 / NT-3.5)
 * ════════════════════════════════════════════════════════════════════════════
 * `digitalTwin.whatIf` là **hàm thuần**: nó tin tuyệt đối `cycleTimeSec` ta gửi
 * lên. Nên một ngăn mô phỏng "luôn có số" là một ngăn **luôn thuyết phục**, kể
 * cả khi nó dựng trên nhịp chuyền của tháng trước. Đo được trên CSDL này
 * (2026-09-08): hàng `line_balance` mới nhất của chuyền 1 là **2026-08-21 (18
 * ngày)** và chính hàng ấy có `avgCycleTimeMs` = **NULL**.
 *
 * ⇒ Ngăn hiện `—` **kèm lý do đọc được**, và `moPhongLogic.dungDauVaoWhatIf`
 *   phân biệt **sáu** lý do rời nhau. `?? 0` bị cấm ở đây không phải vì gu:
 *   "sản lượng 0 chiếc" và "chưa đo được nhịp" dẫn tới hai hành động khác nhau.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, FlaskConical, Pause, Play, SkipBack, SkipForward } from "lucide-react";

import { hienSo } from "./trungThucDuLieu";
import {
  coThoiLuong,
  datBuocPhatLai,
  mocBuocKeTiep,
  nhanTuoi,
  type BuocMoPhong,
  type KetQuaDungWhatIf,
  type LyDoKhongMoPhong,
} from "./moPhongLogic";

/** Kết quả `digitalTwin.whatIf` — đúng tập trường ngăn này vẽ. */
export interface KetQuaWhatIf {
  bottleneckStationId: number | null;
  bottleneckCycleSec: number;
  theoreticalUnits: number;
  effectiveUnits: number;
  lineBalanceRatePct: number;
  perStation: Array<{ stationId: number; effectiveCycleSec: number; utilizationPct: number }>;
}

/** Một workflow chọn được để phát lại (`orchestration.listWorkflows`). */
export interface WorkflowChon {
  id: number;
  ref: string;
  name: string | null;
}

/** Kết quả `orchestration.simulate` — tập trường ngăn này vẽ. */
export interface KetQuaPhatLai {
  ok: boolean;
  valid: boolean;
  errors: string[];
  timeline: BuocMoPhong[];
  warnings: Array<{ stepId: string; kind: string; message: string }>;
  totalDurationMs: number;
}

export interface NganMoPhongProps {
  mo: boolean;
  onDoiMo: (mo: boolean) => void;

  /* ── #30 what-if ─────────────────────────────────────────────────────── */
  /** Kết quả dựng đầu vào — CHẠY được hay lý do vì sao không (`moPhongLogic`). */
  dungDauVao: KetQuaDungWhatIf;
  horizonHours: number;
  onDoiHorizon: (gio: number) => void;
  heSo: number;
  onDoiHeSo: (h: number) => void;
  /** `undefined` = chưa bấm chạy / đang tải. */
  ketQua: KetQuaWhatIf | undefined;
  dangChayWhatIf: boolean;
  onChayWhatIf: () => void;
  /** Tên trạm theo id, để bảng không chỉ in `#7`. */
  tenTram: ReadonlyMap<number, string>;

  /* ── #35 phát lại workflow ───────────────────────────────────────────── */
  /**
   * `null` = KHÔNG có quyền `machine_monitoring/canView` ⇒ phần này **ẨN**
   * (luật dự án `nganXuLyLogic.ts:102-111`: thiếu quyền ⇒ ẨN, không disable).
   */
  workflow: readonly WorkflowChon[] | null;
  workflowRef: string | null;
  onDoiWorkflow: (ref: string | null) => void;
  phatLai: KetQuaPhatLai | undefined;
  dangChayPhatLai: boolean;
}

/** Nhịp tick của thanh phát lại (ms thực) và bước ảo mỗi tick. */
const NHIP_PHAT_MS = 100;

export function NganMoPhong(p: NganMoPhongProps) {
  const { t } = useTranslation();

  /* ── #35 — con trượt phát lại ─────────────────────────────────────────── */
  const tong = p.phatLai?.totalDurationMs ?? 0;
  const [moc, datMoc] = useState(0);
  const [dangPhat, datDangPhat] = useState(false);
  const buoc = p.phatLai?.timeline ?? [];

  /**
   * ★★★ HAI CHẾ ĐỘ, VÀ NGĂN PHẢI NÓI RÕ ĐANG DÙNG CHẾ ĐỘ NÀO.
   *
   * Đo được 2026-09-08 trên **cả 5** workflow thật của CSDL này: **4/5** trả
   * `totalDurationMs = 0` vì chúng gồm TOÀN `hitl_gate`, mà `simulate` để
   * `gateMs` mặc định 0 (đúng chủ ý — một cổng chờ NGƯỜI không có thời lượng
   * đoán được, `foeSimulator.ts:127`).
   *
   * ⇒ In `0.0s / 0.0s` cho một workflow **5 bước có thật** là lời khai sai: nó
   *   đọc y hệt "workflow rỗng". Chế độ theo BƯỚC in "bước 2/5" — đúng thứ đang
   *   đo được, không bịa thêm một con số giây nào.
   */
  const theoThoiGian = coThoiLuong(buoc, tong);
  /** Trần của con trượt: mili giây (theo thời gian) hoặc chỉ số bước cuối. */
  const tran = theoThoiGian ? tong : Math.max(0, buoc.length - 1);

  /*
   * ★ Đổi workflow ⇒ về mốc 0 và DỪNG. Nếu không, con trượt giữ mốc của
   *   workflow trước — trỏ vào một vị trí vô nghĩa trên dòng thời gian mới, và
   *   không có lỗi nào nổ.
   */
  useEffect(() => {
    datMoc(0);
    datDangPhat(false);
  }, [p.workflowRef]);

  /*
   * ★★★ HOẠT ẢNH PHẢI CÓ NGƯỜI LẬP LỊCH, VÀ PHẢI TỰ DỪNG Ở CUỐI.
   *   `setInterval` không tự biết dòng thời gian đã hết; thiếu nhánh dừng thì
   *   `moc` chạy quá `tong` và thanh tiến trình đứng ở 100 % trong khi cờ vẫn
   *   nói "đang phát" — nút Pause hiện ra cho một thứ không còn chạy.
   */
  const refTran = useRef(tran);
  refTran.current = tran;
  useEffect(() => {
    if (!dangPhat || tran <= 0) return;
    // ★ Theo thời gian: chia dòng thời gian thành ~60 nhịp. Theo bước: đi ĐÚNG
    //   một bước mỗi nhịp — cộng một phân số của chỉ số là vô nghĩa.
    const buocAo = theoThoiGian ? Math.max(1, Math.round(tran / 60)) : 1;
    const id = setInterval(
      () => {
        datMoc((m) => {
          const kt = m + buocAo;
          if (kt >= refTran.current) {
            datDangPhat(false);
            return refTran.current;
          }
          return kt;
        });
      },
      // Chế độ theo bước chạy chậm hơn: 5 bước × 100 ms là hết trước khi kịp nhìn.
      theoThoiGian ? NHIP_PHAT_MS : NHIP_PHAT_MS * 6,
    );
    return () => clearInterval(id);
  }, [dangPhat, tran, theoThoiGian]);

  const buocDaDat = useMemo(() => datBuocPhatLai(buoc, tong, moc), [buoc, tong, moc]);

  const dv = p.dungDauVao;
  /*
   * ★★★ `nhanTuoi` trả SỐ + ĐƠN VỊ, không trả chuỗi đã dịch — và đó là bản vá
   *   của một lỗi mà ẢNH TỰ CHỤP bắt được: bản đầu trả `"17 ngày"` rồi ghép vào
   *   khuôn tiếng Anh `"{{tuoi}} ago"`, in ra màn hình **"(17 ngày ago)"**. Mọi
   *   cổng đều xanh vì không phép đo nào hỏi chuỗi thuộc ngôn ngữ nào.
   *   Dịch ĐƠN VỊ ở đây, nơi `t()` biết ngôn ngữ đang dùng.
   */
  const tuoiRut = nhanTuoi(dv.tuoiMs);
  const tuoi = tuoiRut
    ? t(`twin3d.moPhong.donVi.${tuoiRut.donVi}`, "{{n}}", { n: tuoiRut.so })
    : null;

  return (
    /*
     * ★ `pointer-events-none` ở khung ngoài + `auto` cho từng control. Xem
     *   docblock đầu tệp: canvas dưới phải nhận được drag xoay camera.
     * ★ `z-30`: trên nhãn drei (z-index 20), dưới modal của vỏ (G41).
     */
    <div
      className="pointer-events-none absolute right-2 top-2 z-30 w-max min-w-[15rem] max-w-[min(24rem,calc(100%-1rem))]"
      data-testid="ngan-mo-phong"
      data-mo={p.mo ? "1" : "0"}
      data-chay-duoc={dv.chay ? "1" : "0"}
      data-ly-do={dv.chay ? "" : dv.lyDo}
    >
      <div className="rounded-md border bg-background/90 shadow-sm backdrop-blur-sm">
        {/* ── Đầu ngăn ──────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 px-2 py-1">
          <FlaskConical className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          <span className="text-xs font-semibold">
            {t("twin3d.moPhong.tieuDe", "Mô phỏng")}
          </span>
          <button
            type="button"
            className="pointer-events-auto ml-auto rounded p-0.5 text-muted-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2"
            data-testid="nut-thu-mo-phong"
            aria-expanded={p.mo}
            aria-controls="than-ngan-mo-phong"
            aria-label={
              p.mo
                ? t("twin3d.moPhong.thu", "Thu ngăn mô phỏng")
                : t("twin3d.moPhong.mo", "Mở ngăn mô phỏng")
            }
            title={
              p.mo
                ? t("twin3d.moPhong.thu", "Thu ngăn mô phỏng")
                : t("twin3d.moPhong.mo", "Mở ngăn mô phỏng")
            }
            onClick={() => p.onDoiMo(!p.mo)}
          >
            {p.mo ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>

        {/* ★ `hidden` chứ không unmount — giữ trạng thái con trượt khi thu lại. */}
        <div
          id="than-ngan-mo-phong"
          className="max-h-[70vh] space-y-3 overflow-y-auto border-t px-2 py-2"
          hidden={!p.mo}
        >
          {/* ══ #30 — WHAT-IF NĂNG SUẤT ═════════════════════════════════ */}
          <section aria-labelledby="tieu-de-what-if" className="space-y-1.5">
            <h3 id="tieu-de-what-if" className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("twin3d.moPhong.whatIf", "Năng suất what-if")}
            </h3>

            {/*
              ★★★ LÝ DO ĐỌC ĐƯỢC, KHÔNG PHẢI MỘT Ô TRỐNG.
                `dv.lyDo` có SÁU giá trị rời nhau, mỗi giá trị một câu — và mỗi
                câu dẫn tới một hành động khác nhau cho người vận hành. Gộp
                chúng thành "không có dữ liệu" là vứt đi đúng phần hữu ích.
            */}
            {!dv.chay ? (
              <p
                className="rounded border border-dashed px-2 py-1.5 text-[11px] leading-snug text-muted-foreground"
                data-testid="mo-phong-ly-do"
                data-ly-do={dv.lyDo}
              >
                <span className="mr-1 font-medium text-foreground">—</span>
                {t(NHAN_LY_DO[dv.lyDo][0], NHAN_LY_DO[dv.lyDo][1])}
                {/*
                  ★ TUỔI đi kèm khi biết được: "hết hạn" không kiểm chứng được
                    nếu không nói hết hạn BAO LÂU. Với `nhip_het_han` trên CSDL
                    này nó in "18 ngày" — con số đó là bằng chứng, không phải
                    trang trí.
                */}
                {tuoi ? (
                  <span className="ml-1 tabular-nums" data-testid="mo-phong-tuoi">
                    ({t("twin3d.moPhong.tuoi", "{{tuoi}} trước", { tuoi })})
                  </span>
                ) : null}
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="pointer-events-auto flex flex-col gap-0.5">
                    <span className="text-[10px] text-muted-foreground">
                      {t("twin3d.moPhong.horizon", "Khoảng (giờ)")}
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={720}
                      value={p.horizonHours}
                      onChange={(e) => p.onDoiHorizon(Number(e.target.value))}
                      className="h-6 w-16 rounded border bg-background px-1 text-xs tabular-nums"
                      data-testid="o-horizon"
                    />
                  </label>
                  <label className="pointer-events-auto flex flex-col gap-0.5">
                    <span className="text-[10px] text-muted-foreground">
                      {t("twin3d.moPhong.heSo", "Hệ số cycle")}
                    </span>
                    <input
                      type="number"
                      min={0.1}
                      max={10}
                      step={0.1}
                      value={p.heSo}
                      onChange={(e) => p.onDoiHeSo(Number(e.target.value))}
                      className="h-6 w-16 rounded border bg-background px-1 text-xs tabular-nums"
                      data-testid="o-he-so"
                    />
                  </label>
                  <button
                    type="button"
                    className="pointer-events-auto h-6 rounded border bg-primary px-2 text-xs font-medium text-primary-foreground hover:opacity-90 focus-visible:outline focus-visible:outline-2 disabled:opacity-50"
                    data-testid="nut-chay-what-if"
                    onClick={p.onChayWhatIf}
                    disabled={p.dangChayWhatIf}
                  >
                    {t("twin3d.moPhong.chay", "Chạy")}
                  </button>
                </div>

                {/*
                  ★ Nhịp là của CHUYỀN, không của từng trạm — phải nói ra.
                    `line_balance_metrics` đo theo chuyền, nên mọi trạm nhận cùng
                    một `cycleTimeSec` và bảng `perStation` sẽ trông "cân bằng
                    hoàn hảo" một cách giả tạo. Người xem phải biết điều đó.
                */}
                <p className="text-[10px] leading-snug text-muted-foreground" data-testid="mo-phong-nguon">
                  {t(
                    "twin3d.moPhong.nguon",
                    "Nhịp {{nhip}} s/chiếc của CẢ CHUYỀN (wip.lineBalance), áp chung cho {{n}} trạm{{tuoi}}",
                    {
                      nhip: dv.dauVao.stations[0]?.cycleTimeSec ?? 0,
                      n: dv.dauVao.stations.length,
                      tuoi: tuoi ? ` · ${tuoi}` : "",
                    },
                  )}
                </p>

                {p.ketQua ? (
                  <>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs" data-testid="what-if-ket-qua">
                      <O nhan={t("twin3d.moPhong.sanLuong", "Sản lượng")} gt={p.ketQua.effectiveUnits} khoa="sanLuong" />
                      <O nhan={t("twin3d.moPhong.lyThuyet", "Lý thuyết")} gt={p.ketQua.theoreticalUnits} khoa="lyThuyet" />
                      <O
                        nhan={t("twin3d.moPhong.canBang", "Cân bằng")}
                        gt={p.ketQua.lineBalanceRatePct}
                        donVi="%"
                        khoa="canBang"
                      />
                      <O
                        nhan={t("twin3d.moPhong.nutThat", "Nút thắt")}
                        /* ★ `bottleneckStationId` là NHÃN (id trạm), không phải
                             số đo — nên nó đi qua `hienSo` chứ không `?? 0`. */
                        gt={p.ketQua.bottleneckStationId}
                        khoa="nutThat"
                        tienTo="#"
                      />
                    </dl>

                    {/*
                      ★★★ §11.5 — BẢNG 2D SONG SONG là LUẬT của dự án: *"mọi lớp
                        phủ màu trên 3D phải có bảng xếp hạng 2D song song. Màu
                        không cho phép so sánh chính xác."* Ở đây không có lớp
                        phủ màu, nhưng bốn ô tổng hợp trên cũng không cho so
                        sánh giữa các trạm — bảng này là chỗ làm việc đó.
                    */}
                    <table className="w-full text-[11px]" data-testid="what-if-bang-tram">
                      <thead>
                        <tr className="text-muted-foreground">
                          <th className="text-left font-normal">{t("twin3d.moPhong.tram", "Trạm")}</th>
                          <th className="text-right font-normal">{t("twin3d.moPhong.cycle", "Cycle (s)")}</th>
                          <th className="text-right font-normal">{t("twin3d.moPhong.hieuSuat", "Hiệu suất")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.ketQua.perStation.map((s) => (
                          <tr
                            key={s.stationId}
                            data-testid={`what-if-tram-${s.stationId}`}
                            className={
                              s.stationId === p.ketQua!.bottleneckStationId
                                ? "font-medium text-destructive"
                                : ""
                            }
                          >
                            <td className="truncate">{p.tenTram.get(s.stationId) ?? `#${s.stationId}`}</td>
                            <td className="text-right tabular-nums">
                              {Math.round(s.effectiveCycleSec * 100) / 100}
                            </td>
                            <td className="text-right tabular-nums">{s.utilizationPct}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                ) : (
                  <p className="text-[11px] text-muted-foreground" data-testid="what-if-chua-chay">
                    {p.dangChayWhatIf
                      ? t("twin3d.moPhong.dangChay", "Đang mô phỏng…")
                      : t("twin3d.moPhong.bamChay", "Bấm Chạy để ước lượng năng suất.")}
                  </p>
                )}
              </>
            )}
          </section>

          {/* ══ #35 — PHÁT LẠI WORKFLOW ═════════════════════════════════ */}
          {/*
            ★ `workflow === null` ⇒ THIẾU QUYỀN ⇒ **ẨN CẢ MỤC**, không render
              rồi disable. Luật của dự án ghi ở `nganXuLyLogic.ts:102-111`:
              thiếu quyền ⇒ ẨN; bị chặn tạm thời ⇒ disable + giải thích.
              Mảng RỖNG thì khác — có quyền mà chưa có workflow nào, và câu đó
              phải nói ra chứ không được im lặng biến mất.
          */}
          {p.workflow !== null ? (
            <section aria-labelledby="tieu-de-phat-lai" className="space-y-1.5 border-t pt-2">
              <h3
                id="tieu-de-phat-lai"
                className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {t("twin3d.moPhong.phatLai", "Phát lại quy trình")}
              </h3>

              {p.workflow.length === 0 ? (
                <p className="text-[11px] text-muted-foreground" data-testid="phat-lai-rong">
                  {t("twin3d.moPhong.khongCoWorkflow", "Chưa có quy trình nào được triển khai.")}
                </p>
              ) : (
                <>
                  <select
                    className="pointer-events-auto h-6 w-full rounded border bg-background px-1 text-xs"
                    data-testid="chon-workflow"
                    aria-label={t("twin3d.moPhong.chonWorkflow", "Chọn quy trình để phát lại")}
                    value={p.workflowRef ?? ""}
                    onChange={(e) => p.onDoiWorkflow(e.target.value || null)}
                  >
                    <option value="">{t("twin3d.moPhong.chonWorkflow", "Chọn quy trình để phát lại")}</option>
                    {p.workflow.map((w) => (
                      <option key={w.id} value={w.ref}>
                        {w.name ?? w.ref}
                      </option>
                    ))}
                  </select>

                  {p.dangChayPhatLai ? (
                    <p className="text-[11px] text-muted-foreground">
                      {t("twin3d.moPhong.dangChay", "Đang mô phỏng…")}
                    </p>
                  ) : p.phatLai ? (
                    <>
                      {/*
                        ★ Sim KHÔNG ĐẠT phải nói ra ĐẬM: `orchestration.simulate`
                          trả `valid:false` + `errors[]` cho một định nghĩa hỏng,
                          và một dòng thời gian rỗng nhìn y hệt "workflow không
                          làm gì". Hai câu khác nhau.
                      */}
                      {!p.phatLai.valid || !p.phatLai.ok ? (
                        <p
                          className="rounded border border-destructive/50 px-1.5 py-1 text-[11px] text-destructive"
                          data-testid="phat-lai-loi"
                          role="alert"
                        >
                          {p.phatLai.errors[0] ??
                            p.phatLai.warnings[0]?.message ??
                            t("twin3d.moPhong.simKhongDat", "Mô phỏng không đạt.")}
                        </p>
                      ) : null}

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          className="pointer-events-auto rounded border p-0.5 hover:bg-accent focus-visible:outline focus-visible:outline-2"
                          data-testid="nut-lui-buoc"
                          aria-label={t("twin3d.moPhong.luiBuoc", "Lùi một bước")}
                          title={t("twin3d.moPhong.luiBuoc", "Lùi một bước")}
                          onClick={() => datMoc(mocBuocKeTiep(buoc, moc, -1, tong))}

                        >
                          <SkipBack className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          className="pointer-events-auto rounded border p-0.5 hover:bg-accent focus-visible:outline focus-visible:outline-2"
                          data-testid="nut-phat"
                          aria-pressed={dangPhat}
                          aria-label={
                            dangPhat
                              ? t("twin3d.moPhong.tam", "Tạm dừng")
                              : t("twin3d.moPhong.phat", "Phát")
                          }
                          title={
                            dangPhat
                              ? t("twin3d.moPhong.tam", "Tạm dừng")
                              : t("twin3d.moPhong.phat", "Phát")
                          }
                          onClick={() => datDangPhat((v) => !v)}
                        >
                          {dangPhat ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                        </button>
                        <button
                          type="button"
                          className="pointer-events-auto rounded border p-0.5 hover:bg-accent focus-visible:outline focus-visible:outline-2"
                          data-testid="nut-toi-buoc"
                          aria-label={t("twin3d.moPhong.toiBuoc", "Tới một bước")}
                          title={t("twin3d.moPhong.toiBuoc", "Tới một bước")}
                          onClick={() => datMoc(mocBuocKeTiep(buoc, moc, 1, tong))}
                        >
                          <SkipForward className="h-3 w-3" />
                        </button>
                        {/*
                          ★★★ KHÔNG in "0.0s / 0.0s" cho một workflow 5 bước có
                            thật — nó đọc y hệt "workflow rỗng". Đo được: 4/5
                            workflow của CSDL này gồm toàn `hitl_gate` và
                            `simulate` để `gateMs` mặc định 0 (đúng chủ ý). Chế
                            độ theo BƯỚC in đúng thứ đo được, không bịa ra giây.
                        */}
                        <span
                          className="ml-1 text-[10px] tabular-nums text-muted-foreground"
                          data-testid="phat-lai-moc"
                          data-che-do={theoThoiGian ? "thoi-gian" : "buoc"}
                        >
                          {theoThoiGian
                            ? `${(moc / 1000).toFixed(1)}s / ${(tong / 1000).toFixed(1)}s`
                            : t("twin3d.moPhong.buocTren", "bước {{i}}/{{n}}", {
                                i: Math.min(moc + 1, buoc.length),
                                n: buoc.length,
                              })}
                        </span>
                      </div>

                      {/*
                        ★★★ NÓI RA VÌ SAO KHÔNG CÓ GIÂY — nếu không, người xem
                          kết luận mô phỏng hỏng. `hitl_gate` là cổng chờ NGƯỜI;
                          `simulate` cố ý không đoán thời lượng cho nó
                          (`foeSimulator.ts:127`). Đó là một sự thật về quy
                          trình, không phải một khiếm khuyết của phép đo.
                      */}
                      {!theoThoiGian ? (
                        <p
                          className="text-[10px] leading-snug text-muted-foreground"
                          data-testid="phat-lai-khong-thoi-luong"
                        >
                          {t(
                            "twin3d.moPhong.khongThoiLuong",
                            "Quy trình này chỉ gồm cổng chờ người — mô phỏng không đoán thời lượng, nên xem theo BƯỚC.",
                          )}
                        </p>
                      ) : null}

                      {/*
                        ★ Thanh Gantt DOM. Mỗi bước một dòng — không xếp chồng —
                          vì `parallel` cho hai bước TRÙNG khoảng, và xếp chồng
                          thì bước sau che bước trước và người xem mất đúng
                          thông tin "hai máy chạy cùng lúc".
                      */}
                      <ul className="space-y-0.5" data-testid="phat-lai-gantt">
                        {buocDaDat.map((b) => (
                          <li key={b.stepId} className="flex items-center gap-1">
                            <span className="w-20 shrink-0 truncate text-[10px] text-muted-foreground" title={b.stepId}>
                              {b.command ?? b.stepType}
                            </span>
                            <span className="relative h-2 flex-1 rounded bg-muted">
                              <span
                                className={
                                  "absolute inset-y-0 rounded " +
                                  (b.dangChay
                                    ? "bg-primary"
                                    : b.daChay
                                      ? "bg-emerald-500/70"
                                      : "bg-muted-foreground/30")
                                }
                                style={{ left: `${b.traiPhanTram}%`, width: `${b.rongPhanTram}%` }}
                                data-testid={`gantt-${b.stepId}`}
                                data-da-chay={b.daChay ? "1" : "0"}
                                data-dang-chay={b.dangChay ? "1" : "0"}
                              />
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : p.workflowRef ? (
                    <p className="text-[11px] text-muted-foreground">
                      {t("twin3d.moPhong.dangChay", "Đang mô phỏng…")}
                    </p>
                  ) : null}
                </>
              )}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Một ô số — đi qua `hienSo` để `null` ra `—`, KHÔNG ra `0` (NT-3.5). */
function O({
  nhan,
  gt,
  donVi,
  khoa,
  tienTo,
}: {
  nhan: string;
  gt: number | null;
  donVi?: string;
  khoa: string;
  tienTo?: string;
}) {
  const co = gt != null && Number.isFinite(gt);
  return (
    <div className="contents">
      <dt className="truncate text-muted-foreground">{nhan}</dt>
      <dd className="text-right font-medium tabular-nums" data-testid={`mo-phong-${khoa}`}>
        {co && tienTo ? tienTo : ""}
        {hienSo(gt)}
        {donVi && co ? <span className="ml-0.5 text-[10px] text-muted-foreground">{donVi}</span> : null}
      </dd>
    </div>
  );
}

/**
 * Sáu lý do → khoá i18n + câu mặc định. Bảng tra ở MỘT chỗ (G12), và là
 * `Record` đầy đủ nên thêm một lý do vào `LyDoKhongMoPhong` mà quên câu cho nó
 * là **lỗi biên dịch**, không phải một ô trống lúc chạy.
 *
 * ★ Trả về cặp thay vì gọi `t` bên trong: `TFunction` của i18next là một
 *   overload set với kiểu trả về rộng hơn `string`, nên nhận nó làm tham số cần
 *   `as any` (xem `DigitalTwinDashboard.tsx:373`). Để `t` được gọi TẠI JSX —
 *   nơi nó đã có kiểu đúng — thì không cần ép kiểu ở đâu cả.
 */
const NHAN_LY_DO: Readonly<Record<LyDoKhongMoPhong, readonly [string, string]>> = {
  chua_chon_line: [
    "twin3d.moPhong.lyDo.chuaChonLine",
    "Chọn một chuyền để mô phỏng năng suất.",
  ],
  khong_co_tram: ["twin3d.moPhong.lyDo.khongCoTram", "Chuyền này chưa có trạm nào."],
  chua_do: ["twin3d.moPhong.lyDo.chuaDo", "Đang đọc nhịp chuyền…"],
  khong_co_ban_ghi: [
    "twin3d.moPhong.lyDo.khongCoBanGhi",
    "Chưa có bản ghi cân bằng chuyền nào cho chuyền này.",
  ],
  ban_ghi_khong_co_nhip: [
    "twin3d.moPhong.lyDo.banGhiKhongCoNhip",
    "Bản ghi cân bằng chuyền gần nhất không có nhịp (avgCycleTimeMs rỗng).",
  ],
  nhip_het_han: [
    "twin3d.moPhong.lyDo.nhipHetHan",
    "Nhịp chuyền gần nhất đã quá hạn 8 giờ — không dùng để mô phỏng.",
  ],
};
