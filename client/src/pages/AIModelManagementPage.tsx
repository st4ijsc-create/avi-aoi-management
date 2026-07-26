import { useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader, PageContainer, MetricCard, StatusBadge, EmptyState } from "@/components/patterns";
import { trpc } from "@/lib/trpc";
import { usePollingInterval } from "@/hooks/usePollingInterval";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
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
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { DatasetSelect } from "@/components/ai/ModelSelect";
import { ClassifierHealthBanner } from "@/components/ai/ClassifierHealthBanner";
import { toast } from "sonner";
import {
  Plus,
  Edit2,
  Trash2,
  Upload,
  Brain,
  Search,
  RefreshCw,
  Eye,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Archive,
  FileUp,
  GitBranch,
  Loader2,
  Download,
  MoreHorizontal,
  Cpu,
  Box,
  Rocket,
  Play,
  X,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────
type ModelFormat = "ONNX" | "TENSORRT" | "OPENVINO" | "CUSTOM";
type ModelStatus = "UPLOADING" | "VALIDATING" | "READY" | "ACTIVE" | "INACTIVE" | "FAILED" | "ARCHIVED";

interface PreprocessConfig {
  resize?: { width: number; height: number };
  normalize?: { mean: number[]; std: number[] };
  colorSpace?: "RGB" | "BGR" | "GRAY";
  channelFirst?: boolean;
}

interface PostprocessConfig {
  type: string;
  confidenceThreshold?: number;
  nmsThreshold?: number;
  topK?: number;
}

interface ModelFormData {
  code: string;
  name: string;
  description: string;
  modelType: string;
  format: ModelFormat;
  inputShape: string;
  outputShape: string;
  labels: string;
  preprocessConfig: PreprocessConfig;
  postprocessConfig: PostprocessConfig;
  metadata: string;
}

const EMPTY_FORM: ModelFormData = {
  code: "",
  name: "",
  description: "",
  modelType: "classification",
  format: "ONNX",
  inputShape: "",
  outputShape: "",
  labels: "",
  preprocessConfig: {
    resize: { width: 224, height: 224 },
    colorSpace: "RGB",
    channelFirst: true,
  },
  postprocessConfig: {
    type: "classification",
    confidenceThreshold: 0.5,
    topK: 5,
  },
  metadata: "",
};

const MODEL_FORMATS: ModelFormat[] = ["ONNX", "TENSORRT", "OPENVINO", "CUSTOM"];
const MODEL_TYPES = ["classification", "object_detection", "segmentation", "anomaly_detection", "custom"];

const STATUS_CONFIG: Record<ModelStatus, { color: string; icon: typeof CheckCircle2 }> = {
  ACTIVE: { color: "default", icon: CheckCircle2 },
  READY: { color: "secondary", icon: Clock },
  VALIDATING: { color: "secondary", icon: RefreshCw },
  UPLOADING: { color: "secondary", icon: Upload },
  INACTIVE: { color: "outline", icon: XCircle },
  FAILED: { color: "destructive", icon: AlertTriangle },
  ARCHIVED: { color: "outline", icon: Archive },
};

// Semantic-token tints (theme-aware, no per-mode palette overrides).
const FORMAT_COLORS: Record<ModelFormat, string> = {
  ONNX: "bg-info/15 text-info",
  TENSORRT: "bg-success/15 text-success",
  OPENVINO: "bg-primary/15 text-primary",
  CUSTOM: "bg-warning/15 text-warning",
};

function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Model Form Dialog ───────────────────────────────────
function ModelFormDialog({
  open,
  onOpenChange,
  initialData,
  onSubmit,
  isLoading,
  isEdit,
  t,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialData: ModelFormData;
  onSubmit: (data: ModelFormData) => void;
  isLoading: boolean;
  isEdit: boolean;
  t: (key: string, fallback?: string) => string;
}) {
  const [form, setForm] = useState<ModelFormData>(initialData);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleChange = (field: keyof ModelFormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(form);
  };

  // Reset form when dialog opens
  const handleOpenChange = (v: boolean) => {
    if (v) setForm(initialData);
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            {isEdit
              ? t("aiModels.editModel", "Edit Model")
              : t("aiModels.createModel", "Create Model")}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? t("aiModels.editModelDesc", "Update model metadata and configuration")
              : t("aiModels.createModelDesc", "Register a new AI model in the system")}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          <form id="model-form" onSubmit={handleSubmit} className="space-y-5 pb-2">
            {/* Basic Info */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="code">{t("aiModels.fields.code", "Code")} *</Label>
                <Input
                  id="code"
                  value={form.code}
                  onChange={(e) => handleChange("code", e.target.value)}
                  placeholder="e.g. deepseek-v2"
                  required
                  disabled={isEdit}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">{t("aiModels.fields.name", "Name")} *</Label>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(e) => handleChange("name", e.target.value)}
                  placeholder="e.g. DeepSeek V2"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">{t("aiModels.fields.description", "Description")}</Label>
              <Input
                id="description"
                value={form.description}
                onChange={(e) => handleChange("description", e.target.value)}
                placeholder={t("aiModels.fields.descriptionPlaceholder", "Model description...")}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("aiModels.fields.modelType", "Model Type")} *</Label>
                <Select value={form.modelType} onValueChange={(v) => handleChange("modelType", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODEL_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {t(`aiModels.types.${type}`, type)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("aiModels.fields.format", "Format")}</Label>
                <Select value={form.format} onValueChange={(v) => handleChange("format", v as ModelFormat)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODEL_FORMATS.map((fmt) => (
                      <SelectItem key={fmt} value={fmt}>
                        {fmt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("aiModels.fields.inputShape", "Input Shape")}</Label>
                <Input
                  value={form.inputShape}
                  onChange={(e) => handleChange("inputShape", e.target.value)}
                  placeholder="e.g. 1,3,224,224"
                />
              </div>
              <div className="space-y-2">
                <Label>{t("aiModels.fields.outputShape", "Output Shape")}</Label>
                <Input
                  value={form.outputShape}
                  onChange={(e) => handleChange("outputShape", e.target.value)}
                  placeholder="e.g. 1,1000"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t("aiModels.fields.labels", "Labels")}</Label>
              <Input
                value={form.labels}
                onChange={(e) => handleChange("labels", e.target.value)}
                placeholder={t("aiModels.fields.labelsPlaceholder", "Comma-separated: OK, NG, Scratch, Dent")}
              />
            </div>

            {/* Advanced Config Toggle */}
            <div className="flex items-center gap-2 pt-2">
              <Switch checked={showAdvanced} onCheckedChange={setShowAdvanced} />
              <Label className="cursor-pointer" onClick={() => setShowAdvanced(!showAdvanced)}>
                {t("aiModels.advancedConfig", "Advanced Configuration")}
              </Label>
            </div>

            {showAdvanced && (
              <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
                {/* Preprocess Config */}
                <div>
                  <h4 className="text-sm font-semibold mb-3">{t("aiModels.preprocess", "Preprocessing")}</h4>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">{t("aiModels.fields.resizeW", "Resize Width")}</Label>
                      <Input
                        type="number"
                        value={form.preprocessConfig.resize?.width ?? ""}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            preprocessConfig: {
                              ...prev.preprocessConfig,
                              resize: {
                                width: Number(e.target.value) || 0,
                                height: prev.preprocessConfig.resize?.height ?? 224,
                              },
                            },
                          }))
                        }
                        placeholder="224"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t("aiModels.fields.resizeH", "Resize Height")}</Label>
                      <Input
                        type="number"
                        value={form.preprocessConfig.resize?.height ?? ""}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            preprocessConfig: {
                              ...prev.preprocessConfig,
                              resize: {
                                width: prev.preprocessConfig.resize?.width ?? 224,
                                height: Number(e.target.value) || 0,
                              },
                            },
                          }))
                        }
                        placeholder="224"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t("aiModels.fields.colorSpace", "Color Space")}</Label>
                      <Select
                        value={form.preprocessConfig.colorSpace ?? "RGB"}
                        onValueChange={(v) =>
                          setForm((prev) => ({
                            ...prev,
                            preprocessConfig: { ...prev.preprocessConfig, colorSpace: v as "RGB" | "BGR" | "GRAY" },
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="RGB">RGB</SelectItem>
                          <SelectItem value="BGR">BGR</SelectItem>
                          <SelectItem value="GRAY">GRAY</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                {/* Postprocess Config */}
                <div>
                  <h4 className="text-sm font-semibold mb-3">{t("aiModels.postprocess", "Postprocessing")}</h4>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">{t("aiModels.fields.postType", "Type")}</Label>
                      <Select
                        value={form.postprocessConfig.type}
                        onValueChange={(v) =>
                          setForm((prev) => ({
                            ...prev,
                            postprocessConfig: { ...prev.postprocessConfig, type: v },
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="classification">Classification</SelectItem>
                          <SelectItem value="detection">Detection</SelectItem>
                          <SelectItem value="segmentation">Segmentation</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t("aiModels.fields.confidence", "Confidence")}</Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        max="1"
                        value={form.postprocessConfig.confidenceThreshold ?? 0.5}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            postprocessConfig: {
                              ...prev.postprocessConfig,
                              confidenceThreshold: Number(e.target.value) || 0.5,
                            },
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t("aiModels.fields.topK", "Top K")}</Label>
                      <Input
                        type="number"
                        min="1"
                        value={form.postprocessConfig.topK ?? 5}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            postprocessConfig: { ...prev.postprocessConfig, topK: Number(e.target.value) || 5 },
                          }))
                        }
                      />
                    </div>
                  </div>
                </div>

                {/* Metadata */}
                <div className="space-y-2">
                  <Label>{t("aiModels.fields.metadata", "Metadata (JSON)")}</Label>
                  <Input
                    value={form.metadata}
                    onChange={(e) => handleChange("metadata", e.target.value)}
                    placeholder='{"author": "team-ai", "framework": "pytorch"}'
                  />
                </div>
              </div>
            )}
          </form>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            {t("common.cancel", "Cancel")}
          </Button>
          <Button type="submit" form="model-form" disabled={isLoading}>
            {isLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {isEdit ? t("common.save", "Save") : t("common.create", "Create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── File Upload Dialog ──────────────────────────────────
function UploadDialog({
  open,
  onOpenChange,
  modelId,
  modelCode,
  onSuccess,
  t,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modelId: number;
  modelCode: string;
  onSuccess: () => void;
  t: (key: string, fallback?: string) => string;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const uploadMutation = trpc.aiModel.uploadFile.useMutation({
    onSuccess: () => {
      toast.success(t("aiModels.uploadSuccess", "Model file uploaded successfully"));
      setFile(null);
      onOpenChange(false);
      onSuccess();
    },
    onError: (err) => {
      toast.error(err.message);
      setUploading(false);
    },
  });

  const handleUpload = useCallback(async () => {
    if (!file) return;
    setUploading(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);
      uploadMutation.mutate({
        modelId,
        fileBase64: base64,
        filename: file.name,
        contentType: file.type || "application/octet-stream",
      });
    } catch {
      toast.error(t("aiModels.uploadError", "Failed to read file"));
      setUploading(false);
    }
  }, [file, modelId, uploadMutation, t]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileUp className="h-5 w-5" />
            {t("aiModels.uploadFile", "Upload Model File")}
          </DialogTitle>
          <DialogDescription>
            {t("aiModels.uploadFileDesc", "Upload a model file for")} <strong>{modelCode}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div
            className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            {file ? (
              <div>
                <p className="font-medium">{file.name}</p>
                <p className="text-sm text-muted-foreground">{formatFileSize(file.size)}</p>
              </div>
            ) : (
              <div>
                <p className="text-sm text-muted-foreground">
                  {t("aiModels.dropzone", "Click to select a model file")}
                </p>
                <p className="text-xs text-muted-foreground mt-1">.onnx, .trt, .bin, .xml, .pt, .safetensors</p>
              </div>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".onnx,.trt,.bin,.xml,.pt,.safetensors,.pth,.h5"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={uploading}>
            {t("common.cancel", "Cancel")}
          </Button>
          <Button onClick={handleUpload} disabled={!file || uploading}>
            {uploading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {t("aiModels.upload", "Upload")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Create Version Dialog ───────────────────────────────
function CreateVersionDialog({
  open,
  onOpenChange,
  modelId,
  modelCode,
  onSuccess,
  t,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modelId: number;
  modelCode: string;
  onSuccess: () => void;
  t: (key: string, fallback?: string) => string;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [version, setVersion] = useState("");
  const [changeLog, setChangeLog] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const createVersionMutation = trpc.aiModel.createVersion.useMutation({
    onSuccess: () => {
      toast.success(t("aiModels.versionCreated", "Version created successfully"));
      setVersion("");
      setChangeLog("");
      setFile(null);
      onOpenChange(false);
      onSuccess();
    },
    onError: (err) => {
      toast.error(err.message);
      setUploading(false);
    },
  });

  const handleSubmit = useCallback(async () => {
    if (!file || !version.trim()) return;
    setUploading(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);
      createVersionMutation.mutate({
        modelId,
        version: version.trim(),
        fileBase64: base64,
        filename: file.name,
        changeLog: changeLog.trim() || undefined,
      });
    } catch {
      toast.error(t("aiModels.uploadError", "Failed to read file"));
      setUploading(false);
    }
  }, [file, version, changeLog, modelId, createVersionMutation, t]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="h-5 w-5" />
            {t("aiModels.createVersion", "Create Version")}
          </DialogTitle>
          <DialogDescription>
            {t("aiModels.createVersionDesc", "Upload a new version for")} <strong>{modelCode}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t("aiModels.fields.version", "Version")} *</Label>
            <Input
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="e.g. 1.0.0, v2, beta-3"
              required
            />
          </div>

          <div className="space-y-2">
            <Label>{t("aiModels.fields.changeLog", "Change Log")}</Label>
            <Input
              value={changeLog}
              onChange={(e) => setChangeLog(e.target.value)}
              placeholder={t("aiModels.fields.changeLogPlaceholder", "What changed in this version...")}
            />
          </div>

          <div
            className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
            {file ? (
              <div>
                <p className="font-medium text-sm">{file.name}</p>
                <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("aiModels.selectFile", "Click to select model file")} *
              </p>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".onnx,.trt,.bin,.xml,.pt,.safetensors,.pth,.h5"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={uploading}>
            {t("common.cancel", "Cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={!file || !version.trim() || uploading}>
            {uploading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {t("aiModels.createVersion", "Create Version")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Training Pipeline Dialog (WS-1) ─────────────────────
function TrainingPipelineDialog({
  open,
  onOpenChange,
  modelId,
  modelCode,
  modelLabels,
  onSuccess,
  t,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modelId: number;
  modelCode: string;
  modelLabels: string[];
  onSuccess: () => void;
  t: (key: string, fallback?: string) => string;
}) {
  const [targetVersion, setTargetVersion] = useState("");
  const [datasetId, setDatasetId] = useState("");
  const [strategy, setStrategy] = useState<"transfer" | "fewshot">("transfer");
  const [labelsCsv, setLabelsCsv] = useState(modelLabels.join(", "));

  const startPipeline = trpc.aiEval.startPipeline.useMutation({
    onSuccess: () => {
      toast.success(t("aiEval.pipelineStarted", "Đã khởi tạo training job"));
      setTargetVersion("");
      setDatasetId("");
      onOpenChange(false);
      onSuccess();
    },
    onError: (err) => toast.error(err.message),
  });

  const classLabels = labelsCsv.split(",").map((s) => s.trim()).filter(Boolean);
  const canSubmit = !!targetVersion.trim() && !!datasetId && classLabels.length >= 2;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="h-5 w-5" />
            {t("aiEval.startTraining", "Khởi tạo Training Pipeline")}
          </DialogTitle>
          <DialogDescription>
            {t("aiEval.startTrainingDesc", "Huấn luyện phiên bản mới cho")} <strong>{modelCode}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t("aiModels.fields.version", "Target Version")} *</Label>
            <Input
              value={targetVersion}
              onChange={(e) => setTargetVersion(e.target.value)}
              placeholder="e.g. 1.1.0"
            />
          </div>

          <div className="space-y-2">
            <Label>{t("aiEval.dataset", "Dataset")} *</Label>
            <DatasetSelect value={datasetId} onChange={setDatasetId} modelId={modelId} />
          </div>

          <div className="space-y-2">
            <Label>{t("aiEval.classLabels", "Class Labels (≥2, phân tách bằng dấu phẩy)")} *</Label>
            <Input
              value={labelsCsv}
              onChange={(e) => setLabelsCsv(e.target.value)}
              placeholder="OK, NG"
            />
            <p className="text-xs text-muted-foreground">{classLabels.length} {t("aiEval.labelsCount", "nhãn")}</p>
          </div>

          <div className="space-y-2">
            <Label>{t("aiEval.strategy", "Strategy")}</Label>
            <Select value={strategy} onValueChange={(v) => setStrategy(v as "transfer" | "fewshot")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="transfer">transfer</SelectItem>
                <SelectItem value="fewshot">fewshot</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={startPipeline.isPending}>
            {t("common.cancel", "Cancel")}
          </Button>
          <Button
            onClick={() =>
              startPipeline.mutate({
                modelId,
                targetVersion: targetVersion.trim(),
                classLabels,
                datasetId: Number(datasetId),
                strategy,
              })
            }
            disabled={!canSubmit || startPipeline.isPending}
          >
            {startPipeline.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Play className="h-4 w-4 mr-2" />
            )}
            {t("aiEval.startTraining", "Khởi tạo")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Training Jobs List (WS-1) ───────────────────────────
function TrainingJobsList({ modelId, t }: { modelId: number; t: (key: string, fallback?: string) => string }) {
  // Poll hygiene (doc 27 B12): pause the 5s poll when the tab is hidden.
  const polling = usePollingInterval(5000);
  const { data, isLoading } = trpc.aiLocalTraining.listJobs.useQuery(
    { modelId, limit: 20, offset: 0 },
    { ...polling },
  );
  const jobs = data?.items;

  if (isLoading) return <Skeleton className="h-20 w-full" />;
  if (!jobs || jobs.length === 0) {
    return (
      <EmptyState
        variant="no-data"
        icon={Rocket}
        title={t("aiEval.noJobs", "Chưa có training job")}
        description={t("aiEval.noJobsDesc", "Khởi tạo một training pipeline để bắt đầu")}
        compact
      />
    );
  }

  const jobStatusColor = (s: string): "default" | "secondary" | "destructive" | "outline" => {
    switch (s) {
      case "COMPLETED": return "default";
      case "RUNNING": case "TRAINING": case "QUEUED": return "secondary";
      case "FAILED": case "CANCELLED": return "destructive";
      default: return "outline";
    }
  };

  return (
    <div className="space-y-2">
      {jobs.map((job: any) => (
        <div key={job.id} className="border rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{job.name}</p>
              <p className="text-xs text-muted-foreground font-mono">→ {job.targetVersion}</p>
            </div>
            <StatusBadge status={job.status} variant={jobStatusColor(job.status)} className="text-xs" />
          </div>
          <div className="flex items-center gap-2">
            <Progress value={job.progress ?? 0} className="h-2 flex-1" />
            <span className="text-xs text-muted-foreground w-10 text-right">{job.progress ?? 0}%</span>
          </div>
          {job.errorMessage && (
            <p className="text-xs text-destructive">{job.errorMessage}</p>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Model Detail Panel ──────────────────────────────────
function ModelDetailPanel({
  modelId,
  onClose,
  onRefresh,
  t,
}: {
  modelId: number;
  onClose: () => void;
  onRefresh: () => void;
  t: (key: string, fallback?: string) => string;
}) {
  const { data: model, isLoading } = trpc.aiModel.getById.useQuery({ id: modelId });
  const { data: versions, refetch: refetchVersions } = trpc.aiModel.listVersions.useQuery({ modelId });

  const activateMutation = trpc.aiModel.activateVersion.useMutation({
    onSuccess: () => {
      toast.success(t("aiModels.versionActivated", "Version activated"));
      refetchVersions();
      onRefresh();
    },
    onError: (err) => toast.error(err.message),
  });

  const [showUpload, setShowUpload] = useState(false);
  const [showCreateVersion, setShowCreateVersion] = useState(false);
  const [showTraining, setShowTraining] = useState(false);

  if (isLoading) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!model) return null;

  const statusCfg = STATUS_CONFIG[model.status as ModelStatus] ?? STATUS_CONFIG.INACTIVE;
  const StatusIcon = statusCfg.icon;

  return (
    <div className="space-y-4">
      {/* Model Header */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Cpu className="h-5 w-5" />
            {model.name}
          </h3>
          <p className="text-sm text-muted-foreground font-mono">{model.code}</p>
          {model.description && (
            <p className="text-sm text-muted-foreground mt-1">{model.description}</p>
          )}
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} title={t("common.close", "Close")}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Info Grid */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <span className="text-muted-foreground">{t("aiModels.fields.status", "Status")}:</span>{" "}
          <StatusBadge
            status={model.status}
            variant={statusCfg.color as "default" | "secondary" | "destructive" | "outline"}
            label={
              <span className="inline-flex items-center">
                <StatusIcon className="h-3 w-3 mr-1" />
                {model.status}
              </span>
            }
          />
        </div>
        <div>
          <span className="text-muted-foreground">{t("aiModels.fields.format", "Format")}:</span>{" "}
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${FORMAT_COLORS[(model.format as ModelFormat) ?? "CUSTOM"]}`}>
            {model.format ?? "—"}
          </span>
        </div>
        <div>
          <span className="text-muted-foreground">{t("aiModels.fields.modelType", "Type")}:</span>{" "}
          {model.modelType}
        </div>
        <div>
          <span className="text-muted-foreground">{t("aiModels.fields.version", "Version")}:</span>{" "}
          {model.currentVersion ?? "—"}
        </div>
        <div>
          <span className="text-muted-foreground">{t("aiModels.fields.fileSize", "File Size")}:</span>{" "}
          {formatFileSize(model.fileSize)}
        </div>
        <div>
          <span className="text-muted-foreground">{t("aiModels.fields.created", "Created")}:</span>{" "}
          {formatDate(model.createdAt)}
        </div>
        {model.inputShape && (
          <div>
            <span className="text-muted-foreground">{t("aiModels.fields.inputShape", "Input")}:</span>{" "}
            <span className="font-mono text-xs">[{(model.inputShape as number[]).join(", ")}]</span>
          </div>
        )}
        {model.outputShape && (
          <div>
            <span className="text-muted-foreground">{t("aiModels.fields.outputShape", "Output")}:</span>{" "}
            <span className="font-mono text-xs">[{(model.outputShape as number[]).join(", ")}]</span>
          </div>
        )}
        {model.labels && (model.labels as string[]).length > 0 && (
          <div className="col-span-2">
            <span className="text-muted-foreground">{t("aiModels.fields.labels", "Labels")}:</span>{" "}
            <div className="flex flex-wrap gap-1 mt-1">
              {(model.labels as string[]).map((l) => (
                <Badge key={l} variant="outline" className="text-xs">
                  {l}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => setShowUpload(true)}>
          <FileUp className="h-4 w-4 mr-1" />
          {t("aiModels.uploadFile", "Upload File")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setShowCreateVersion(true)}>
          <GitBranch className="h-4 w-4 mr-1" />
          {t("aiModels.newVersion", "New Version")}
        </Button>
        <Button size="sm" onClick={() => setShowTraining(true)}>
          <Rocket className="h-4 w-4 mr-1" />
          {t("aiEval.trainModel", "Train Model")}
        </Button>
      </div>

      {/* Training Jobs (WS-1) */}
      <div>
        <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <Rocket className="h-4 w-4" />
          {t("aiEval.trainingJobs", "Training Jobs")}
        </h4>
        <TrainingJobsList modelId={modelId} t={t} />
      </div>

      {/* Versions Table */}
      <div>
        <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <GitBranch className="h-4 w-4" />
          {t("aiModels.versions", "Versions")} ({versions?.length ?? 0})
        </h4>
        {versions && versions.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("aiModels.fields.version", "Version")}</TableHead>
                <TableHead>{t("aiModels.fields.status", "Status")}</TableHead>
                <TableHead>{t("aiModels.fields.fileSize", "Size")}</TableHead>
                <TableHead>{t("aiModels.fields.changeLog", "Change Log")}</TableHead>
                <TableHead className="text-right">{t("common.action", "Action")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {versions.map((v: any) => {
                const vstatus = STATUS_CONFIG[v.status as ModelStatus] ?? STATUS_CONFIG.INACTIVE;
                const VIcon = vstatus.icon;
                return (
                  <TableRow key={v.id} className={v.status === "ACTIVE" ? "bg-primary/5" : ""}>
                    <TableCell className="font-mono text-sm">
                      {v.status === "ACTIVE" && <CheckCircle2 className="h-3.5 w-3.5 inline mr-1 text-success" />}
                      {v.version}
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        status={v.status}
                        variant={vstatus.color as "default" | "secondary" | "destructive" | "outline"}
                        className="text-xs"
                        label={
                          <span className="inline-flex items-center">
                            <VIcon className="h-3 w-3 mr-1" />
                            {v.status}
                          </span>
                        }
                      />
                    </TableCell>
                    <TableCell className="text-xs">{formatFileSize(v.fileSize)}</TableCell>
                    <TableCell className="text-xs max-w-37.5 truncate">
                      {v.changeLog || <span className="italic text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      {v.status !== "ACTIVE" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => activateMutation.mutate({ modelId, versionId: v.id })}
                          disabled={activateMutation.isPending}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                          {t("aiModels.activate", "Activate")}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <EmptyState
            variant="no-data"
            icon={Archive}
            title={t("aiModels.noVersions", "No versions yet")}
            description={t("aiModels.noVersionsDesc", "Upload a file or create a version to get started")}
            compact
          />
        )}
      </div>

      {/* Upload & Version Dialogs */}
      {showUpload && (
        <UploadDialog
          open={showUpload}
          onOpenChange={setShowUpload}
          modelId={modelId}
          modelCode={model.code}
          onSuccess={() => {
            refetchVersions();
            onRefresh();
          }}
          t={t}
        />
      )}
      {showCreateVersion && (
        <CreateVersionDialog
          open={showCreateVersion}
          onOpenChange={setShowCreateVersion}
          modelId={modelId}
          modelCode={model.code}
          onSuccess={() => {
            refetchVersions();
            onRefresh();
          }}
          t={t}
        />
      )}
      {showTraining && (
        <TrainingPipelineDialog
          open={showTraining}
          onOpenChange={setShowTraining}
          modelId={modelId}
          modelCode={model.code}
          modelLabels={(model.labels as string[]) ?? []}
          onSuccess={() => {
            refetchVersions();
            onRefresh();
          }}
          t={t}
        />
      )}
    </div>
  );
}

// ─── Delete Confirmation ─────────────────────────────────
function DeleteConfirmDialog({
  open,
  onOpenChange,
  modelName,
  onConfirm,
  isLoading,
  t,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modelName: string;
  onConfirm: () => void;
  isLoading: boolean;
  t: (key: string, fallback?: string) => string;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-5 w-5" />
            {t("aiModels.deleteModel", "Delete Model")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("aiModels.deleteConfirm", "Are you sure you want to delete")} <strong>{modelName}</strong>?{" "}
            {t("aiModels.deleteWarning", "This action cannot be undone.")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>
            {t("common.cancel", "Cancel")}
          </AlertDialogCancel>
          <Button variant="destructive" onClick={onConfirm} disabled={isLoading}>
            {isLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {t("common.delete", "Delete")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Main Page Component ─────────────────────────────────
export default function AIModelManagementPage() {
  const { t } = useTranslation();

  // ─ State
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingModel, setEditingModel] = useState<any | null>(null);
  const [deletingModel, setDeletingModel] = useState<any | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterFormat, setFilterFormat] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  // ─ Queries
  const { data: models, isLoading, refetch } = trpc.aiModel.list.useQuery({ limit: 200 });

  // ─ Mutations
  const createMutation = trpc.aiModel.create.useMutation({
    onSuccess: () => {
      toast.success(t("aiModels.created", "Model registered successfully"));
      setShowCreateDialog(false);
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = trpc.aiModel.update.useMutation({
    onSuccess: () => {
      toast.success(t("aiModels.updated", "Model updated successfully"));
      setEditingModel(null);
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.aiModel.delete.useMutation({
    onSuccess: () => {
      toast.success(t("aiModels.deleted", "Model deleted"));
      setDeletingModel(null);
      if (selectedModelId === deletingModel?.id) setSelectedModelId(null);
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  // ─ Form handlers
  const handleCreate = (form: ModelFormData) => {
    createMutation.mutate({
      code: form.code.trim(),
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      modelType: form.modelType,
      format: form.format,
      inputShape: form.inputShape ? form.inputShape.split(",").map(Number) : undefined,
      outputShape: form.outputShape ? form.outputShape.split(",").map(Number) : undefined,
      labels: form.labels ? form.labels.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
      preprocessConfig: form.preprocessConfig,
      postprocessConfig: form.postprocessConfig,
      metadata: form.metadata ? JSON.parse(form.metadata) : undefined,
    });
  };

  const handleUpdate = (form: ModelFormData) => {
    if (!editingModel) return;
    updateMutation.mutate({
      id: editingModel.id,
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      modelType: form.modelType,
      inputShape: form.inputShape ? form.inputShape.split(",").map(Number) : undefined,
      outputShape: form.outputShape ? form.outputShape.split(",").map(Number) : undefined,
      labels: form.labels ? form.labels.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
      preprocessConfig: form.preprocessConfig,
      postprocessConfig: form.postprocessConfig,
      metadata: form.metadata ? JSON.parse(form.metadata) : undefined,
    });
  };

  // ─ Filtering
  const filteredModels = (models ?? []).filter((m: any) => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (
        !m.name?.toLowerCase().includes(q) &&
        !m.code?.toLowerCase().includes(q) &&
        !m.modelType?.toLowerCase().includes(q)
      )
        return false;
    }
    if (filterFormat !== "all" && m.format !== filterFormat) return false;
    if (filterStatus !== "all" && m.status !== filterStatus) return false;
    return true;
  });

  // Stats
  const stats = {
    total: models?.length ?? 0,
    active: models?.filter((m: any) => m.status === "ACTIVE").length ?? 0,
    ready: models?.filter((m: any) => m.status === "READY").length ?? 0,
    failed: models?.filter((m: any) => m.status === "FAILED").length ?? 0,
  };

  return (
    <DashboardLayout>
      <PageContainer fluid>
        {/* Header */}
        <PageHeader
          icon={<Box className="h-6 w-6" />}
          title={t("aiModels.title", "AI Model Management")}
          description={t("aiModels.subtitle", "Register, upload, and manage AI models and versions")}
          actions={
            <Button onClick={() => setShowCreateDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              {t("aiModels.createModel", "Create Model")}
            </Button>
          }
        />

        {/* doc 69 Wave 6 (F1) — "no active classifier" health banner (additive) */}
        <ClassifierHealthBanner withAction />

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard
            icon={<Box className="h-5 w-5" />}
            value={stats.total}
            label={t("aiModels.stats.total", "Total Models")}
            tone="info"
          />
          <MetricCard
            icon={<CheckCircle2 className="h-5 w-5" />}
            value={stats.active}
            label={t("aiModels.stats.active", "Active")}
            tone="success"
          />
          <MetricCard
            icon={<Clock className="h-5 w-5" />}
            value={stats.ready}
            label={t("aiModels.stats.ready", "Ready")}
            tone="warning"
          />
          <MetricCard
            icon={<AlertTriangle className="h-5 w-5" />}
            value={stats.failed}
            label={t("aiModels.stats.failed", "Failed")}
            tone="danger"
          />
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Models List */}
          <div className={selectedModelId ? "lg:col-span-2" : "lg:col-span-3"}>
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">
                    {t("aiModels.modelsList", "Models")} ({filteredModels.length})
                  </CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => refetch()}>
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
                {/* Filters */}
                <div className="flex flex-wrap gap-2 pt-2">
                  <div className="relative flex-1 min-w-50">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={t("aiModels.searchPlaceholder", "Search by name, code, or type...")}
                      className="pl-8"
                    />
                  </div>
                  <Select value={filterFormat} onValueChange={setFilterFormat}>
                    <SelectTrigger className="w-32.5">
                      <SelectValue placeholder={t("aiModels.fields.format", "Format")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("common.all", "All")}</SelectItem>
                      {MODEL_FORMATS.map((f) => (
                        <SelectItem key={f} value={f}>{f}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={filterStatus} onValueChange={setFilterStatus}>
                    <SelectTrigger className="w-32.5">
                      <SelectValue placeholder={t("aiModels.fields.status", "Status")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("common.all", "All")}</SelectItem>
                      {(Object.keys(STATUS_CONFIG) as ModelStatus[]).map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : filteredModels.length === 0 ? (
                  models?.length === 0 ? (
                    <EmptyState
                      variant="no-data"
                      icon={Brain}
                      title={t("aiModels.empty", "No models registered yet")}
                      description={t("aiModels.emptyDesc", "Register a model to upload files and manage versions")}
                      actionLabel={t("aiModels.createFirst", "Register your first model")}
                      onAction={() => setShowCreateDialog(true)}
                    />
                  ) : (
                    <EmptyState
                      variant="no-results"
                      icon={Brain}
                      title={t("aiModels.noResults", "No models match your filters")}
                      description={t("aiModels.noResultsDesc", "Try adjusting your search or filters")}
                    />
                  )
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("aiModels.fields.name", "Name")}</TableHead>
                        <TableHead>{t("aiModels.fields.format", "Format")}</TableHead>
                        <TableHead>{t("aiModels.fields.modelType", "Type")}</TableHead>
                        <TableHead>{t("aiModels.fields.status", "Status")}</TableHead>
                        <TableHead>{t("aiModels.fields.version", "Version")}</TableHead>
                        <TableHead>{t("aiModels.fields.fileSize", "Size")}</TableHead>
                        <TableHead className="text-right">{t("common.actions", "Actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredModels.map((model: any) => {
                        const statusCfg = STATUS_CONFIG[model.status as ModelStatus] ?? STATUS_CONFIG.INACTIVE;
                        const StatusIcon = statusCfg.icon;
                        const isSelected = selectedModelId === model.id;
                        return (
                          <TableRow
                            key={model.id}
                            className={`cursor-pointer hover:bg-muted/50 ${isSelected ? "bg-primary/5 border-l-2 border-l-primary" : ""}`}
                            onClick={() => setSelectedModelId(isSelected ? null : model.id)}
                          >
                            <TableCell>
                              <div>
                                <p className="font-medium text-sm">{model.name}</p>
                                <p className="text-xs text-muted-foreground font-mono">{model.code}</p>
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${FORMAT_COLORS[(model.format as ModelFormat) ?? "CUSTOM"]}`}>
                                {model.format ?? "—"}
                              </span>
                            </TableCell>
                            <TableCell className="text-sm">{model.modelType}</TableCell>
                            <TableCell>
                              <StatusBadge
                                status={model.status}
                                variant={statusCfg.color as "default" | "secondary" | "destructive" | "outline"}
                                className="text-xs"
                                label={
                                  <span className="inline-flex items-center">
                                    <StatusIcon className="h-3 w-3 mr-1" />
                                    {model.status}
                                  </span>
                                }
                              />
                            </TableCell>
                            <TableCell className="font-mono text-xs">{model.currentVersion ?? "—"}</TableCell>
                            <TableCell className="text-xs">{formatFileSize(model.fileSize)}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => setSelectedModelId(model.id)}
                                  title={t("common.view", "View")}
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => {
                                    setEditingModel({
                                      ...model,
                                      _form: {
                                        ...EMPTY_FORM,
                                        code: model.code,
                                        name: model.name,
                                        description: model.description ?? "",
                                        modelType: model.modelType,
                                        format: model.format ?? "ONNX",
                                        inputShape: model.inputShape ? (model.inputShape as number[]).join(",") : "",
                                        outputShape: model.outputShape ? (model.outputShape as number[]).join(",") : "",
                                        labels: model.labels ? (model.labels as string[]).join(", ") : "",
                                        preprocessConfig: model.preprocessConfig ?? EMPTY_FORM.preprocessConfig,
                                        postprocessConfig: model.postprocessConfig ?? EMPTY_FORM.postprocessConfig,
                                        metadata: model.metadata ? JSON.stringify(model.metadata) : "",
                                      },
                                    });
                                  }}
                                  title={t("common.edit", "Edit")}
                                >
                                  <Edit2 className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-destructive hover:text-destructive"
                                  onClick={() => setDeletingModel(model)}
                                  title={t("common.delete", "Delete")}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Detail Panel */}
          {selectedModelId && (
            <div className="lg:col-span-1">
              <Card>
                <CardContent className="p-4">
                  <ModelDetailPanel
                    modelId={selectedModelId}
                    onClose={() => setSelectedModelId(null)}
                    onRefresh={() => refetch()}
                    t={t as any}
                  />
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </PageContainer>

      {/* Dialogs */}
      <ModelFormDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        initialData={EMPTY_FORM}
        onSubmit={handleCreate}
        isLoading={createMutation.isPending}
        isEdit={false}
        t={t as any}
      />

      {editingModel && (
        <ModelFormDialog
          open={!!editingModel}
          onOpenChange={(v) => !v && setEditingModel(null)}
          initialData={editingModel._form}
          onSubmit={handleUpdate}
          isLoading={updateMutation.isPending}
          isEdit={true}
          t={t as any}
        />
      )}

      {deletingModel && (
        <DeleteConfirmDialog
          open={!!deletingModel}
          onOpenChange={(v) => !v && setDeletingModel(null)}
          modelName={deletingModel.name}
          onConfirm={() => deleteMutation.mutate({ id: deletingModel.id })}
          isLoading={deleteMutation.isPending}
          t={t as any}
        />
      )}
    </DashboardLayout>
  );
}
