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
import { Upload, Link as LinkIcon, Loader2, X, CheckCircle2, XCircle, Clock } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { filesFromInput, filesFromDrop } from "./sourceTabLogic";

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

export function SourceTab({ enabled, webIngestEnabled, maxUploadBytes, allowedTypes }: SourceTabProps) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const corporaQuery = trpc.kbStudio.listCorpora.useQuery();

  const [corpus, setCorpus] = useState("");
  const [queuedFiles, setQueuedFiles] = useState<QueuedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [url, setUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const invalidateAfterIngest = () => {
    void utils.kbStudio.listJobs.invalidate();
    void utils.kbStudio.listCorpora.invalidate();
  };

  const addFiles = (files: File[]) => {
    if (files.length === 0) return;
    setQueuedFiles((prev) => [...prev, ...files.map((file) => ({ id: newFileId(), file, status: "waiting" as const }))]);
  };

  const removeQueuedFile = (id: string) => {
    setQueuedFiles((prev) => prev.filter((qf) => qf.id !== id));
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
    onError: (err) => toast.error(err.message || t("kbStudio.source.urlError", "URL ingest failed.")),
  });

  const trimmedCorpus = corpus.trim();
  const maxMb = Math.max(1, Math.round(maxUploadBytes / (1024 * 1024)));
  const acceptAttr = allowedTypes.map((ext) => `.${ext}`).join(",");

  /** Task 5: one `ingestDocumentJob` call PER queued file, sequentially — each file is its own
   * independent job. A rejection on one file (bad type/too large/decode error, all surfaced by
   * the server as a real error message) is recorded against THAT file and the loop continues;
   * it never silently drops the file or masks the failure as a success. The closing toast is a
   * truthful "done N/M, failed K" summary — never reported as a plain success when K > 0. */
  const handleUpload = async () => {
    if (queuedFiles.length === 0 || !trimmedCorpus) return;
    setIsUploading(true);
    let done = 0;
    let failed = 0;
    for (const qf of queuedFiles) {
      setQueuedFiles((prev) => prev.map((x) => (x.id === qf.id ? { ...x, status: "running" } : x)));
      try {
        const base64 = await fileToBase64(qf.file);
        const result = await uploadMutation.mutateAsync({
          corpus: trimmedCorpus,
          sourceRef: qf.file.name,
          mimeOrExt: qf.file.name,
          base64,
        });
        done += 1;
        setQueuedFiles((prev) =>
          prev.map((x) => (x.id === qf.id ? { ...x, status: "done", chunksAdded: result.chunksAdded } : x)),
        );
      } catch (err) {
        failed += 1;
        const message = err instanceof Error ? err.message : t("kbStudio.source.uploadError", "Ingest failed.");
        setQueuedFiles((prev) => (prev.map((x) => (x.id === qf.id ? { ...x, status: "error", error: message } : x))));
      }
    }
    setIsUploading(false);
    invalidateAfterIngest();
    const summary = t("kbStudio.source.uploadSummary", { done, total: queuedFiles.length, failed });
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
            <CardDescription>{t("kbStudio.source.uploadDesc", { maxMb })}</CardDescription>
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
