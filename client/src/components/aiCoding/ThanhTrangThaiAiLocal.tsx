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
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Cpu, Gauge, HardDrive, Timer, Zap } from "lucide-react";
import { trpc } from "@/lib/trpc";
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
  readonly loai: "vram" | "ngan-sach" | "toc-do" | "may";
  readonly giaTri: number | null | undefined;
  readonly mayHong?: boolean;
}): MucCanhBao {
  if (o.loai === "may") return o.mayHong ? "nguy" : "binh-thuong";
  if (typeof o.giaTri !== "number" || !Number.isFinite(o.giaTri)) return "binh-thuong";
  if (o.loai === "vram") return o.giaTri < 1 * GiB ? "nguy" : o.giaTri < 2 * GiB ? "canh-bao" : "binh-thuong";
  if (o.loai === "ngan-sach") return o.giaTri >= 95 ? "nguy" : o.giaTri >= 80 ? "canh-bao" : "binh-thuong";
  return o.giaTri < 2 ? "nguy" : o.giaTri < 5 ? "canh-bao" : "binh-thuong";
}

const MAU: Record<MucCanhBao, string> = {
  "binh-thuong": "text-muted-foreground",
  "canh-bao": "text-amber-600 dark:text-amber-400",
  nguy: "text-red-600 dark:text-red-400",
};

function O({
  icon: Icon,
  nhan,
  giaTri,
  muc = "binh-thuong",
  giaiThich,
}: {
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
            data-testid={`tt-ai-local-${nhan}`}
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

export function ThanhTrangThaiAiLocal() {
  const { t } = useTranslation();
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
        nhan={t("ttAiLocal.model", "model")}
        giaTri={tenNgan}
        giaiThich={t("ttAiLocal.tipModel", "Model đang phục vụ tác vụ mã. Tầng định tuyến: T{{tier}} · tác vụ \"{{task}}\". Đây là tên tệp GGUF thật đang được nạp, không phải nhãn cấu hình.", { tier: d.model?.tier ?? "?", task: d.model?.task ?? "?" })}
      />
      <O
        icon={HardDrive}
        nhan={t("ttAiLocal.vram", "VRAM còn")}
        giaTri={gib(d.mayMoc?.vramConByte)}
        muc={mucCanhBao({ loai: "vram", giaTri: d.mayMoc?.vramConByte })}
        giaiThich={t("ttAiLocal.tipVram", "Byte card THỰC SỰ còn trống (tổng {{tong}}, đã dùng {{pc}}%). Đã đo: một tiến trình NGOÀI chiếm 23,5 GB khiến bộ cấp phát hứa 22 GiB trên một card còn 3 GiB — nên con số cần nhìn là con số này, không phải sổ nội bộ.", { tong: gib(d.mayMoc?.vramTongByte), pc: d.mayMoc?.vramPhanTramDung ?? "?" })}
      />
      <O
        icon={Timer}
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
        nhan={t("ttAiLocal.tocDo", "tok/s")}
        giaTri={d.luotCuoi?.tokMoiGiay != null ? `${d.luotCuoi.tokMoiGiay} tok/s` : KHONG_BIET}
        muc={mucCanhBao({ loai: "toc-do", giaTri: d.luotCuoi?.tokMoiGiay })}
        giaiThich={t("ttAiLocal.tipTocDo", "Tốc độ sinh token của lượt gần nhất — chỉ số TỤT ĐẦU TIÊN khi model tràn sang RAM hoặc khi card bị tiến trình khác tranh chấp. Thấy nó rơi đột ngột thì hãy nghi MÁY trước khi nghi model.")}
      />
      <O
        icon={AlertTriangle}
        nhan={t("ttAiLocal.nganSach", "ngân sách đọc")}
        giaTri={d.nganSach ? t("ttAiLocal.docPc", "đọc {{pc}}%", { pc: d.nganSach.phanTramDaDung }) : KHONG_BIET}
        muc={mucCanhBao({ loai: "ngan-sach", giaTri: d.nganSach?.phanTramDaDung })}
        giaiThich={
          d.nganSach
            ? t("ttAiLocal.tipNganSach", "Đã dùng {{pc}}% ngân sách đọc hộp cát của cửa sổ hiện tại; đặt lại sau ~{{giay}}s. Cạn ngân sách ⇒ tác nhân KHÔNG đọc được tệp và KHÔNG chạy được kiểm chứng.", { pc: d.nganSach.phanTramDaDung, giay: Math.round((d.nganSach.datLaiSauMs ?? 0) / 1000) })
            : t("ttAiLocal.tipNganSachMu", "Không đọc được sổ ngân sách hộp cát.")
        }
      />
    </div>
  );
}
