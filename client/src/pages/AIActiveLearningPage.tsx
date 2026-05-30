import { useState } from "react";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  GraduationCap,
  RefreshCw,
  CheckCircle,
  XCircle,
  SkipForward,
  BarChart3,
  Inbox,
  Tag,
} from "lucide-react";
import { toast } from "sonner";

export default function AIActiveLearningPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("queue");
  const [selectedLabel, setSelectedLabel] = useState("");
  const [rejectReason, setRejectReason] = useState("");

  // Queries
  const { data: queue, isLoading: loadingQueue, refetch: refetchQueue } =
    trpc.aiActiveLearning.getQueue.useQuery({ limit: 20 });

  const { data: stats } = trpc.aiActiveLearning.stats.useQuery({});

  const { data: labelAccuracy } = trpc.aiActiveLearning.labelAccuracy.useQuery({ modelId: 1 });

  // Mutations
  const submitLabel = trpc.aiActiveLearning.submitLabel.useMutation({
    onSuccess: () => {
      toast.success(t("al.labeled", "Đã gán nhãn thành công"));
      setSelectedLabel("");
      setRejectReason("");
      refetchQueue();
    },
    onError: (err) => toast.error(err.message),
  });

  const skipItem = trpc.aiActiveLearning.skipItem.useMutation({
    onSuccess: () => {
      toast.info(t("al.skipped", "Đã bỏ qua mẫu"));
      refetchQueue();
    },
  });

  const autoLabel = trpc.aiActiveLearning.autoLabel.useMutation({
    onSuccess: (data) => {
      toast.success(t("al.autoLabeled", "Auto label hoàn tất: {{count}} mẫu", { count: data?.autoLabeled ?? 0 }));
      refetchQueue();
    },
    onError: (err) => toast.error(err.message),
  });

  const { data: uncertaintyData } = trpc.aiActiveLearning.uncertaintySampling.useQuery({});

  // WS-1: automatic "scan hard images" (uncertainty / committee) into the queue.
  const scanUncertainty = trpc.aiEval.scanUncertainty.useMutation({
    onSuccess: (data) => {
      toast.success(
        t("al.scanDone", "Quét xong: thêm {{enqueued}} ảnh (bỏ qua {{skipped}} trùng)", {
          enqueued: data?.enqueued ?? 0,
          skipped: data?.skippedExisting ?? 0,
        }),
      );
      refetchQueue();
    },
    onError: (err) => toast.error(err.message),
  });

  const scanCommittee = trpc.aiEval.scanCommittee.useMutation({
    onSuccess: (data) => {
      toast.success(
        t("al.scanDone", "Quét xong: thêm {{enqueued}} ảnh (bỏ qua {{skipped}} trùng)", {
          enqueued: data?.enqueued ?? 0,
          skipped: data?.skippedExisting ?? 0,
        }),
      );
      refetchQueue();
    },
    onError: (err) => toast.error(err.message),
  });

  const { data: retrainData, refetch: refetchRetrain } = trpc.aiActiveLearning.checkRetrain.useQuery(
    { modelId: 1 },
    { enabled: false },
  );

  const currentItem = queue?.[0];

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 p-4 md:p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
              <GraduationCap className="h-6 w-6 text-purple-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">{t("al.title", "Active Learning")}</h1>
              <p className="text-sm text-muted-foreground">
                {t("al.subtitle", "Gán nhãn thông minh - Tối ưu hóa dữ liệu huấn luyện")}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="default"
              size="sm"
              onClick={() => scanUncertainty.mutate({ modelId: 1, sinceHours: 24 })}
              disabled={scanUncertainty.isPending}
            >
              <GraduationCap className="h-4 w-4 mr-1.5" />
              {t("al.scanHard", "Tự quét ảnh khó")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetchRetrain()}>
              {t("al.checkRetrain", "Kiểm tra retrain")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => autoLabel.mutate({ modelId: 1, images: [] })}>
              <Tag className="h-4 w-4 mr-1.5" />
              {t("al.autoLabel", "Auto Label")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetchQueue()}>
              <RefreshCw className="h-4 w-4 mr-1.5" />
              {t("common.refresh", "Làm mới")}
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <Inbox className="h-4 w-4 text-blue-500" />
                  <span className="text-sm text-muted-foreground">{t("al.queueSize", "Hàng đợi")}</span>
                </div>
                <p className="text-2xl font-bold mt-1">{stats.pending ?? 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <span className="text-sm text-muted-foreground">{t("al.labeled", "Đã gán nhãn")}</span>
                </div>
                <p className="text-2xl font-bold mt-1">{stats.labeled ?? 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <SkipForward className="h-4 w-4 text-yellow-500" />
                  <span className="text-sm text-muted-foreground">{t("al.skippedCount", "Bỏ qua")}</span>
                </div>
                <p className="text-2xl font-bold mt-1">{stats.skipped ?? 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-purple-500" />
                  <span className="text-sm text-muted-foreground">{t("al.accuracy", "Độ chính xác")}</span>
                </div>
                <p className="text-2xl font-bold mt-1">
                  {labelAccuracy?.accuracy != null ? `${(labelAccuracy.accuracy * 100).toFixed(1)}%` : "N/A"}
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="queue">
              <Inbox className="h-4 w-4 mr-1.5" />
              {t("al.reviewQueue", "Hàng đợi đánh giá")}
            </TabsTrigger>
            <TabsTrigger value="sampling">
              <BarChart3 className="h-4 w-4 mr-1.5" />
              {t("al.sampling", "Sampling")}
            </TabsTrigger>
          </TabsList>

          {/* Review Queue */}
          <TabsContent value="queue">
            <div className="grid md:grid-cols-2 gap-4">
              {/* Current item to label */}
              <Card className="md:col-span-1">
                <CardHeader>
                  <CardTitle className="text-base">{t("al.currentSample", "Mẫu hiện tại")}</CardTitle>
                </CardHeader>
                <CardContent>
                  {loadingQueue ? (
                    <Skeleton className="h-48 w-full" />
                  ) : currentItem ? (
                    <div className="space-y-4">
                      {currentItem.imageUrl && (
                        <div className="border rounded-lg overflow-hidden bg-muted">
                          <img
                            src={`/uploads/${currentItem.imageUrl}`}
                            alt="Sample"
                            className="w-full h-48 object-contain"
                          />
                        </div>
                      )}
                      <div className="text-sm space-y-1">
                        <p><span className="text-muted-foreground">ID:</span> #{currentItem.id}</p>
                        {currentItem.predictedLabel && (
                          <p>
                            <span className="text-muted-foreground">{t("al.predicted", "Dự đoán")}:</span>{" "}
                            <Badge variant="outline">{currentItem.predictedLabel}</Badge>
                            {currentItem.confidence != null && (
                              <span className="text-xs text-muted-foreground ml-2">
                                ({(Number(currentItem.confidence) * 100).toFixed(1)}%)
                              </span>
                            )}
                          </p>
                        )}
                        {currentItem.uncertainty != null && (
                          <p>
                            <span className="text-muted-foreground">{t("al.uncertainty", "Uncertainty")}:</span>{" "}
                            {(Number(currentItem.uncertainty) * 100).toFixed(1)}%
                          </p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Select value={selectedLabel} onValueChange={setSelectedLabel}>
                          <SelectTrigger>
                            <SelectValue placeholder={t("al.selectLabel", "Chọn nhãn...")} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="OK">OK</SelectItem>
                            <SelectItem value="NG">NG</SelectItem>
                            <SelectItem value="DEFECT">DEFECT</SelectItem>
                            <SelectItem value="SCRATCH">SCRATCH</SelectItem>
                            <SelectItem value="DENT">DENT</SelectItem>
                            <SelectItem value="STAIN">STAIN</SelectItem>
                          </SelectContent>
                        </Select>
                        <div className="flex gap-2">
                          <Button
                            className="flex-1"
                            disabled={!selectedLabel || submitLabel.isPending}
                            onClick={() => {
                              submitLabel.mutate({
                                queueId: currentItem.id,
                                humanLabel: selectedLabel,
                              });
                            }}
                          >
                            <CheckCircle className="h-4 w-4 mr-1.5" />
                            {t("al.submit", "Xác nhận")}
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => skipItem.mutate({ queueId: currentItem.id })}
                            disabled={skipItem.isPending}
                          >
                            <SkipForward className="h-4 w-4 mr-1.5" />
                            {t("al.skip", "Bỏ qua")}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center text-muted-foreground py-12">
                      <Inbox className="h-10 w-10 mx-auto mb-2 opacity-40" />
                      <p>{t("al.emptyQueue", "Hàng đợi trống")}</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Queue list */}
              <Card className="md:col-span-1">
                <CardHeader>
                  <CardTitle className="text-base">
                    {t("al.upcomingItems", "Mẫu tiếp theo")}
                    {queue && <Badge className="ml-2" variant="secondary">{queue.length}</Badge>}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>ID</TableHead>
                        <TableHead>{t("al.predicted", "Dự đoán")}</TableHead>
                        <TableHead>{t("al.strategy", "Chiến lược")}</TableHead>
                        <TableHead>{t("al.uncertainty", "Uncertainty")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {queue?.slice(1, 10).map((item: any) => (
                        <TableRow key={item.id}>
                          <TableCell className="font-mono text-xs">#{item.id}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{item.predictedLabel || "-"}</Badge>
                          </TableCell>
                          <TableCell className="text-xs">
                            <Badge variant="secondary">{item.samplingStrategy || "-"}</Badge>
                          </TableCell>
                          <TableCell className="text-xs">
                            {item.samplingStrategy === "COMMITTEE" && item.ensembleDisagreement != null
                              ? `${(Number(item.ensembleDisagreement) * 100).toFixed(1)}% ${t("al.disagreement", "bất đồng")}`
                              : item.uncertainty != null ? `${(Number(item.uncertainty) * 100).toFixed(1)}%` : "-"}
                          </TableCell>
                        </TableRow>
                      ))}
                      {(!queue || queue.length <= 1) && (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center text-muted-foreground py-4">
                            {t("al.noMore", "Không có mẫu tiếp theo")}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Sampling Controls */}
          <TabsContent value="sampling">
            <div className="grid md:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t("al.uncertaintySampling", "Uncertainty Sampling")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4">
                    {t("al.uncertaintyDesc", "Lấy mẫu các items mà mô hình không chắc chắn nhất để gán nhãn.")}
                  </p>
                  <p className="text-sm mb-3">
                    {uncertaintyData
                      ? t("al.samplingResult", "Đã tìm thấy {{count}} mẫu uncertain", { count: Array.isArray(uncertaintyData) ? uncertaintyData.length : 0 })
                      : t("al.samplingLoading", "Đang tải dữ liệu sampling...")}
                  </p>
                  <div className="flex flex-col gap-2">
                    <Button
                      size="sm"
                      onClick={() => scanUncertainty.mutate({ modelId: 1, uncertaintyThreshold: 0.5, sinceHours: 24 })}
                      disabled={scanUncertainty.isPending}
                    >
                      {t("al.scanUncertainty", "Quét uncertainty → hàng đợi")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => scanCommittee.mutate({ modelIds: [1, 2], disagreementThreshold: 0.5, sinceHours: 24 })}
                      disabled={scanCommittee.isPending}
                    >
                      {t("al.scanCommittee", "Quét committee (≥2 model)")}
                    </Button>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t("al.retrainCheck", "Kiểm tra Retrain")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4">
                    {t("al.retrainDesc", "Kiểm tra xem mô hình có cần được huấn luyện lại với dữ liệu mới không.")}
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => refetchRetrain()}
                  >
                    {t("al.checkNow", "Kiểm tra ngay")}
                  </Button>
                  {retrainData && (
                    <p className="text-sm mt-2">
                      {(retrainData as any)?.shouldRetrain
                        ? t("al.retrainRequired", "Mô hình cần được huấn luyện lại")
                        : t("al.retrainNotRequired", "Mô hình đang hoạt động tốt")}
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
