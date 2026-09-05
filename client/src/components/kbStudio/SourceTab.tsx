/**
 * doc69 Giai đoạn 5 / Wave E3 (E3-2) — Training Studio "Source" tab.
 *
 * Pick/create a corpus (a plain text input + a <datalist> of existing corpus names — the
 * corpus is auto-registered server-side on first ingest, no separate "create" step required
 * here), then either upload a document (wraps `trpc.kbStudio.ingestDocumentJob`, itself a
 * job-tracked wrapper around E3-1's `kbIngest.uploadDocument`) or ingest a URL (wraps
 * `trpc.kbStudio.ingestUrlJob`, wrapping E3-3's `kbIngest.ingestUrl`). No parse/chunk/embed
 * logic lives here — this is a thin upload UI.
 */
import { useRef, useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Upload,
  Link as LinkIcon,
  Loader2,
  X,
  CheckCircle2,
  XCircle,
  Clock,
  Info,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { mapTrpcError } from "@/lib/trpcErrors";
import {
  filesFromInput,
  filesFromDrop,
  isQueuedFileStillPending,
  formatAllowedTypesLabel,
  acceptsImageUploads,
  KB_CORPUS_DOMAIN_SUGGESTIONS,
  KB_STUDIO_REJECTED_EXTENSIONS_FOR_GUIDANCE,
} from "./sourceTabLogic";

export interface SourceTabProps {
  enabled: boolean;
  webIngestEnabled: boolean;
  maxUploadBytes: number;
  allowedTypes: readonly string[];
}

function fileToBase64(file: File): Promise<string> {
  return file.arrayBuffer().then((buf) => {
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
    return btoa(binary);
  });
}

/** Per-file ingest lifecycle — Task 5: each queued file gets its OWN `ingestDocumentJob`
 * call, so one file's rejection (bad type/too large/parse error) never blocks the rest. */
type FileIngestStatus = "waiting" | "running" | "done" | "error";

interface QueuedFile {
  id: string;
  file: File;
  status: FileIngestStatus;
  error?: string;
  chunksAdded?: number;
}

function newFileId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Task V9 (2026-09-05) — "hệ thống cần cho tôi training và hướng dẫn tôi training" (yêu cầu
 * nguyên văn chủ dự án). Trước bản vá này, SourceTab là công cụ TRẦN: chọn corpus, chọn tệp,
 * bấm nút — không nói người dùng NÊN làm gì, VÌ SAO, hay làm sao BIẾT nó có tác dụng. Bảng này
 * đưa nguyên nội dung quy trình đã viết sẵn ở
 * docs/superpowers/specs/2026-09-04-ai-local-quy-trinh-nap-tri-thuc.md vào giao diện — không phát
 * minh quy trình mới, chỉ hiển thị nó đúng lúc, đúng chỗ, kèm nút bấm tác dụng thật (đổ tên corpus
 * gợi ý vào ô nhập bên dưới, không tự tạo corpus rỗng).
 *
 * Đặt NGAY TRONG SourceTab (không phải một tab "Hướng dẫn" riêng): danh sách gợi ý corpus ở
 * Bước 1 cần gọi thẳng `setCorpus` của form bên dưới — tách ra một tab khác sẽ phải nâng state
 * `corpus` lên KbStudioPage.tsx (tab cha, mỗi tab hiện tự quản state riêng, xem module doc của
 * KbStudioPage.tsx) chỉ để một nút bấm đổi giá trị ô nhập ở một tab khác — không cân xứng với
 * kích thước thay đổi.
 *
 * Định dạng "nhận được" hiển thị TRỰC TIẾP từ `allowedTypes` (chính mảng server trả về, ĐÃ là
 * nguồn chống-trôi từ Task 6 review round 2 — xem `formatAllowedTypesLabel` trong
 * sourceTabLogic.ts) — không chép tay lại. Định dạng "KHÔNG nhận"
 * (`KB_STUDIO_REJECTED_EXTENSIONS_FOR_GUIDANCE`) buộc phải chép tay (server không phơi ra danh
 * sách bị từ chối) nhưng có lưới `kbFormatGuidance.crossCheck.unit.test.ts` đối chiếu trực tiếp
 * với `normalizeSourceType` thật của server — xem hằng số đó trong sourceTabLogic.ts.
 *
 * ★ Video KHÔNG được liệt kê là "nhận được" dù kbDocParser.ts/kbVideoTranscriber.ts có hỗ trợ ở
 * tầng dịch vụ (có lưới riêng) — đã xác nhận bằng cách đọc mã: kbStudioRouter.ts (router mà
 * SourceTab gọi) không có `ingestVideoJob`, và không có lời gọi `kbIngest.ingestVideo`/
 * `videoIngestEnabled` nào trong toàn bộ client/ (đã grep). Nói "video nạp được" ở đây sẽ là một
 * lời khai sai — người dùng thử sẽ chỉ nhận lỗi "định dạng không được nhận" vì đuôi tệp video
 * thật (.mp4…) không map vào KbSourceType nào cả.
 */
function IngestGuidanceCard({
  corpus,
  setCorpus,
  allowedTypes,
  webIngestEnabled,
}: {
  corpus: string;
  setCorpus: (value: string) => void;
  allowedTypes: readonly string[];
  webIngestEnabled: boolean;
}) {
  const { t } = useTranslation();
  const showsImages = acceptsImageUploads(allowedTypes);
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Info className="h-4 w-4" />
          {t("kbStudio.source.guidance.title", "Hướng dẫn tự nạp tài liệu")}
        </CardTitle>
        <CardDescription>
          {t(
            "kbStudio.source.guidance.subtitle",
            "Bốn bước để tự đưa tài liệu vào AI Local — làm đúng thứ tự, hệ thống lo phần còn lại.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <ol className="space-y-4">
          <li>
            <p className="font-medium text-foreground">
              {t("kbStudio.source.guidance.step1Title", "1. Chọn corpus theo ĐÚNG miền")}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t(
                "kbStudio.source.guidance.step1Body",
                "Vì sao phải tách miền: đã đo được — trộn nhiều miền vào MỘT corpus khiến hỏi về web lại lôi ra tài liệu PLC (5 trích dẫn điểm 0,85–0,91 từ tài liệu lạc đề). Rác trong corpus làm câu trả lời TỆ ĐI, không phải trung tính — corpus càng nhiều tài liệu lạc đề, càng nhiều câu trả lời bị kéo sai hướng.",
              )}
            </p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {KB_CORPUS_DOMAIN_SUGGESTIONS.map((s) => (
                <Button
                  key={s.corpus}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setCorpus(s.corpus)}
                  aria-label={t("kbStudio.source.guidance.fillCorpusAria", {
                    corpus: s.corpus,
                    defaultValue: 'Điền tên corpus gợi ý "{{corpus}}" vào ô Tên corpus',
                  })}
                >
                  {s.label}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              {t(
                "kbStudio.source.guidance.step1Note",
                'Bấm một gợi ý chỉ ĐIỀN tên vào ô "Tên corpus" bên dưới (không tự tạo corpus rỗng) — corpus chỉ thật sự tồn tại sau khi tài liệu đầu tiên được nạp vào nó.',
              )}
              {corpus && (
                <span className="ml-1 text-foreground">
                  {t("kbStudio.source.guidance.currentlySelected", "Đang chọn:")}{" "}
                  <span className="font-medium">{corpus}</span>
                </span>
              )}
            </p>
            <div className="rounded-lg border-2 border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-2 mt-2 flex gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-700 dark:text-amber-400" />
              <p className="text-xs text-amber-800 dark:text-amber-300">
                {t(
                  "kbStudio.source.guidance.step1WebWarning",
                  "Miền lập trình web/app (C#, React, Node.js, HTML, CSS, JavaScript): model đã biết sẵn các ngôn ngữ này từ lúc huấn luyện — nạp tài liệu cho miền này KHÔNG dạy thêm gì mà còn làm NHIỄU câu trả lời (đã đo: 2/2 ca sai còn lại trong bộ đánh giá là câu hỏi ngoài miền tài liệu hãng bị gán trích dẫn lạc đề). Đừng mất công tạo corpus cho miền này.",
                )}
              </p>
            </div>
          </li>

          <li>
            <p className="font-medium text-foreground">
              {t("kbStudio.source.guidance.step2Title", "2. Chọn tệp")}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("kbStudio.source.guidance.step2Accepts", {
                formats: formatAllowedTypesLabel(allowedTypes),
                defaultValue: "Nhận: {{formats}}",
              })}
              {webIngestEnabled
                ? t("kbStudio.source.guidance.step2AcceptsUrl", ", URL (dán link ở khung bên phải)")
                : ""}
              .{" "}
              {showsImages &&
                t(
                  "kbStudio.source.guidance.step2ImageHint",
                  "Ảnh được model thị giác tự mô tả thành văn bản trước khi nạp.",
                )}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("kbStudio.source.guidance.step2Rejects", {
                extensions: KB_STUDIO_REJECTED_EXTENSIONS_FOR_GUIDANCE.join(", "),
                defaultValue: "KHÔNG nhận: {{extensions}} — chuyển sang Markdown hoặc TXT trước khi nạp.",
              })}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t(
                "kbStudio.source.guidance.step2VideoNote",
                "Video (tự chép lời bằng whisper.cpp) đã có ở tầng dịch vụ nhưng chưa nối vào màn hình này — đừng thử tải video lên đây, tệp sẽ bị từ chối.",
              )}
            </p>
          </li>

          <li>
            <p className="font-medium text-foreground">
              {t("kbStudio.source.guidance.step3Title", "3. Không cần chạy thêm gì")}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t(
                "kbStudio.source.guidance.step3Body",
                'Bấm "Tải lên & nạp" là XONG: hệ thống tự PARSE → CHIA NHỎ (chunk) → NHÚNG (embed) → LƯU trong một lượt. Không có script nào phải tự chạy sau khi tải lên — đây là điểm dễ hiểu lầm nhất vì nhiều tài liệu khác của dự án nói tới bước nhúng thủ công (đường dòng lệnh, cho thư mục PDF theo hãng); đường Training Studio này KHÔNG cần bước đó.',
              )}
            </p>
          </li>

          <li>
            <p className="font-medium text-foreground">
              {t("kbStudio.source.guidance.step4Title", "4. Kiểm tra đã vào chưa")}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t(
                "kbStudio.source.guidance.step4Body",
                "Hỏi trợ lý AI Local một câu MÌNH BIẾT TRƯỚC đáp án, lấy thẳng từ tài liệu vừa nạp (vd một giá trị thanh ghi, một mã lỗi cụ thể). Trả lời đúng và dẫn đúng tên tệp vừa nạp = corpus sống. Trả lời chung chung hoặc không nhắc tới tài liệu = chưa vào hoặc chưa nhúng.",
              )}
            </p>
          </li>
        </ol>

        <div className="rounded-lg border-2 border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-2.5 flex gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-700 dark:text-amber-400" />
          <p className="text-xs text-amber-800 dark:text-amber-300">
            <span className="font-medium">
              {t("kbStudio.source.guidance.scanWarningTitle", "Cảnh báo PDF quét ảnh (scan):")}
            </span>{" "}
            {t(
              "kbStudio.source.guidance.scanWarningBody",
              "bộ đọc PDF của hệ thống không đọc được chữ trong ảnh — nó trả về RỖNG mà KHÔNG báo lỗi, nghĩa là có thể nạp một corpus rỗng mà không hề biết. Sau khi tải lên, nhìn số đoạn (chunk) hiện ngay bên dưới tên tệp — ra 0 hoặc rất thấp là dấu hiệu tài liệu chưa thật sự vào được.",
            )}
          </p>
        </div>

        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <ArrowRight className="h-3.5 w-3.5 shrink-0" />
          {t(
            "kbStudio.source.guidance.resultNote",
            'Kết quả sau khi nạp: số đoạn (chunk) hiện ngay dưới mỗi tệp bên dưới sau khi xong. Xem lại đầy đủ (tên tài liệu, corpus, số đoạn, trạng thái, lỗi nếu có) ở tab "Tác vụ".',
          )}
        </p>
      </CardContent>
    </Card>
  );
}

export function SourceTab({ enabled, webIngestEnabled, maxUploadBytes, allowedTypes }: SourceTabProps) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const corporaQuery = trpc.kbStudio.listCorpora.useQuery();

  const [corpus, setCorpus] = useState("");
  const [queuedFiles, setQueuedFilesState] = useState<QueuedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [url, setUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Vòng sửa 1 (review) — `queuedFilesRef` là hàng đợi SỐNG: cập nhật ĐỒNG BỘ ngay tại thời
  // điểm gọi (không đợi React render). `handleUpload`'s loop đọc từ ref này ngay trước khi gửi
  // từng file — KHÔNG dùng snapshot `queuedFiles` chụp lúc bấm nút — nên nó luôn thấy được một
  // file vừa bị xoá và bỏ qua thật, thay vì vẫn gửi một file đã "biến mất" khỏi màn hình.
  const queuedFilesRef = useRef<QueuedFile[]>([]);
  const applyQueue = (next: QueuedFile[]) => {
    queuedFilesRef.current = next;
    setQueuedFilesState(next);
  };

  const invalidateAfterIngest = () => {
    void utils.kbStudio.listJobs.invalidate();
    void utils.kbStudio.listCorpora.invalidate();
  };

  const addFiles = (files: File[]) => {
    if (files.length === 0) return;
    applyQueue([
      ...queuedFilesRef.current,
      ...files.map((file) => ({ id: newFileId(), file, status: "waiting" as const })),
    ]);
  };

  // Vòng sửa 1 — xoá CHỈ được phép khi file vẫn "waiting". Đây là lớp phòng thủ thứ hai (lớp
  // thứ nhất là nút X chỉ vẽ ra khi status === "waiting", xem JSX bên dưới): nếu người dùng
  // bấm X đúng lúc `handleUpload` vừa chuyển file đó sang "running" (đồng bộ, trước bất kỳ
  // `await` nào — xem comment trong `handleUpload`) nhưng UI khung hình trước đó vẫn còn vẽ nút
  // X, filter dưới đây đọc lại trạng thái SỐNG và sẽ KHÔNG xoá — file đã "running" thì không
  // còn cách nào rút lại được nữa (đã tính là đang gửi).
  const removeQueuedFile = (id: string) => {
    applyQueue(queuedFilesRef.current.filter((qf) => !(qf.id === id && qf.status === "waiting")));
  };

  // No onSuccess/onError here: Task 5 ingests one file per job in a loop (see handleUpload)
  // and tracks per-file status locally, so a single shared toast per mutation call would be
  // noisy/misleading — the batch summary toast at the end of the loop is the honest signal.
  const uploadMutation = trpc.kbStudio.ingestDocumentJob.useMutation();

  const urlMutation = trpc.kbStudio.ingestUrlJob.useMutation({
    onSuccess: (data) => {
      toast.success(t("kbStudio.source.urlSuccess", { sourceRef: data.sourceRef, chunksAdded: data.chunksAdded }));
      setUrl("");
      invalidateAfterIngest();
    },
    onError: (err) => toast.error(t("kbStudio.source.urlError", "URL ingest failed."), { description: mapTrpcError(err) }),
  });

  const trimmedCorpus = corpus.trim();
  const maxMb = Math.max(1, Math.round(maxUploadBytes / (1024 * 1024)));
  const acceptAttr = allowedTypes.map((ext) => `.${ext}`).join(",");
  // Vòng sửa 2 (review) — nhãn hiển thị lấy TRỰC TIẾP từ `allowedTypes` (cùng mảng đã dùng để
  // build `acceptAttr` ở trên), không gõ tay lại danh sách định dạng — xem sourceTabLogic.ts.
  const formatsLabel = formatAllowedTypesLabel(allowedTypes);
  const showImageHint = acceptsImageUploads(allowedTypes);

  /** Task 5: one `ingestDocumentJob` call PER queued file, sequentially — each file is its own
   * independent job. A rejection on one file (bad type/too large/decode error, all surfaced by
   * the server as a real error message via `mapTrpcError` — see vòng sửa 1 note below) is
   * recorded against THAT file and the loop continues; it never silently drops the file or
   * masks the failure as a success. The closing toast is a truthful "done N/M, failed K"
   * summary — never reported as a plain success when K > 0.
   *
   * Vòng sửa 1 (review) — `initialQueue` below fixes the ORDER we walk (a stable snapshot at
   * click-time is fine for iteration order), but before SENDING each file we re-check
   * `isQueuedFileStillPending` against `queuedFilesRef.current` (the LIVE queue, mutated by
   * `removeQueuedFile` on every click) — not the snapshot. A file removed by the user before
   * its turn is skipped entirely: no API call, not counted in done/failed, only in `skipped`.
   * The "is it still pending?" check and the synchronous `applyQueue(...status: "running")`
   * that follows run back-to-back with NO `await` between them, so there is no interleaving
   * window where a file could be both removed and claimed-as-running at once (see
   * `removeQueuedFile`'s own status==="waiting" guard for the other half of this argument). */
  const handleUpload = async () => {
    const initialQueue = queuedFilesRef.current;
    if (initialQueue.length === 0 || !trimmedCorpus) return;
    setIsUploading(true);
    let done = 0;
    let failed = 0;
    let skipped = 0;
    for (const qf of initialQueue) {
      if (!isQueuedFileStillPending(qf.id, queuedFilesRef.current)) {
        // Người dùng đã xoá file này khỏi hàng đợi trước khi tới lượt gửi — tôn trọng thao tác
        // huỷ THẬT: không gọi ingestDocumentJob, không tính vào done/failed.
        skipped += 1;
        continue;
      }
      applyQueue(queuedFilesRef.current.map((x) => (x.id === qf.id ? { ...x, status: "running" } : x)));
      try {
        const base64 = await fileToBase64(qf.file);
        const result = await uploadMutation.mutateAsync({
          corpus: trimmedCorpus,
          sourceRef: qf.file.name,
          mimeOrExt: qf.file.name,
          base64,
        });
        done += 1;
        applyQueue(
          queuedFilesRef.current.map((x) =>
            x.id === qf.id ? { ...x, status: "done", chunksAdded: result.chunksAdded } : x,
          ),
        );
      } catch (err) {
        failed += 1;
        // Vòng sửa 1 — dùng bộ dịch lỗi tRPC dùng chung (client/src/lib/trpcErrors.ts) thay vì
        // `err.message` thô: nó GIỮ NGUYÊN lý do thật từ server (vd. "Unsupported document
        // type…" cho sai định dạng, "Document exceeds N bytes" cho quá lớn, thông điệp fetch
        // gốc cho lỗi mạng — ba câu khác nhau, không câu nào bị gộp chung), đồng thời chặn rò
        // rỉ SQL/nội bộ và cắt bớt chuỗi quá dài — không tự bịa thêm nhãn phân loại nào cả.
        const message = mapTrpcError(err);
        applyQueue(
          queuedFilesRef.current.map((x) => (x.id === qf.id ? { ...x, status: "error", error: message } : x)),
        );
      }
    }
    setIsUploading(false);
    invalidateAfterIngest();
    const attempted = done + failed;
    if (attempted === 0 && skipped > 0) {
      toast.warning(t("kbStudio.source.uploadAllCancelled", { skipped }));
      return;
    }
    const summary =
      skipped > 0
        ? t("kbStudio.source.uploadSummarySkipped", { done, total: attempted, failed, skipped })
        : t("kbStudio.source.uploadSummary", { done, total: attempted, failed });
    if (failed === 0) toast.success(summary);
    else toast.error(summary);
  };

  const handleFilesPicked = (picked: File[]) => {
    if (picked.length === 0) return;
    addFiles(picked);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    handleFilesPicked(filesFromDrop(e.dataTransfer));
  };

  const handleUrlIngest = () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl || !trimmedCorpus) return;
    urlMutation.mutate({ corpus: trimmedCorpus, url: trimmedUrl });
  };

  return (
    <div className="space-y-4">
      {!enabled && (
        <Alert>
          <AlertDescription>{t("kbStudio.disabled.desc")}</AlertDescription>
        </Alert>
      )}

      <IngestGuidanceCard
        corpus={corpus}
        setCorpus={setCorpus}
        allowedTypes={allowedTypes}
        webIngestEnabled={webIngestEnabled}
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("kbStudio.source.corpusLabel")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Input
            list="kb-studio-corpus-options"
            value={corpus}
            onChange={(e) => setCorpus(e.target.value)}
            placeholder={t("kbStudio.source.corpusPlaceholder")}
            aria-label={t("kbStudio.source.corpusInputAria")}
            className="max-w-sm"
          />
          <datalist id="kb-studio-corpus-options">
            {(corporaQuery.data?.corpora ?? []).map((c) => (
              <option key={c.name} value={c.name} />
            ))}
          </datalist>
          <p className="text-xs text-muted-foreground">{t("kbStudio.source.corpusHelp")}</p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Upload className="h-4 w-4" />
              {t("kbStudio.source.uploadTitle")}
            </CardTitle>
            <CardDescription>{t("kbStudio.source.uploadDesc", { formats: formatsLabel, maxMb })}</CardDescription>
            {showImageHint && (
              <p className="text-xs text-muted-foreground">{t("kbStudio.source.uploadImageHint")}</p>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            <div
              role="button"
              tabIndex={0}
              aria-label={t("kbStudio.source.dropzoneAria")}
              className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                isDragOver ? "border-primary bg-primary/5" : "hover:border-primary/50"
              }`}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
            >
              <Upload className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{t("kbStudio.source.dropzone")}</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              accept={acceptAttr}
              onChange={(e) => handleFilesPicked(filesFromInput(e.target.files))}
            />
            {queuedFiles.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">
                  {t("kbStudio.source.selectedFilesLabel", { count: queuedFiles.length })}
                </p>
                <ul className="space-y-1 max-h-48 overflow-y-auto">
                  {queuedFiles.map((qf) => (
                    <li
                      key={qf.id}
                      className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-xs"
                    >
                      <span className="truncate flex-1 text-left" title={qf.file.name}>
                        {qf.file.name}
                      </span>
                      <span className="flex items-center gap-1 shrink-0 text-muted-foreground">
                        {qf.status === "waiting" && (
                          <>
                            <Clock className="h-3.5 w-3.5" />
                            {t("kbStudio.source.fileStatusWaiting")}
                          </>
                        )}
                        {qf.status === "running" && (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            {t("kbStudio.source.fileStatusRunning")}
                          </>
                        )}
                        {qf.status === "done" && (
                          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            {t("kbStudio.source.fileStatusDone", { chunksAdded: qf.chunksAdded ?? 0 })}
                          </span>
                        )}
                        {qf.status === "error" && (
                          <span
                            className="flex items-center gap-1 text-destructive"
                            title={qf.error}
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            {t("kbStudio.source.fileStatusError", { error: qf.error })}
                          </span>
                        )}
                      </span>
                      {qf.status === "waiting" && (
                        <button
                          type="button"
                          aria-label={t("kbStudio.source.removeFileAria", { name: qf.file.name })}
                          className="shrink-0 text-muted-foreground hover:text-foreground"
                          onClick={() => removeQueuedFile(qf.id)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Button
              onClick={handleUpload}
              disabled={!enabled || queuedFiles.length === 0 || !trimmedCorpus || isUploading}
              className="w-full"
            >
              {isUploading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {isUploading ? t("kbStudio.source.uploading") : t("kbStudio.source.uploadButton")}
            </Button>
            {!trimmedCorpus && <p className="text-xs text-muted-foreground">{t("kbStudio.source.corpusRequired")}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <LinkIcon className="h-4 w-4" />
              {t("kbStudio.source.urlTitle")}
            </CardTitle>
            <CardDescription>{t("kbStudio.source.urlDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {webIngestEnabled ? (
              <>
                <Label htmlFor="kb-studio-url-input" className="sr-only">
                  {t("kbStudio.source.urlLabel")}
                </Label>
                <Input
                  id="kb-studio-url-input"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={t("kbStudio.source.urlPlaceholder")}
                  aria-label={t("kbStudio.source.urlInputAria")}
                  type="url"
                />
                <Button
                  onClick={handleUrlIngest}
                  disabled={!enabled || !url.trim() || !trimmedCorpus || urlMutation.isPending}
                  className="w-full"
                >
                  {urlMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  {urlMutation.isPending ? t("kbStudio.source.urlIngesting") : t("kbStudio.source.urlButton")}
                </Button>
                {!trimmedCorpus && <p className="text-xs text-muted-foreground">{t("kbStudio.source.corpusRequired")}</p>}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t("kbStudio.source.webIngestDisabled")}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default SourceTab;
