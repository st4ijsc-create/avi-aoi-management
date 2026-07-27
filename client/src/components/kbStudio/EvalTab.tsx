/**
 * doc69 Giai đoạn 5 / Wave E3 (E3-2) — Training Studio "Eval" tab (Eval-lite).
 *
 * A sample of what got ingested into a corpus (`trpc.kbStudio.corpusPreview` — reads
 * `kb_studio_chunks` directly, NO embedding/model call, see kbStudioRouter.ts's corpusPreview
 * doc comment). This is deliberately NOT a quality score — a full RAG-answer-quality
 * evaluation needs a live embed/LLM model and a golden question set, which is a documented
 * OPS step (`scripts/ai-kb/eval-rag.mjs`), not built here.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Info } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function EvalTab() {
  const { t } = useTranslation();
  const [corpus, setCorpus] = useState<string>("");

  const corporaQuery = trpc.kbStudio.listCorpora.useQuery();
  const previewQuery = trpc.kbStudio.corpusPreview.useQuery({ corpus, limit: 20 }, { enabled: !!corpus });

  const corpora = corporaQuery.data?.corpora ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("kbStudio.eval.title")}</CardTitle>
          <CardDescription>{t("kbStudio.eval.desc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select value={corpus} onValueChange={setCorpus}>
            <SelectTrigger aria-label={t("kbStudio.eval.corpusSelectAria")} className="w-64">
              <SelectValue placeholder={t("kbStudio.eval.corpusPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {corpora.map((c) => (
                <SelectItem key={c.name} value={c.name}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {!corpus ? (
            <EmptyState variant="no-config" compact title={t("kbStudio.eval.corpusRequired")} description={t("kbStudio.eval.desc")} />
          ) : previewQuery.isError ? (
            <EmptyState
              variant="error"
              compact
              title={t("kbStudio.eval.loadError")}
              description={previewQuery.error instanceof Error ? previewQuery.error.message : undefined}
              actionLabel={t("common.retry", "Retry")}
              onAction={() => previewQuery.refetch()}
            />
          ) : previewQuery.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : previewQuery.data && !previewQuery.data.tableAvailable ? (
            <EmptyState
              variant="no-config"
              compact
              title={t("kbStudio.corpus.tableUnavailable")}
              description={t("kbStudio.eval.desc")}
            />
          ) : previewQuery.data && previewQuery.data.sample.length === 0 ? (
            <EmptyState variant="no-data" compact title={t("kbStudio.eval.empty")} description={t("kbStudio.eval.desc")} />
          ) : previewQuery.data ? (
            <>
              <div className="flex flex-wrap gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">{t("kbStudio.eval.totalChunks")}: </span>
                  <span className="font-medium">{previewQuery.data.totalChunks}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t("kbStudio.eval.distinctSources")}: </span>
                  <span className="font-medium">{previewQuery.data.distinctSources}</span>
                </div>
              </div>
              <div className="space-y-2 max-h-[520px] overflow-y-auto">
                {previewQuery.data.sample.map((chunk) => (
                  <Card key={chunk.id} className="bg-muted/30">
                    <CardContent className="p-3 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                        <Badge variant="outline">{chunk.sourceType}</Badge>
                        <span className="truncate max-w-[280px]" title={chunk.sourceRef}>
                          {chunk.sourceRef}
                        </span>
                        <span>#{chunk.chunkIndex}</span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{chunk.text}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>{t("kbStudio.eval.opsNote")}</AlertDescription>
      </Alert>
    </div>
  );
}

export default EvalTab;
