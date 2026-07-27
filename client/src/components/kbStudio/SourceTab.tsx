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
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Upload, Link as LinkIcon, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

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

export function SourceTab({ enabled, webIngestEnabled, maxUploadBytes, allowedTypes }: SourceTabProps) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const corporaQuery = trpc.kbStudio.listCorpora.useQuery();

  const [corpus, setCorpus] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const invalidateAfterIngest = () => {
    void utils.kbStudio.listJobs.invalidate();
    void utils.kbStudio.listCorpora.invalidate();
  };

  const uploadMutation = trpc.kbStudio.ingestDocumentJob.useMutation({
    onSuccess: (data) => {
      toast.success(t("kbStudio.source.uploadSuccess", { sourceRef: data.sourceRef, chunksAdded: data.chunksAdded }));
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      invalidateAfterIngest();
    },
    onError: (err) => toast.error(err.message || t("kbStudio.source.uploadError", "Ingest failed.")),
  });

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

  const handleUpload = async () => {
    if (!file || !trimmedCorpus) return;
    try {
      const base64 = await fileToBase64(file);
      uploadMutation.mutate({ corpus: trimmedCorpus, sourceRef: file.name, mimeOrExt: file.name, base64 });
    } catch {
      toast.error(t("kbStudio.source.uploadError", "Ingest failed."));
    }
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
              className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
              }}
            >
              <Upload className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
              {file ? (
                <p className="text-sm font-medium">{file.name}</p>
              ) : (
                <p className="text-sm text-muted-foreground">{t("kbStudio.source.dropzone")}</p>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept={acceptAttr}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <Button
              onClick={handleUpload}
              disabled={!enabled || !file || !trimmedCorpus || uploadMutation.isPending}
              className="w-full"
            >
              {uploadMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {uploadMutation.isPending ? t("kbStudio.source.uploading") : t("kbStudio.source.uploadButton")}
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
