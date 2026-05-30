/**
 * WS-3 — Lưới ảnh tương tự dùng chung (AIImageSearchPage + AdvancedVisionLabPage).
 * Hiển thị top-K ảnh + %similarity + badge label/defectType.
 */
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Percent, Search } from "lucide-react";

export interface SimilarImageItem {
  id?: number;
  imageUrl?: string | null;
  label?: string | null;
  defectType?: string | null;
  similarity?: number;
  score?: number;
}

export type SearchMode = "hnsw" | "exact" | "bruteforce" | "metadata";

export function resolveUploadImageSrc(imageUrl?: string | null): string {
  if (!imageUrl) return "";
  const trimmed = imageUrl.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed) || /^data:/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/uploads/")) return trimmed;
  if (trimmed.startsWith("uploads/")) return `/${trimmed}`;
  if (trimmed.startsWith("/")) return `/uploads${trimmed}`;
  return `/uploads/${trimmed}`;
}

const MODE_VARIANT: Record<SearchMode, "default" | "secondary" | "outline" | "destructive"> = {
  hnsw: "default",
  exact: "secondary",
  bruteforce: "outline",
  metadata: "destructive",
};

export function SearchModeBadge({ mode }: { mode?: SearchMode | null }) {
  const { t } = useTranslation();
  if (!mode) return null;
  const labels: Record<SearchMode, string> = {
    hnsw: t("is.modeHnsw", "HNSW (nhanh)"),
    exact: t("is.modeExact", "Chính xác (full-scan)"),
    bruteforce: t("is.modeBruteforce", "Brute-force (Node)"),
    metadata: t("is.modeMetadata", "Metadata (fallback)"),
  };
  return (
    <Badge variant={MODE_VARIANT[mode]} className="text-xs">
      {t("is.searchMode", "Chế độ")}: {labels[mode]}
    </Badge>
  );
}

interface Props {
  results: SimilarImageItem[] | null | undefined;
  loading?: boolean;
  searchMode?: SearchMode | null;
  emptyText?: string;
}

export default function SimilarImageGrid({ results, loading, searchMode, emptyText }: Props) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (!results) return null;

  if (results.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-8">
        <Search className="h-8 w-8 mx-auto mb-2 opacity-40" />
        <p>{emptyText ?? t("is.noResults", "Không tìm thấy ảnh tương tự")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-medium">
          {t("is.results", "Kết quả")}: {results.length} {t("is.imagesFound", "ảnh tìm thấy")}
        </h3>
        <SearchModeBadge mode={searchMode} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {results.map((result, idx) => (
          <Card key={result.id ?? idx} className="overflow-hidden">
            {result.imageUrl && (
              <div className="bg-muted">
                <img
                  src={resolveUploadImageSrc(result.imageUrl)}
                  alt={`Similar ${idx + 1}`}
                  className="w-full h-28 object-contain"
                />
              </div>
            )}
            <CardContent className="p-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono">#{result.id ?? idx + 1}</span>
                <Badge variant="outline" className="text-xs">
                  <Percent className="h-3 w-3 mr-0.5" />
                  {((result.similarity ?? result.score ?? 0) * 100).toFixed(1)}%
                </Badge>
              </div>
              <div className="flex flex-wrap gap-1 mt-1">
                {result.label && (
                  <Badge className="text-xs" variant="secondary">
                    {result.label}
                  </Badge>
                )}
                {result.defectType && (
                  <Badge className="text-xs" variant="outline">
                    {result.defectType}
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
