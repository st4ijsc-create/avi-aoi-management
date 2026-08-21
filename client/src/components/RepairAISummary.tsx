/**
 * doc 69 §B1.3 (T8/E1) — RepairAISummary: contextual AI embed for the Repair
 * Station drawer, MIRRORING MachineAISummary's proven pattern rather than
 * inventing new visual language:
 *   1. Machine-level AI signal — literally reuses <MachineAISummary> (same
 *      trpc queries: predictiveMaintenance.getMachineRisk / aiAnomaly.latestForMachine
 *      / aiInsight.list) so there is exactly one source of truth for those signals.
 *   2. "Find similar defects" — reuses aiImageSearch.searchByUpload (the SAME
 *      procedure AIImageSearchPage's upload-search tab calls) against the
 *      board's OWN already-stored defect image (imageKey — no re-upload, no
 *      new endpoint) + renders results with the shared <SimilarImageGrid>.
 *   3. "Hỏi AI" deep-link — prefills /ai-chat with a question scoped to THIS
 *      serial + defect, the same `/ai-chat?q=&machine=` mechanism
 *      MachineAISummary's own "Hỏi AI" button uses.
 *
 * Fully fail-safe: no machine linked → honest line instead of fabricating a
 * signal; no defect image → the similar-search action stays disabled with an
 * honest explanation; the search call is user-triggered (no surprise network
 * activity) and any failure renders as a message, never a crash.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import MachineAISummary from "@/components/MachineAISummary";
import { mapTrpcError } from "@/lib/trpcErrors";
import SimilarImageGrid, {
  type SearchMode,
  type EmbeddingSource,
  type SimilarImageItem,
} from "@/components/ai/SimilarImageGrid";
import { Button } from "@/components/ui/button";
import { MessageCircle, ScanSearch } from "lucide-react";

export interface RepairAISummaryProps {
  /** The scanned board serial the drawer is scoped to. */
  serial: string;
  machineId?: number | null;
  machineCode?: string | null;
  machineName?: string | null;
  /** Already-stored image (imageUrl/defectCropUrl) of the focused NG point, if any. */
  defectImageUrl?: string | null;
  /** Human-readable defect name/code, used only to phrase the "Hỏi AI" question. */
  defectLabel?: string | null;
  className?: string;
}

export default function RepairAISummary({
  serial,
  machineId,
  machineCode,
  machineName,
  defectImageUrl,
  defectLabel,
  className,
}: RepairAISummaryProps) {
  const { t } = useTranslation();
  const [, navigate] = useLocation();

  // ── Find similar defects — reuses aiImageSearch.searchByUpload against the
  // board's OWN already-stored image (no new upload flow, no new endpoint). ──
  const [similarResults, setSimilarResults] = useState<SimilarImageItem[] | null>(null);
  const [searchMode, setSearchMode] = useState<SearchMode | null>(null);
  const [embeddingSource, setEmbeddingSource] = useState<EmbeddingSource | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchByUpload = trpc.aiImageSearch.searchByUpload.useMutation();

  const findSimilar = async () => {
    if (!defectImageUrl) return;
    setSearchError(null);
    try {
      const result = await searchByUpload.mutateAsync({
        imageKey: defectImageUrl,
        machineId: machineId ?? undefined,
        limit: 8,
      });
      setSimilarResults((result.results ?? []) as SimilarImageItem[]);
      setSearchMode((result.searchMode ?? null) as SearchMode | null);
      setEmbeddingSource(((result as { embeddingSource?: EmbeddingSource }).embeddingSource ?? null));
    } catch (err) {
      setSearchError(mapTrpcError(err));
    }
  };

  const askAI = () => {
    const machineLabel = machineCode ?? machineName ?? undefined;
    const question = defectLabel
      ? t(
          "repairAI.askQuestion",
          "Board serial {{serial}} bị lỗi {{defect}} trên máy {{machine}}. Nguyên nhân có thể là gì và cách khắc phục?",
          { serial, defect: defectLabel, machine: machineLabel ?? t("repairAI.unknownMachine", "chưa rõ") },
        )
      : t(
          "repairAI.askQuestionNoDefect",
          "Board serial {{serial}} đang ở trạm sửa chữa. AI có gợi ý gì để chẩn đoán không?",
          { serial },
        );
    const params = new URLSearchParams({ q: question });
    if (machineCode) params.set("machine", machineCode);
    navigate(`/ai-chat?${params.toString()}`);
  };

  return (
    <div className={cn("space-y-4", className)}>
      {/* Machine-level signal — literal reuse of MachineAISummary (same queries) */}
      {machineId ? (
        <MachineAISummary
          machineId={machineId}
          machineCode={machineCode ?? undefined}
          machineName={machineName ?? undefined}
          compact
        />
      ) : (
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs text-muted-foreground">
            {t("repairAI.noMachine", "Chưa xác định máy cho serial này — chưa có tín hiệu AI theo máy.")}
          </p>
        </div>
      )}

      {/* Find similar defects */}
      <div className="rounded-lg border bg-card p-3 space-y-2">
        <div className="flex items-center gap-1.5">
          <ScanSearch className="h-4 w-4 text-primary" />
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("repairAI.similarTitle", "Tìm lỗi tương tự")}
          </span>
        </div>
        {!defectImageUrl ? (
          <p className="text-xs text-muted-foreground">
            {t("repairAI.similarNoImage", "Không có ảnh lỗi để so sánh")}
          </p>
        ) : (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={findSimilar}
              disabled={searchByUpload.isPending}
            >
              {searchByUpload.isPending
                ? t("repairAI.similarSearching", "Đang tìm ảnh tương tự…")
                : t("repairAI.similarCta", "Tìm ảnh tương tự")}
            </Button>
            {searchError && <p className="text-xs text-destructive">{searchError}</p>}
            <SimilarImageGrid
              results={similarResults}
              loading={searchByUpload.isPending}
              searchMode={searchMode}
              embeddingSource={embeddingSource}
            />
          </>
        )}
      </div>

      {/* Ask AI — serial/defect-scoped deep link (same /ai-chat?q=&machine= mechanism) */}
      <Button size="sm" variant="outline" className="w-full gap-1.5" onClick={askAI}>
        <MessageCircle className="h-3.5 w-3.5" />
        {t("repairAI.askAI", "Hỏi AI về serial này")}
      </Button>
    </div>
  );
}
