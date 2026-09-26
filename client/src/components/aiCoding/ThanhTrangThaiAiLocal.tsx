/**
 * ★★★ G14 (audit 2026-09-22 · UI) — **THANH TRẠNG THÁI CỖ MÁY AI LOCAL.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VẤN ĐỀ NÀY GIẢI: "AI HÔM NAY DỐT HƠN" LÀ MỘT CÂU KHÔNG TRẢ LỜI ĐƯỢC
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Với Claude/Cursor, suy luận chạy ở rất xa và người dùng không cần biết gì về nó. Với AI **local**
 * thì ngược hẳn: model nằm trên cái card trong máy này, và **mọi cách nó hỏng đều im lặng**.
 *
 * Ba sự cố ĐÃ ĐO ĐƯỢC trong chính đợt audit này, trên chính máy này:
 *   1. `llama-server` chết giữa chừng — đường ống vẫn trả lời, chỉ tệ đi. Suýt nữa "0/9 đạt +
 *      79 lượt OOM" được ghi thành khuyết tật của **model** thay vì của **máy**.
 *   2. Một tiến trình ngoài chiếm 23,5 GB VRAM ⇒ broker hứa 22 GiB trên card còn 3 GiB.
 *   3. Trần ngân sách hộp cát cạn ⇒ tác nhân MÙ (không đọc nổi tệp) và CÂM (không chạy nổi
 *      kiểm chứng), và người dùng chỉ biết khi mở một tệp 1 KB cũng bị từ chối.
 *
 * Không triệu chứng nào nhìn thấy được từ màn hình. Người dùng chỉ thấy *"AI hôm nay dốt hơn"* —
 * một câu không hành động được. Thanh này tồn tại để biến nó thành một câu **trả lời được bằng
 * một cái liếc mắt**: model nào · máy còn khoẻ không · card còn bao nhiêu · lượt vừa rồi nhanh
 * chậm ra sao · còn đọc được bao nhiêu.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * BA NGUYÊN TẮC HIỂN THỊ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * 1. **KHÔNG BIẾT ≠ TỐT.** Ô nào không đọc được thì hiện `—` xám, KHÔNG hiện 0, không ẩn đi.
 *    Một ô trống nói *"tôi mù chỗ này"*; một số 0 nói dối rằng đã đo và kết quả là không.
 * 2. **MÀU LÀ MỘT LỜI KHẲNG ĐỊNH, KHÔNG PHẢI TRANG TRÍ.** Hổ phách/đỏ chỉ bật khi có một NGƯỠNG
 *    ĐO ĐƯỢC bị vượt (xem `mucCanhBao`), nên một thanh xám nghĩa là *"đã kiểm, không sao"* chứ
 *    không phải *"chưa kiểm"*.
 * 3. **KHÔNG CHIẾM CHỖ CỦA MÃ.** Một hàng cao 28 px, nằm trong thanh công cụ sẵn có.
 *
 * ⚠ Mọi số đều do `repoWorkspace.trangThaiAiLocal` đọc từ nguồn THẬT (`getEngineHealth`,
 *   `trangThaiNganSach`, bảng `ai_gateway_metrics`). Không một con số nào ở đây được ước lượng
 *   phía client.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Activity, AlertTriangle, Brain, Check, Copy, Cpu, Gauge, HardDrive, Layers, Timer, Zap } from "lucide-react";
import { trpc } from "@/lib/trpc";
import type { KbUsageLuot } from "@/hooks/useKbChatStream";
import { xuatThongKeJson, type ThongKePhien } from "./thongKePhien";
import { tocDoHaiPha } from "@/hooks/dongHoHaiPha";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const GiB = 1024 ** 3;

/** `—` xám cho mọi ô chưa đo được. Xem nguyên tắc 1 ở đầu tệp. */
const KHONG_BIET = "—";

function gib(b: number | null | undefined): string {
  return typeof b === "number" && Number.isFinite(b) ? `${(b / GiB).toFixed(1)} GiB` : KHONG_BIET;
}

/**
 * Mức cảnh báo của MỘT ô. Hàm THUẦN, và mọi ngưỡng ở đây đều rút từ một sự cố đã đo:
 *   • VRAM còn < 2 GiB  — dưới mức này một lượt nạp model bị driver từ chối (đã đo 79 lần/phiên);
 *   • ngân sách đã dùng ≥ 80 % — quá mức này tác nhân sắp mù, và cảnh báo phải tới TRƯỚC lúc mù;
 *   • tok/s < 5 — dưới mức này gần như chắc chắn model đã tràn sang RAM hoặc card bị tranh chấp.
 */
export type MucCanhBao = "binh-thuong" | "canh-bao" | "nguy";

export function mucCanhBao(o: {
  readonly loai: "vram" | "ngan-sach" | "toc-do" | "may" | "ctx" | "tu-choi";
  readonly giaTri: number | null | undefined;
  readonly mayHong?: boolean;
}): MucCanhBao {
  if (o.loai === "may") return o.mayHong ? "nguy" : "binh-thuong";
  if (typeof o.giaTri !== "number" || !Number.isFinite(o.giaTri)) return "binh-thuong";
  if (o.loai === "vram") return o.giaTri < 1 * GiB ? "nguy" : o.giaTri < 2 * GiB ? "canh-bao" : "binh-thuong";
  if (o.loai === "ngan-sach") return o.giaTri >= 95 ? "nguy" : o.giaTri >= 80 ? "canh-bao" : "binh-thuong";
  // ★ F2 — % ngữ cảnh đã dùng (vào + ra, GỘP suy luận) trên trần lượt. Ca thật 2026-09-22: lượt
  //   khoi-sua nghĩ hết 16.000 token rồi trả RỖNG (G5-D) — người dùng không thấy gì cho tới khi hỏng.
  //   ≥ 85 % là lúc lượt kế tiếp cùng cỡ sẽ bị kẹp trần; ≥ 95 % là đã ở mép.
  if (o.loai === "ctx") return o.giaTri >= 95 ? "nguy" : o.giaTri >= 85 ? "canh-bao" : "binh-thuong";
  // ★ F6 — số lần đường ống TỪ CHỐI/THOÁI HOÁ trong phiên: 1 lần là đáng nhìn, 3 lần là hệ đang không dùng được.
  if (o.loai === "tu-choi") return o.giaTri >= 3 ? "nguy" : o.giaTri >= 1 ? "canh-bao" : "binh-thuong";
  return o.giaTri < 2 ? "nguy" : o.giaTri < 5 ? "canh-bao" : "binh-thuong";
}

/**
 * ★ F2 — tách số đo một lượt thành ba con số hiển thị. THUẦN, có lưới riêng.
 *   · `nghi`  — token trong `<think>`; `null` khi server không đếm được (không biết ≠ 0).
 *   · `sinh`  — token người dùng thật sự nhận = `tokensOut − nghi`; khi `nghi` không biết thì
 *               `sinh` là số GỘP (`gop: true`) — hiển thị phải nói rõ, không được giả là "sinh".
 *   · `pcCtx` — % ngữ cảnh đã dùng = (vào + ra) / trần; `null` khi không biết trần.
 *   · `tokMoiGiay` — tốc độ GỘP (ra / thời gian). Server không tách thời gian nghĩ/sinh nên KHÔNG bịa
 *               hai tốc độ riêng; ô tốc độ "sinh" đúng nghĩa là việc của B7 vòng sau (timings từng pha).
 */
export function tachNghiSinh(u: {
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly tokensReasoning?: number;
  readonly latencyMs: number;
  readonly ctxMax?: number;
}): { nghi: number | null; sinh: number; gop: boolean; pcCtx: number | null; tokMoiGiay: number | null } {
  const nghi = typeof u.tokensReasoning === "number" && Number.isFinite(u.tokensReasoning) ? Math.max(0, u.tokensReasoning) : null;
  const sinh = nghi === null ? u.tokensOut : Math.max(0, u.tokensOut - nghi);
  const pcCtx =
    typeof u.ctxMax === "number" && Number.isFinite(u.ctxMax) && u.ctxMax > 0
      ? Math.min(100, Math.round(((u.tokensIn + u.tokensOut) / u.ctxMax) * 100))
      : null;
  const tokMoiGiay = u.latencyMs > 0 && u.tokensOut > 0 ? Math.round((u.tokensOut / (u.latencyMs / 1000)) * 10) / 10 : null;
  return { nghi, sinh, gop: nghi === null, pcCtx, tokMoiGiay };
}

const MAU: Record<MucCanhBao, string> = {
  "binh-thuong": "text-muted-foreground",
  "canh-bao": "text-amber-600 dark:text-amber-400",
  nguy: "text-red-600 dark:text-red-400",
};

function O({
  id,
  icon: Icon,
  nhan,
  giaTri,
  muc = "binh-thuong",
  giaiThich,
}: {
  /**
   * Định danh ỔN ĐỊNH cho `data-testid` (không phụ thuộc ngôn ngữ). Bản đầu dùng `nhan` (đã dịch) ⇒ kịch bản nghiệm thu
   * sống tìm `tt-ai-local-nghĩ/sinh` trả rỗng ngay khi giao diện đổi sang tiếng Anh (đo 21:21) — testid theo nhãn là
   * một phép đo tự hỏng khi đổi locale.
   */
  id: string;
  icon: typeof Cpu;
  nhan: string;
  giaTri: string;
  muc?: MucCanhBao;
  giaiThich: string;
}) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] tabular-nums ${MAU[muc]}`}
            data-testid={`tt-ai-local-${id}`}
          >
            <Icon className="h-3 w-3 shrink-0" aria-hidden />
            <span className="sr-only">{nhan}: </span>
            <span className="font-medium">{giaTri}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-xs">
          {giaiThich}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * @param dungLuot ★ F2 — số đo lượt model GẦN NHẤT của phiên (sự kiện SSE `usage`, do trang truyền xuống).
 *   `null` ⇒ hai ô "nghĩ/sinh" và "ctx" hiện `—` (chưa có lượt nào trong phiên này — không phải 0).
 */
export function ThanhTrangThaiAiLocal({
  dungLuot = null,
  thongKe = null,
}: {
  dungLuot?: KbUsageLuot | null;
  /** ★ F6 — chỉ số phiên cộng dồn từ trang (lượt · token · thời gian · từ chối). `null` ⇒ ô hiện `—`. */
  thongKe?: ThongKePhien | null;
} = {}) {
  const { t } = useTranslation();
  /** ★ F6 phần 2 — trạng thái nút chép JSON: "ok" | "loi" hiện 2 s rồi về null. */
  const [chep, setChep] = useState<"ok" | "loi" | null>(null);
  const nghiSinh = useMemo(() => (dungLuot ? tachNghiSinh(dungLuot) : null), [dungLuot]);
  const haiPha = useMemo(() => (dungLuot ? tocDoHaiPha(dungLuot) : { tokNghi: null, tokSinh: null }), [dungLuot]);
  /**
   * 10 giây: đủ nhanh để bắt được lúc `llama-server` chết giữa một phiên làm việc, đủ chậm để
   * không tự biến mình thành tải. Thủ tục phía server CHỈ ĐỌC và không tiêu ngân sách hộp cát.
   */
  const q = trpc.repoWorkspace.trangThaiAiLocal.useQuery(undefined, {
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
  const d = q.data;

  /**
   * ⚠ CHỈ đọc `engineOk` — server đã tính nó theo ĐÚNG đường đang phục vụ (xem docblock
   * `trangThaiAiLocal`). Bản đầu ở đây tự `||` thêm `llamaServerKhoe === false`, và kết quả là
   * thanh hiện "ENGINE HỎNG" đỏ trong khi `:8091/health` trả 200 — một báo động giả do client
   * tự suy lại một kết luận mà server đã có đủ dữ kiện để kết. Một sự thật, một nơi tính.
   */
  const mayHong = useMemo(() => (d?.mayMoc ? !d.mayMoc.engineOk : false), [d]);

  if (!d) {
    return (
      <span className="text-[11px] text-muted-foreground/70" data-testid="tt-ai-local-dang-doc">
        {t("ttAiLocal.dangDoc", "trạng thái AI local")} {KHONG_BIET}
      </span>
    );
  }

  const tenModel = d.model?.modelSau || d.model?.modelId || KHONG_BIET;
  const tenNgan = tenModel.replace(/\.gguf$/i, "").split(/[\\/]/).pop() ?? tenModel;

  return (
    <div className="flex flex-wrap items-center gap-0.5" data-testid="thanh-trang-thai-ai-local">
      <O
        icon={mayHong ? AlertTriangle : Cpu}
        id="may"
        nhan={t("ttAiLocal.may", "máy")}
        giaTri={mayHong ? t("ttAiLocal.engineHong", "ENGINE HỎNG") : t("ttAiLocal.engineOk", "engine ok")}
        muc={mucCanhBao({ loai: "may", giaTri: null, mayHong })}
        giaiThich={
          mayHong
            ? t("ttAiLocal.tipMayHong", "Engine suy luận KHÔNG khoẻ. Mọi câu trả lời lúc này phản ánh trạng thái MÁY, không phản ánh năng lực model — đừng kết luận gì về chất lượng model cho tới khi ô này xanh lại.")
            : t("ttAiLocal.tipMayOk", "Engine đang chạy qua {{duong}}. Model đã nạp: {{soModel}}. Chế độ GPU: {{gpu}}.", {
                duong: d.mayMoc?.duongPhucVu === "llama-server"
                  ? t("ttAiLocal.duongNgoai", "llama-server (tiến trình ngoài)")
                  : t("ttAiLocal.duongTrong", "binding trong tiến trình"),
                soModel: d.mayMoc?.soModelDaNap ?? KHONG_BIET,
                gpu: d.mayMoc?.cheDoGpu ?? KHONG_BIET,
              })
        }
      />
      <O
        icon={Zap}
        id="model"
        nhan={t("ttAiLocal.model", "model")}
        giaTri={tenNgan}
        giaiThich={t("ttAiLocal.tipModel", "Model đang phục vụ tác vụ mã. Tầng định tuyến: T{{tier}} · tác vụ \"{{task}}\". Đây là tên tệp GGUF thật đang được nạp, không phải nhãn cấu hình.", { tier: d.model?.tier ?? "?", task: d.model?.task ?? "?" })}
      />
      <O
        icon={HardDrive}
        id="vram"
        nhan={t("ttAiLocal.vram", "VRAM còn")}
        giaTri={gib(d.mayMoc?.vramConByte)}
        muc={mucCanhBao({ loai: "vram", giaTri: d.mayMoc?.vramConByte })}
        giaiThich={
          (d.mayMoc?.nguonVram === "thiet-bi"
            ? t("ttAiLocal.tipVram", "Byte card THỰC SỰ còn trống theo ĐẦU DÒ THIẾT BỊ (tổng {{tong}}, đã dùng {{pc}}%) — cập nhật {{giay}} s trước theo nhịp đối chiếu 60 s{{cu}}. Đã đo: một tiến trình NGOÀI chiếm 23,5 GB khiến bộ cấp phát hứa 22 GiB trên một card còn 3 GiB — nên con số cần nhìn là con số này, không phải sổ nội bộ.", {
                tong: gib(d.mayMoc?.vramTongByte),
                pc: d.mayMoc?.vramPhanTramDung ?? "?",
                giay: Math.round((d.mayMoc?.vramTuoiMs ?? 0) / 1000),
                // > 120 s = TICK_STALE_AFTER_MS của hệ VRAM: nhịp đối chiếu đã bỏ lỡ ít nhất một lượt.
                // Một con số đúng-nhưng-cũ mà không ghi tuổi thì không phân biệt được với một con số sai.
                cu: (d.mayMoc?.vramTuoiMs ?? 0) > 120_000 ? t("ttAiLocal.tipVramCu", " — ⚠ ĐÃ CŨ, nhịp đối chiếu đang lỡ") : "",
              })
            : t("ttAiLocal.tipVramTrongTienTrinh", "⚠ Số VRAM này là cái nhìn TRONG TIẾN TRÌNH node (chưa có nhịp đối chiếu thiết bị) — nó KHÔNG thấy VRAM của llama-server hay tiến trình ngoài, nên có thể cao hơn thực tế rất nhiều (đã đo: báo còn 26 GiB khi card còn 6,6). Chờ nhịp đối chiếu hoặc kiểm bằng nvidia-smi.")
          )
        }
      />
      <O
        icon={Timer}
        id="luotCuoi"
        nhan={t("ttAiLocal.luotCuoi", "lượt cuối")}
        giaTri={d.luotCuoi ? `${(d.luotCuoi.latencyMs / 1000).toFixed(1)}s` : KHONG_BIET}
        giaiThich={
          d.luotCuoi
            ? t("ttAiLocal.tipLuotCuoi", "Lượt gần nhất: {{vao}} token vào → {{ra}} token ra trong {{ms}} ms.", { vao: d.luotCuoi.tokensIn, ra: d.luotCuoi.tokensOut, ms: d.luotCuoi.latencyMs })
            : t("ttAiLocal.tipChuaCoLuot", "Chưa có lượt nào thành công trong 30 phút gần đây.")
        }
      />
      <O
        icon={Gauge}
        id="tocDo"
        nhan={t("ttAiLocal.tocDo", "tok/s")}
        giaTri={d.luotCuoi?.tokMoiGiay != null ? `${d.luotCuoi.tokMoiGiay} tok/s` : KHONG_BIET}
        muc={mucCanhBao({ loai: "toc-do", giaTri: d.luotCuoi?.tokMoiGiay })}
        giaiThich={t("ttAiLocal.tipTocDo", "Tốc độ sinh token của lượt gần nhất — chỉ số TỤT ĐẦU TIÊN khi model tràn sang RAM hoặc khi card bị tiến trình khác tranh chấp. Thấy nó rơi đột ngột thì hãy nghi MÁY trước khi nghi model.")}
      />
      <O
        icon={AlertTriangle}
        id="nganSach"
        nhan={t("ttAiLocal.nganSach", "ngân sách đọc")}
        giaTri={d.nganSach ? t("ttAiLocal.docPc", "đọc {{pc}}%", { pc: d.nganSach.phanTramDaDung }) : KHONG_BIET}
        muc={mucCanhBao({ loai: "ngan-sach", giaTri: d.nganSach?.phanTramDaDung })}
        giaiThich={
          d.nganSach
            ? t("ttAiLocal.tipNganSach", "Đã dùng {{pc}}% ngân sách đọc hộp cát của cửa sổ hiện tại; đặt lại sau ~{{giay}}s. Cạn ngân sách ⇒ tác nhân KHÔNG đọc được tệp và KHÔNG chạy được kiểm chứng.", { pc: d.nganSach.phanTramDaDung, giay: Math.round((d.nganSach.datLaiSauMs ?? 0) / 1000) })
            : t("ttAiLocal.tipNganSachMu", "Không đọc được sổ ngân sách hộp cát.")
        }
      />
      {/* ★ F2 — hai ô từ sự kiện `usage` của lượt gần nhất: nghĩ/sinh và % ngữ cảnh. */}
      <O
        icon={Brain}
        id="nghiSinh"
        nhan={t("ttAiLocal.nghiSinh", "nghĩ/sinh")}
        giaTri={
          !nghiSinh
            ? KHONG_BIET
            : nghiSinh.gop
              ? t("ttAiLocal.raGop", "{{ra}} tok (gộp)", { ra: nghiSinh.sinh })
              : t("ttAiLocal.nghiSinhGiaTri", "{{nghi}} nghĩ · {{sinh}} sinh", { nghi: nghiSinh.nghi, sinh: nghiSinh.sinh })
        }
        giaiThich={
          dungLuot && nghiSinh
            ? t(
                "ttAiLocal.tipNghiSinh",
                "Lượt \"{{luot}}\" trên {{model}} · hồ sơ sampling {{hoSo}} · nghĩ: {{nghi}}. {{vao}} token vào → {{ra}} token ra ({{tocDo}} gộp) trong {{ms}} ms. Tách pha (đo tại trình duyệt, gồm trễ mạng): nghĩ {{tokNghi}} · sinh {{tokSinh}}.",
                {
                  luot: dungLuot.luot,
                  model: dungLuot.modelId,
                  hoSo: dungLuot.samplingProfile,
                  nghi:
                    dungLuot.thinking === false
                      ? t("ttAiLocal.nghiTat", "TẮT")
                      : dungLuot.thinking === true
                        ? t("ttAiLocal.nghiBat", "có, {{n}} token", { n: nghiSinh.nghi ?? 0 })
                        : t("ttAiLocal.nghiKhongBiet", "không đo được"),
                  vao: dungLuot.tokensIn,
                  ra: dungLuot.tokensOut,
                  tocDo: nghiSinh.tokMoiGiay != null ? `${nghiSinh.tokMoiGiay} tok/s` : KHONG_BIET,
                  // ★ F2 — tách pha bằng đồng hồ phía trình duyệt (`dongHoHaiPha.ts`); không đo được ⇒ "—", không 0.
                  tokNghi: haiPha.tokNghi != null ? `${haiPha.tokNghi} tok/s` : KHONG_BIET,
                  tokSinh: haiPha.tokSinh != null ? `${haiPha.tokSinh} tok/s` : KHONG_BIET,
                  ms: dungLuot.latencyMs,
                },
              )
            : t("ttAiLocal.tipChuaCoUsage", "Chưa có lượt model nào trong phiên này. Ô này đọc sự kiện `usage` mà server phát sau mỗi lượt sinh/sửa mã.")
        }
      />
      <O
        icon={Layers}
        id="ctx"
        nhan={t("ttAiLocal.ctx", "ctx")}
        giaTri={nghiSinh?.pcCtx != null ? t("ttAiLocal.ctxPc", "ctx {{pc}}%", { pc: nghiSinh.pcCtx }) : KHONG_BIET}
        muc={mucCanhBao({ loai: "ctx", giaTri: nghiSinh?.pcCtx })}
        giaiThich={
          dungLuot && nghiSinh?.pcCtx != null
            ? t("ttAiLocal.tipCtx", "Lượt gần nhất dùng {{dung}} / {{tran}} token ngữ cảnh (vào + ra, gộp suy luận). ≥85% là lượt kế cùng cỡ sẽ bị kẹp trần; ≥95% là đã ở mép — ca thật: nghĩ hết trần rồi trả rỗng.", {
                dung: dungLuot.tokensIn + dungLuot.tokensOut,
                tran: dungLuot.ctxMax,
              })
            : t("ttAiLocal.tipCtxMu", "Chưa biết trần ngữ cảnh của lượt (chưa có lượt, hoặc server không báo trần).")
        }
      />
      {/* ★ F6 — chỉ số PHIÊN: lượt · token vào/ra/nghĩ · thời gian model · từ chối. */}
      <O
        id="phien"
        icon={Activity}
        nhan={t("ttAiLocal.phien", "phiên")}
        giaTri={thongKe && thongKe.soLuot > 0 ? t("ttAiLocal.phienGiaTri", "{{n}} lượt", { n: thongKe.soLuot }) : KHONG_BIET}
        muc={mucCanhBao({ loai: "tu-choi", giaTri: thongKe?.soTuChoi })}
        giaiThich={
          thongKe && thongKe.soLuot > 0
            ? t(
                "ttAiLocal.tipPhien",
                "Phiên này: {{luot}} lượt model · {{vao}} token vào · {{ra}} token ra (nghĩ {{nghi}}) · {{giay}} s thời gian model · {{tuChoi}} lần từ chối/thoái hoá.",
                {
                  luot: thongKe.soLuot,
                  vao: thongKe.tokensVao,
                  ra: thongKe.tokensRa,
                  nghi:
                    thongKe.tokensNghi === null
                      ? KHONG_BIET
                      : thongKe.nghiKhongDo > 0
                        ? `${thongKe.tokensNghi} + ${thongKe.nghiKhongDo} lượt không đo`
                        : String(thongKe.tokensNghi),
                  giay: Math.round(thongKe.msTong / 1000),
                  tuChoi: thongKe.soTuChoi,
                },
              )
            : t("ttAiLocal.tipPhienRong", "Chưa có lượt model nào trong phiên này.")
        }
      />
      {thongKe && thongKe.soLuot > 0 && (
        <button
          type="button"
          data-testid="tt-ai-local-chep-json"
          className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
          title={t("ttAiLocal.chepJsonTip", "Chép chỉ số phiên dạng JSON (dán vào bảng so sánh bench)")}
          onClick={() => {
            const json = xuatThongKeJson(thongKe, { model: tenModel === KHONG_BIET ? null : tenModel, luc: new Date() });
            const xong = (kq: "ok" | "loi") => { setChep(kq); window.setTimeout(() => setChep(null), 2000); };
            if (!navigator.clipboard?.writeText) { xong("loi"); return; }
            navigator.clipboard.writeText(json).then(() => xong("ok"), () => xong("loi"));
          }}
        >
          {chep === "ok" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {chep === "ok"
            ? t("ttAiLocal.chepJsonOk", "đã chép")
            : chep === "loi"
              ? t("ttAiLocal.chepJsonLoi", "không chép được")
              : t("ttAiLocal.chepJson", "JSON")}
        </button>
      )}
    </div>
  );
}
