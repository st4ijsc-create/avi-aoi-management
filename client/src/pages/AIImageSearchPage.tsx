import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader, PageContainer } from "@/components/patterns";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Search,
  Upload,
  Image as ImageIcon,
  BarChart3,
  Layers,
  Filter,
  X,
} from "lucide-react";
import { toast } from "sonner";
import SimilarImageGrid, { type SearchMode, type EmbeddingSource } from "@/components/ai/SimilarImageGrid";
import ProposeDefectButton from "@/components/ai/ProposeDefectButton";

export default function AIImageSearchPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("search");
  const [searchEmbeddingId, setSearchEmbeddingId] = useState("");
  const [topK, setTopK] = useState(10);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Upload search state
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [uploadFileName, setUploadFileName] = useState<string | null>(null);
  const [uploadResults, setUploadResults] = useState<any[] | null>(null);
  const [uploadSearchMode, setUploadSearchMode] = useState<SearchMode | null>(null);
  const [uploadEmbeddingSource, setUploadEmbeddingSource] = useState<EmbeddingSource | null>(null);
  const [isUploadSearching, setIsUploadSearching] = useState(false);

  // Filter state
  const [filterMachineId, setFilterMachineId] = useState("");
  const [filterLabel, setFilterLabel] = useState("");
  const [filterDefectType, setFilterDefectType] = useState("");
  const [filterMinSimilarity, setFilterMinSimilarity] = useState(0);

  // P4-F: close the loop — link the uploaded query image to inspection data.
  const [defectInspectionId, setDefectInspectionId] = useState("");
  const [defectPointDefId, setDefectPointDefId] = useState("");
  const [defectMeasResultId, setDefectMeasResultId] = useState("");

  // Queries
  const { data: searchStats } = trpc.aiImageSearch.stats.useQuery({});

  const { data: similarResults, refetch: searchSimilar, isFetching: isSearching } =
    trpc.aiImageSearch.findSimilar.useQuery(
      {
        embeddingId: parseInt(searchEmbeddingId) || 0,
        limit: topK,
        machineId: filterMachineId ? parseInt(filterMachineId) : undefined,
        label: filterLabel || undefined,
        defectType: filterDefectType || undefined,
        minSimilarity: filterMinSimilarity > 0 ? filterMinSimilarity / 100 : undefined,
      },
      { enabled: false },
    );

  // Mutations
  const uploadForSearch = trpc.aiImageSearch.uploadForSearch.useMutation();
  const searchByUpload = trpc.aiImageSearch.searchByUpload.useMutation();

  async function handleFileUploadSearch() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      toast.error(t("is.selectFile", "Chọn ảnh để tìm kiếm"));
      return;
    }
    setIsUploadSearching(true);
    setUploadResults(null);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const { imageKey } = await uploadForSearch.mutateAsync({
        imageData: base64,
        fileName: file.name,
      });

      const result = await searchByUpload.mutateAsync({
        imageKey,
        limit: topK,
        machineId: filterMachineId ? parseInt(filterMachineId) : undefined,
        label: filterLabel || undefined,
        defectType: filterDefectType || undefined,
        minSimilarity: filterMinSimilarity > 0 ? filterMinSimilarity / 100 : undefined,
      });
      setUploadResults(result.results as any[]);
      setUploadSearchMode((result.searchMode ?? null) as SearchMode | null);
      setUploadEmbeddingSource(((result as any).embeddingSource ?? null) as EmbeddingSource | null);
    } catch (err: any) {
      toast.error(err?.message ?? t("common.error", "Lỗi"));
    } finally {
      setIsUploadSearching(false);
    }
  }

  return (
    <DashboardLayout>
      <PageContainer>
        {/* Header */}
        <PageHeader
          icon={<Search className="h-6 w-6" />}
          title={t("is.title", "Tìm kiếm ảnh AI")}
          description={t("is.subtitle", "Tìm kiếm ảnh tương tự bằng AI")}
        />

        {/* Stats */}
        {searchStats && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <ImageIcon className="h-4 w-4 text-info" />
                  <span className="text-sm text-muted-foreground">{t("is.totalImages", "Tổng ảnh")}</span>
                </div>
                <p className="text-2xl font-bold mt-1">{searchStats.totalEmbeddings ?? 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-success" />
                  <span className="text-sm text-muted-foreground">{t("is.indexed", "Đã index")}</span>
                </div>
                <p className="text-2xl font-bold mt-1">{(searchStats as any).indexedCount ?? 0}</p>
                {!(searchStats as any).pgvectorAvailable && (
                  <p className="text-[11px] text-warning mt-0.5">
                    {t("is.pgvectorOff", "pgvector chưa sẵn sàng — dùng fallback")}
                  </p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-primary" />
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
              {t("is.embedTab", "Chỉ mục AI")}
            </TabsTrigger>
          </TabsList>

          {/* Search Tab */}
          <TabsContent value="search">
            <div className="space-y-4">
            {/* ── Upload Search ─────────────────────────────── */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Upload className="h-4 w-4" />
                  {t("is.uploadSearch", "Tìm kiếm bằng ảnh tải lên")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex gap-2 items-center flex-wrap">
                    <input
                      type="file"
                      accept="image/*"
                      ref={fileInputRef}
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setUploadFileName(file.name);
                        const reader = new FileReader();
                        reader.onload = () => setUploadPreview(reader.result as string);
                        reader.readAsDataURL(file);
                        setUploadResults(null);
                      }}
                    />
                    <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                      <Upload className="h-4 w-4 mr-1.5" />
                      {t("is.selectImage", "Chọn ảnh")}
                    </Button>
                    {uploadFileName && (
                      <span className="text-sm text-muted-foreground truncate max-w-xs">
                        {uploadFileName}
                      </span>
                    )}
                    {uploadPreview && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => {
                          setUploadPreview(null);
                          setUploadFileName(null);
                          setUploadResults(null);
                          if (fileInputRef.current) fileInputRef.current.value = "";
                        }}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                  {uploadPreview && (
                    <div className="w-40 h-32 rounded border overflow-hidden bg-muted">
                      <img src={uploadPreview} className="w-full h-full object-contain" alt="preview" />
                    </div>
                  )}
                  <Button
                    onClick={handleFileUploadSearch}
                    disabled={!uploadPreview || isUploadSearching}
                  >
                    <Search className="h-4 w-4 mr-1.5" />
                    {isUploadSearching
                      ? t("is.searching", "Đang tìm…")
                      : t("is.searchByImage", "Tìm theo ảnh")}
                  </Button>

                  {/* Upload search results */}
                  <SimilarImageGrid
                    results={uploadResults}
                    loading={isUploadSearching}
                    searchMode={uploadSearchMode}
                    embeddingSource={uploadEmbeddingSource}
                  />

                  {/* P4-F: close the loop — propose the query image as a defect (HITL). */}
                  {uploadResults && uploadResults.length > 0 && (
                    <div className="space-y-2 pt-3 border-t">
                      <p className="text-xs text-muted-foreground">
                        {t("is.proposeHint", "Gắn ảnh tra cứu này thành bản ghi lỗi (cần tham chiếu inspection / measurement).")}
                      </p>
                      <div className="grid grid-cols-3 gap-2 p-2 rounded border border-dashed bg-muted/20">
                        <div className="space-y-1">
                          <Label className="text-[11px]">{t("is.measurementResult", "Measurement result #")}</Label>
                          <Input type="number" value={defectMeasResultId}
                            onChange={(e) => setDefectMeasResultId(e.target.value)} placeholder={t("is.attach", "gắn vào")} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px]">{t("is.inspectionNum", "Inspection #")}</Label>
                          <Input type="number" value={defectInspectionId}
                            onChange={(e) => setDefectInspectionId(e.target.value)} placeholder={t("is.createNew", "tạo mới")} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px]">{t("is.pointDef", "Point def #")}</Label>
                          <Input type="number" value={defectPointDefId}
                            onChange={(e) => setDefectPointDefId(e.target.value)} placeholder={t("is.createNew", "tạo mới")} />
                        </div>
                      </div>
                      <ProposeDefectButton
                        finding={{
                          source: "image_search",
                          findingText: filterDefectType
                            ? `Similar to known defect: ${filterDefectType}`
                            : "Image-search match to existing NG image(s)",
                          measurementResultId: defectMeasResultId ? Number(defectMeasResultId) : null,
                          inspectionId: defectInspectionId ? Number(defectInspectionId) : null,
                          pointDefId: defectPointDefId ? Number(defectPointDefId) : null,
                        }}
                      />
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* ── Filters ───────────────────────────────────── */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Filter className="h-4 w-4" />
                  {t("is.filters", "Bộ lọc tìm kiếm")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div>
                    <Label className="text-sm">{t("is.machineId", "Machine ID")}</Label>
                    <Input
                      type="number"
                      value={filterMachineId}
                      onChange={(e) => setFilterMachineId(e.target.value)}
                      placeholder={t("is.optional", "Tùy chọn")}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-sm">{t("is.labelFilter", "Nhãn (label)")}</Label>
                    <Input
                      value={filterLabel}
                      onChange={(e) => setFilterLabel(e.target.value)}
                      placeholder={t("is.optional", "Tùy chọn")}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-sm">{t("is.defectType", "Loại lỗi (defect type)")}</Label>
                    <Input
                      value={filterDefectType}
                      onChange={(e) => setFilterDefectType(e.target.value)}
                      placeholder={t("is.optional", "Tùy chọn")}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-sm">
                      {t("is.minSimilarity", "Độ tương đồng tối thiểu")}: {filterMinSimilarity}%
                    </Label>
                    <div className="mt-3 px-1">
                      <Slider
                        min={0}
                        max={100}
                        step={5}
                        value={[filterMinSimilarity]}
                        onValueChange={([v]) => setFilterMinSimilarity(v)}
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* ── Search by Embedding ID ─────────────────────── */}
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
                  <SimilarImageGrid
                    results={similarResults ? Array.from(similarResults as any[]) : undefined}
                    loading={isSearching}
                    searchMode={(similarResults as any)?.searchMode ?? null}
                  />
                </div>
              </CardContent>
            </Card>
            </div>
          </TabsContent>

          {/* Embed Tab */}
          <TabsContent value="embed">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("is.createEmbedding", "Trạng thái chỉ mục AI")}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  {t("is.embedDesc", "Nhúng ảnh (DINOv2 ONNX) được tạo tự động khi có ảnh mới — không cần thao tác thủ công. Tìm kiếm ảnh tự chuyển sang chế độ AI mô tả/label khi không có model chỉ mục phù hợp cho ảnh đó.")}
                </p>
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  {t(
                    "is.embedInfo",
                    "Bạn vẫn có thể dùng tab Tìm kiếm để tra cứu ảnh tải lên hoặc tìm theo ID ảnh đã index trước đây.",
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </PageContainer>
    </DashboardLayout>
  );
}
