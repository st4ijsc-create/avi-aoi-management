import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Search,
  Upload,
  Image as ImageIcon,
  RefreshCw,
  BarChart3,
  Layers,
  Percent,
} from "lucide-react";
import { toast } from "sonner";

export default function AIImageSearchPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("search");
  const [searchEmbeddingId, setSearchEmbeddingId] = useState("");
  const [topK, setTopK] = useState(10);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Queries
  const { data: searchStats } = trpc.aiImageSearch.stats.useQuery({});

  const { data: similarResults, refetch: searchSimilar, isFetching: isSearching } =
    trpc.aiImageSearch.findSimilar.useQuery(
      { embeddingId: parseInt(searchEmbeddingId) || 0, limit: topK },
      { enabled: false },
    );

  const { data: clusterData, refetch: runClustering, isFetching: isClustering } =
    trpc.aiImageSearch.clusterDefects.useQuery({}, { enabled: false });

  // Mutations
  const embedImage = trpc.aiImageSearch.embed.useMutation({
    onSuccess: () => toast.success(t("is.embedded", "Đã tạo embedding cho ảnh")),
    onError: (err) => toast.error(err.message),
  });

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 p-4 md:p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-orange-500/10 flex items-center justify-center">
              <Search className="h-6 w-6 text-orange-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">{t("is.title", "Tìm kiếm ảnh AI")}</h1>
              <p className="text-sm text-muted-foreground">
                {t("is.subtitle", "Tìm kiếm ảnh tương tự bằng AI - Phân cụm lỗi tự động")}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => runClustering()} disabled={isClustering}>
              <Layers className="h-4 w-4 mr-1.5" />
              {t("is.cluster", "Phân cụm")}
            </Button>
          </div>
        </div>

        {/* Stats */}
        {searchStats && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <ImageIcon className="h-4 w-4 text-blue-500" />
                  <span className="text-sm text-muted-foreground">{t("is.totalImages", "Tổng ảnh")}</span>
                </div>
                <p className="text-2xl font-bold mt-1">{searchStats.totalEmbeddings ?? 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-green-500" />
                  <span className="text-sm text-muted-foreground">{t("is.indexed", "Đã index")}</span>
                </div>
                <p className="text-2xl font-bold mt-1">{(searchStats as any).distinctModels ?? 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-purple-500" />
                  <span className="text-sm text-muted-foreground">{t("is.clusters", "Cụm lỗi")}</span>
                </div>
                <p className="text-2xl font-bold mt-1">{(searchStats as any).distinctLabels ?? 0}</p>
              </CardContent>
            </Card>
          </div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="search">
              <Search className="h-4 w-4 mr-1.5" />
              {t("is.searchTab", "Tìm kiếm")}
            </TabsTrigger>
            <TabsTrigger value="embed">
              <Upload className="h-4 w-4 mr-1.5" />
              {t("is.embedTab", "Embedding")}
            </TabsTrigger>
          </TabsList>

          {/* Search Tab */}
          <TabsContent value="search">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("is.findSimilar", "Tìm ảnh tương tự")}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex gap-2 items-end">
                    <div className="flex-1">
                      <Label className="text-sm">{t("is.embeddingId", "Embedding ID")}</Label>
                      <Input
                        value={searchEmbeddingId}
                        onChange={(e) => setSearchEmbeddingId(e.target.value)}
                        placeholder="e.g. 12345"
                        className="mt-1"
                      />
                    </div>
                    <div className="w-24">
                      <Label className="text-sm">Top K</Label>
                      <Input
                        type="number"
                        min={1}
                        max={100}
                        value={topK}
                        onChange={(e) => setTopK(parseInt(e.target.value) || 10)}
                        className="mt-1"
                      />
                    </div>
                    <Button
                      onClick={() => {
                        if (!searchEmbeddingId) {
                          toast.error(t("is.enterEmbeddingId", "Nhập Embedding ID"));
                          return;
                        }
                        searchSimilar();
                      }}
                      disabled={isSearching}
                    >
                      <Search className="h-4 w-4 mr-1.5" />
                      {t("is.search", "Tìm kiếm")}
                    </Button>
                  </div>

                  {/* Search Results */}
                  {isSearching && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-32 w-full rounded-lg" />
                      ))}
                    </div>
                  )}

                  {similarResults && Array.isArray(similarResults) && similarResults.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium mb-2">
                        {t("is.results", "Kết quả")}: {similarResults.length} {t("is.imagesFound", "ảnh tìm thấy")}
                      </h3>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {similarResults.map((result: any, idx: number) => (
                          <Card key={idx} className="overflow-hidden">
                            {result.imageUrl && (
                              <div className="bg-muted">
                                <img
                                  src={result.imageUrl}
                                  alt={`Similar ${idx + 1}`}
                                  className="w-full h-28 object-contain"
                                />
                              </div>
                            )}
                            <CardContent className="p-2">
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-mono">#{result.id || idx + 1}</span>
                                <Badge variant="outline" className="text-xs">
                                  <Percent className="h-3 w-3 mr-0.5" />
                                  {((result.similarity ?? result.score ?? 0) * 100).toFixed(1)}%
                                </Badge>
                              </div>
                              {result.label && (
                                <Badge className="mt-1 text-xs" variant="secondary">{result.label}</Badge>
                              )}
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </div>
                  )}

                  {similarResults && (!Array.isArray(similarResults) || similarResults.length === 0) && (
                    <div className="text-center text-muted-foreground py-8">
                      <Search className="h-8 w-8 mx-auto mb-2 opacity-40" />
                      <p>{t("is.noResults", "Không tìm thấy ảnh tương tự")}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Embed Tab */}
          <TabsContent value="embed">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("is.createEmbedding", "Tạo Embedding")}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  {t("is.embedDesc", "Tạo vector embedding cho ảnh để hỗ trợ tìm kiếm tương tự nhanh hơn.")}
                </p>
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <Label className="text-sm">{t("is.imageId", "Image ID")}</Label>
                    <Input placeholder="e.g. 12345" className="mt-1" id="embed-image-id" />
                  </div>
                  <Button
                    onClick={() => {
                      const input = document.getElementById("embed-image-id") as HTMLInputElement;
                      const val = input?.value?.trim();
                      if (!val) {
                        toast.error(t("is.enterImageId", "Nhập Image ID"));
                        return;
                      }
                      embedImage.mutate({ modelId: 1, imageKey: val });
                    }}
                    disabled={embedImage.isPending}
                  >
                    <Upload className="h-4 w-4 mr-1.5" />
                    {t("is.embed", "Tạo Embedding")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
