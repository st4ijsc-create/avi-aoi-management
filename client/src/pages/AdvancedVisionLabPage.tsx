/**
 * Advanced Vision Lab — UI để thử 8 tính năng aiAdvancedVision với ảnh thật.
 *
 *   A. So sánh OK vs NG
 *   B. Image Quality Check
 *   C. Defect Heatmap
 *   D. OCR (LLaVA)
 *   E. Auto-detect ROI
 *   F. Augment Image
 *   G. Visual QA
 *   H. Batch Triage
 */

import React, { useCallback, useMemo, useRef, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Eye, ScanText, Crop, Wand2, MessageSquareQuote, Layers, Image as ImageIcon, Activity, FlameKindling, Search, ShieldAlert, Lightbulb } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import SimilarImageGrid, { type SearchMode, type EmbeddingSource } from "@/components/ai/SimilarImageGrid";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

type AugmentTransform =
  | "rotate90" | "rotate180" | "rotate270"
  | "flipH" | "flipV"
  | "brightnessUp" | "brightnessDown"
  | "contrastUp" | "noise";

const ALL_TRANSFORMS: AugmentTransform[] = [
  "rotate90", "rotate180", "rotate270",
  "flipH", "flipV",
  "brightnessUp", "brightnessDown",
  "contrastUp", "noise",
];

// ─── Helpers ──────────────────────────────────────────────────────────

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result as string;
      // strip data: prefix → server accepts both, but smaller payload
      const idx = r.indexOf(",");
      resolve(idx >= 0 ? r.slice(idx + 1) : r);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function previewUrl(b64: string | null, mime = "image/png"): string | undefined {
  return b64 ? `data:${mime};base64,${b64}` : undefined;
}

function ResultJson({ data }: { data: unknown }) {
  return (
    <pre className="text-xs bg-muted/50 p-3 rounded-md overflow-auto max-h-80">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

// ─── ImagePicker ──────────────────────────────────────────────────────

interface PickerProps {
  label: string;
  value: { base64: string; name: string; mime: string } | null;
  onChange: (v: { base64: string; name: string; mime: string } | null) => void;
}

function ImagePicker({ label, value, onChange }: PickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const handle = useCallback(async (file: File | null) => {
    if (!file) { onChange(null); return; }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error(`Ảnh "${file.name}" vượt quá 10 MB`);
      return;
    }
    try {
      const b64 = await fileToBase64(file);
      onChange({ base64: b64, name: file.name, mime: file.type || "image/png" });
    } catch (e) {
      toast.error(`Không đọc được ảnh: ${(e as Error).message}`);
    }
  }, [onChange]);

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex items-center gap-3">
        <Input
          ref={inputRef}
          type="file"
          accept="image/*"
          onChange={(e) => handle(e.target.files?.[0] ?? null)}
        />
        {value && (
          <Button type="button" variant="ghost" size="sm" onClick={() => { onChange(null); if (inputRef.current) inputRef.current.value = ""; }}>
            Xoá
          </Button>
        )}
      </div>
      {value && (
        <div className="border rounded-md overflow-hidden bg-muted/30">
          <img src={previewUrl(value.base64, value.mime)} alt={value.name} className="max-h-48 mx-auto" />
          <div className="text-xs text-muted-foreground p-1 text-center truncate">{value.name}</div>
        </div>
      )}
    </div>
  );
}

// ─── Tab A. compareOkVsNg ─────────────────────────────────────────────

function TabCompare() {
  const [ok, setOk] = useState<PickerProps["value"]>(null);
  const [ng, setNg] = useState<PickerProps["value"]>(null);
  const m = trpc.aiAdvancedVision.compareOkVsNg.useMutation();

  const run = () => {
    if (!ok || !ng) return toast.error("Chọn cả ảnh OK và NG");
    m.mutate({ okImage: ok.base64, ngImage: ng.base64, language: "vi" });
  };

  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-2 gap-4">
        <ImagePicker label="Ảnh OK (chuẩn)" value={ok} onChange={setOk} />
        <ImagePicker label="Ảnh NG (cần kiểm)" value={ng} onChange={setNg} />
      </div>
      <Button onClick={run} disabled={m.isPending || !ok || !ng}>
        {m.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        So sánh
      </Button>
      {m.error && <p className="text-sm text-destructive">{m.error.message}</p>}
      {m.data && (() => { const d = m.data as any; return (
        <div className="space-y-2">
          <div className="flex gap-2 items-center">
            <Badge variant={d.verdict === "PASS" ? "default" : d.verdict === "FAIL" ? "destructive" : "secondary"}>
              {d.verdict}
            </Badge>
            <span className="text-sm text-muted-foreground">diffRatio = {(d.diffRatio * 100).toFixed(2)}%</span>
          </div>
          <p className="text-sm">{d.summary}</p>
          <ResultJson data={d} />
        </div>
      ); })()}
    </div>
  );
}

// ─── Tab B. imageQualityCheck ─────────────────────────────────────────

function TabQuality() {
  const [img, setImg] = useState<PickerProps["value"]>(null);
  const m = trpc.aiAdvancedVision.imageQualityCheck.useMutation();
  const run = () => { if (!img) return toast.error("Chọn ảnh"); m.mutate({ image: img.base64 }); };
  return (
    <div className="space-y-4">
      <ImagePicker label="Ảnh cần đánh giá" value={img} onChange={setImg} />
      <Button onClick={run} disabled={m.isPending || !img}>
        {m.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        Phân tích chất lượng
      </Button>
      {m.error && <p className="text-sm text-destructive">{m.error.message}</p>}
      {m.data && <ResultJson data={m.data} />}
    </div>
  );
}

// ─── Tab C. generateDefectHeatmap ─────────────────────────────────────

function TabHeatmap() {
  const { t } = useTranslation();
  const [ok, setOk] = useState<PickerProps["value"]>(null);
  const [cand, setCand] = useState<PickerProps["value"]>(null);
  const m = trpc.aiAdvancedVision.generateDefectHeatmap.useMutation();
  const run = () => {
    if (!ok || !cand) return toast.error("Chọn ảnh OK và ảnh kiểm");
    m.mutate({ okReference: ok.base64, candidate: cand.base64 });
  };
  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-2 gap-4">
        <ImagePicker label="Ảnh OK tham chiếu" value={ok} onChange={setOk} />
        <ImagePicker label="Ảnh cần phát hiện lỗi" value={cand} onChange={setCand} />
      </div>
      <Button onClick={run} disabled={m.isPending || !ok || !cand}>
        {m.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        Tạo heatmap
      </Button>
      {m.error && <p className="text-sm text-destructive">{m.error.message}</p>}
      {m.data && (
        <div className="space-y-3">
          <div className="text-sm flex flex-wrap items-center gap-2">
            <Badge variant="outline">{m.data.width} × {m.data.height}</Badge>
            <span className="text-muted-foreground">
              diffRatio {(m.data.diffRatio * 100).toFixed(2)}% · {m.data.totalDiffPixels.toLocaleString()} pixels lỗi · {m.data.hotspots.length} hotspot
            </span>
            {/* B4.2 — cờ căn golden-sample (chỉ hiện khi ALIGN_BEFORE_DIFF bật & confidence đủ). */}
            {m.data.aligned
              ? <Badge variant="default">{t("align.aligned", "Đã căn")} · {t("align.angle", "Góc xoay")} {m.data.alignment?.angle ?? 0}° · dx {m.data.alignment?.dx ?? 0}, dy {m.data.alignment?.dy ?? 0} · {t("align.confidence", "Độ tin cậy căn")} {((m.data.alignment?.confidence ?? 0) * 100).toFixed(0)}%</Badge>
              : <Badge variant="outline">{t("align.notAligned", "Không căn (confidence thấp / cờ off)")}</Badge>}
          </div>
          <img src={previewUrl(m.data.heatmapPngBase64, "image/png")} alt="heatmap" className="max-h-120 border rounded" />
          <details className="text-xs"><summary className="cursor-pointer">Hotspots JSON</summary><ResultJson data={m.data.hotspots} /></details>
        </div>
      )}
    </div>
  );
}

// ─── Tab D. extractText ───────────────────────────────────────────────

function TabOcr() {
  const [img, setImg] = useState<PickerProps["value"]>(null);
  const [lang, setLang] = useState<"auto" | "en" | "vi">("auto");
  const m = trpc.aiAdvancedVision.extractText.useMutation();
  const run = () => { if (!img) return toast.error("Chọn ảnh"); m.mutate({ image: img.base64, language: lang }); };
  return (
    <div className="space-y-4">
      <ImagePicker label="Ảnh chứa văn bản" value={img} onChange={setImg} />
      <div className="w-48">
        <Label>Ngôn ngữ</Label>
        <Select value={lang} onValueChange={(v) => setLang(v as typeof lang)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto detect</SelectItem>
            <SelectItem value="en">English</SelectItem>
            <SelectItem value="vi">Tiếng Việt</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button onClick={run} disabled={m.isPending || !img}>
        {m.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        Trích xuất văn bản
      </Button>
      {m.error && <p className="text-sm text-destructive">{m.error.message}</p>}
      {m.data && <ResultJson data={m.data} />}
    </div>
  );
}

// ─── Tab E. autoDetectRoi ─────────────────────────────────────────────

function TabRoi() {
  const [img, setImg] = useState<PickerProps["value"]>(null);
  const m = trpc.aiAdvancedVision.autoDetectRoi.useMutation();
  const run = () => { if (!img) return toast.error("Chọn ảnh"); m.mutate({ image: img.base64 }); };
  const overlayStyle = useMemo(() => {
    if (!img || !m.data) return null;
    const d = m.data as any;
    return {
      left: `${(d.x / d.imageWidth) * 100}%`,
      top: `${(d.y / d.imageHeight) * 100}%`,
      width: `${(d.width / d.imageWidth) * 100}%`,
      height: `${(d.height / d.imageHeight) * 100}%`,
    } as React.CSSProperties;
  }, [img, m.data]);
  return (
    <div className="space-y-4">
      <ImagePicker label="Ảnh đầu vào" value={img} onChange={setImg} />
      <Button onClick={run} disabled={m.isPending || !img}>
        {m.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        Phát hiện ROI
      </Button>
      {m.error && <p className="text-sm text-destructive">{m.error.message}</p>}
      {m.data && img && (
        <div className="space-y-2">
          <div className="relative inline-block border rounded">
            <img src={previewUrl(img.base64, img.mime)} alt="roi" className="max-h-120 block" />
            {overlayStyle && <div className="absolute border-2 border-amber-400 bg-amber-400/20 pointer-events-none" style={overlayStyle} />}
          </div>
          <ResultJson data={m.data} />
        </div>
      )}
    </div>
  );
}

// ─── Tab F. augmentImage ──────────────────────────────────────────────

function TabAugment() {
  const [img, setImg] = useState<PickerProps["value"]>(null);
  const [selected, setSelected] = useState<AugmentTransform[]>(["rotate90", "brightnessUp", "noise"]);
  const m = trpc.aiAdvancedVision.augmentImage.useMutation();
  const toggle = (t: AugmentTransform) =>
    setSelected((s) => s.includes(t) ? s.filter(x => x !== t) : [...s, t]);
  const run = () => {
    if (!img) return toast.error("Chọn ảnh");
    if (selected.length === 0) return toast.error("Chọn ít nhất 1 transform");
    m.mutate({ image: img.base64, transforms: selected });
  };
  return (
    <div className="space-y-4">
      <ImagePicker label="Ảnh gốc" value={img} onChange={setImg} />
      <div>
        <Label>Transforms</Label>
        <div className="grid grid-cols-3 md:grid-cols-5 gap-2 mt-2">
          {ALL_TRANSFORMS.map((t) => (
            <label key={t} className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={selected.includes(t)} onCheckedChange={() => toggle(t)} />
              {t}
            </label>
          ))}
        </div>
      </div>
      <Button onClick={run} disabled={m.isPending || !img}>
        {m.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        Sinh ảnh tăng cường
      </Button>
      {m.error && <p className="text-sm text-destructive">{m.error.message}</p>}
      {m.data && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {m.data.map((a) => (
            <div key={a.transform} className="border rounded overflow-hidden">
              <img src={previewUrl(a.imageBase64, "image/jpeg")} alt={a.transform} className="w-full" />
              <div className="text-xs p-1 text-center bg-muted/40">{a.transform} · {a.width}×{a.height}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab G. visualQA ──────────────────────────────────────────────────

function TabVqa() {
  const [img, setImg] = useState<PickerProps["value"]>(null);
  const [q, setQ] = useState("Mô tả ngắn gọn các khuyết tật bạn nhìn thấy trên ảnh này.");
  const m = trpc.aiAdvancedVision.visualQA.useMutation();
  const run = () => {
    if (!img) return toast.error("Chọn ảnh");
    if (q.trim().length < 3) return toast.error("Câu hỏi tối thiểu 3 ký tự");
    m.mutate({ image: img.base64, question: q.trim(), language: "vi" });
  };
  return (
    <div className="space-y-4">
      <ImagePicker label="Ảnh để hỏi" value={img} onChange={setImg} />
      <div>
        <Label>Câu hỏi</Label>
        <Textarea value={q} onChange={(e) => setQ(e.target.value)} rows={3} />
      </div>
      <Button onClick={run} disabled={m.isPending || !img}>
        {m.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        Hỏi LLaVA
      </Button>
      {m.error && <p className="text-sm text-destructive">{m.error.message}</p>}
      {m.data && <ResultJson data={m.data} />}
    </div>
  );
}

// ─── Tab H. batchTriage ───────────────────────────────────────────────

function TabBatch() {
  const [imgs, setImgs] = useState<{ base64: string; name: string; mime: string }[]>([]);
  const m = trpc.aiAdvancedVision.batchTriage.useMutation();

  const add = useCallback(async (files: FileList | null) => {
    if (!files) return;
    const arr: { base64: string; name: string; mime: string }[] = [];
    for (let i = 0; i < files.length && imgs.length + arr.length < 20; i++) {
      const f = files[i];
      if (f.size > MAX_IMAGE_BYTES) { toast.error(`Bỏ qua ${f.name} (>10 MB)`); continue; }
      arr.push({ base64: await fileToBase64(f), name: f.name, mime: f.type || "image/png" });
    }
    setImgs((s) => [...s, ...arr]);
  }, [imgs.length]);

  const run = () => {
    if (imgs.length === 0) return toast.error("Chọn ít nhất 1 ảnh");
    m.mutate({ images: imgs.map((i) => i.base64), language: "vi" });
  };

  return (
    <div className="space-y-4">
      <div>
        <Label>Chọn nhiều ảnh (tối đa 20)</Label>
        <Input type="file" accept="image/*" multiple onChange={(e) => add(e.target.files)} />
      </div>
      {imgs.length > 0 && (
        <div className="grid grid-cols-4 md:grid-cols-6 gap-2">
          {imgs.map((im, i) => (
            <div key={i} className="relative border rounded overflow-hidden">
              <img src={previewUrl(im.base64, im.mime)} alt={im.name} className="w-full h-20 object-cover" />
              <button onClick={() => setImgs((s) => s.filter((_, j) => j !== i))} className="absolute top-0 right-0 bg-black/60 text-white text-xs px-1">×</button>
              <div className="text-[10px] truncate p-0.5">{im.name}</div>
            </div>
          ))}
        </div>
      )}
      <Button onClick={run} disabled={m.isPending || imgs.length === 0}>
        {m.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        Triage {imgs.length} ảnh
      </Button>
      {m.error && <p className="text-sm text-destructive">{m.error.message}</p>}
      {m.data && (() => { const d = m.data as any; return (
        <div className="space-y-2">
          <div className="text-sm text-muted-foreground">
            Tổng {d.total} · OK {d.summary.ok} · NG {d.summary.ng} · REVIEW {d.summary.review}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {d.results.map((r: any, i: number) => (
              <div key={i} className="flex items-center gap-3 border rounded p-2">
                {imgs[i] && <img src={previewUrl(imgs[i].base64, imgs[i].mime)} className="w-16 h-16 object-cover rounded" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge variant={r.verdict === "OK" ? "default" : r.verdict === "NG" ? "destructive" : "secondary"}>{r.verdict}</Badge>
                    <span className="text-xs text-muted-foreground">conf {(r.confidence * 100).toFixed(0)}%</span>
                  </div>
                  <p className="text-xs mt-1 truncate" title={r.reason}>{r.reason}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ); })()}
    </div>
  );
}

// ─── Tab I. Similar defect search (WS-3) ──────────────────────────────

function TabSimilar() {
  const [img, setImg] = useState<PickerProps["value"]>(null);
  const [topK, setTopK] = useState(8);
  const [defectType, setDefectType] = useState("");
  const [results, setResults] = useState<any[] | null>(null);
  const [searchMode, setSearchMode] = useState<SearchMode | null>(null);
  const [embeddingSource, setEmbeddingSource] = useState<EmbeddingSource | null>(null);
  const [busy, setBusy] = useState(false);

  const upload = trpc.aiImageSearch.uploadForSearch.useMutation();
  const search = trpc.aiImageSearch.searchByUpload.useMutation();
  const { data: stats } = trpc.aiImageSearch.stats.useQuery({});

  const run = async () => {
    if (!img) return toast.error("Chọn ảnh NG cần tra cứu");
    setBusy(true);
    setResults(null);
    try {
      const { imageKey } = await upload.mutateAsync({
        imageData: img.base64,
        fileName: img.name,
      });
      const res = await search.mutateAsync({
        imageKey,
        limit: topK,
        defectType: defectType.trim() || undefined,
      });
      setResults(res.results as any[]);
      setSearchMode((res.searchMode ?? null) as SearchMode | null);
      setEmbeddingSource(((res as any).embeddingSource ?? null) as EmbeddingSource | null);
    } catch (e: any) {
      toast.error(e?.message ?? "Tìm kiếm thất bại");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Mô tả ảnh bằng LLM rồi nhúng văn bản (Ollama mxbai-embed-large, 1024-d) để tìm các lỗi NG tương tự đã lưu.
        {stats && (
          <span className="ml-1">
            Đã index: <b>{(stats as any).indexedCount ?? 0}</b>
            {!(stats as any).pgvectorAvailable && <span className="text-amber-600"> (pgvector chưa sẵn sàng — fallback)</span>}
          </span>
        )}
      </p>
      <ImagePicker label="Ảnh NG cần tra cứu" value={img} onChange={setImg} />
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div>
          <Label>Top K</Label>
          <Input
            type="number"
            min={1}
            max={50}
            value={topK}
            onChange={(e) => setTopK(parseInt(e.target.value) || 8)}
          />
        </div>
        <div>
          <Label>Loại lỗi (tùy chọn)</Label>
          <Input value={defectType} onChange={(e) => setDefectType(e.target.value)} placeholder="vd: solder_bridge" />
        </div>
      </div>
      <Button onClick={run} disabled={busy || !img}>
        {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        Tìm lỗi tương tự
      </Button>
      <SimilarImageGrid results={results} loading={busy} searchMode={searchMode} embeddingSource={embeddingSource} />
    </div>
  );
}

// ─── Tab K. Explain (XAI, B5) ─────────────────────────────────────────

function TabExplain() {
  const { t } = useTranslation();
  const [img, setImg] = useState<PickerProps["value"]>(null);
  const [ref, setRef] = useState<PickerProps["value"]>(null);
  const [modelId, setModelId] = useState("");
  const [targetClass, setTargetClass] = useState("");
  const m = trpc.aiAdvancedVision.explainHeatmap.useMutation();

  const run = () => {
    if (!img) return toast.error(t("xai.pickImage", "Ảnh cần giải thích"));
    m.mutate({
      image: img.base64,
      referenceImage: ref?.base64,
      modelId: modelId ? Number(modelId) : undefined,
      targetClass: targetClass !== "" ? Number(targetClass) : undefined,
    });
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("xai.desc", "Sinh heatmap giải thích dự đoán của model.")}</p>
      <div className="grid md:grid-cols-2 gap-4">
        <ImagePicker label={t("xai.pickImage", "Ảnh cần giải thích")} value={img} onChange={setImg} />
        <ImagePicker label={t("align.aligned", "Ảnh tham chiếu (cho pixel-diff)")} value={ref} onChange={setRef} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div>
          <Label>{t("xai.modelId", "Model ID (tùy chọn)")}</Label>
          <Input type="number" value={modelId} onChange={(e) => setModelId(e.target.value)} />
        </div>
        <div>
          <Label>{t("xai.targetClass", "Lớp mục tiêu (tùy chọn)")}</Label>
          <Input type="number" value={targetClass} onChange={(e) => setTargetClass(e.target.value)} />
        </div>
      </div>
      <Button onClick={run} disabled={m.isPending || !img}>
        {m.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        {t("xai.run", "Sinh heatmap giải thích")}
      </Button>
      {m.error && <p className="text-sm text-destructive">{m.error.message}</p>}
      {m.data && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="secondary">{t("xai.method", "Phương pháp")}: {m.data.method}</Badge>
            {m.data.degraded && <Badge variant="destructive">{t("xai.degraded", "Degrade (pixel-diff)")}</Badge>}
            {m.data.approximate && <Badge variant="outline">{t("xai.approximate", "Xấp xỉ")}</Badge>}
            {m.data.topLabel && (
              <span className="text-muted-foreground">
                {t("xai.topLabel", "Nhãn dự đoán")}: <b>{m.data.topLabel}</b>
                {m.data.topConfidence != null && <> · {(m.data.topConfidence * 100).toFixed(1)}%</>}
              </span>
            )}
          </div>
          <img src={previewUrl(m.data.heatmapPngBase64, "image/png")} alt="xai-heatmap" className="max-h-120 border rounded" />
          <details className="text-xs"><summary className="cursor-pointer">notes</summary><ResultJson data={m.data.notes} /></details>
        </div>
      )}
    </div>
  );
}

// ─── Tab J. Anomaly (B3) ──────────────────────────────────────────────

function TabAnomaly() {
  const { t } = useTranslation();
  const [img, setImg] = useState<PickerProps["value"]>(null);
  const [productModelId, setProductModelId] = useState("");
  const [machineId, setMachineId] = useState("");
  const [modelId, setModelId] = useState("");
  const m = trpc.aiAnomaly.score.useMutation();

  const run = () => {
    if (!img) return toast.error(t("anomaly.pickImage"));
    m.mutate({
      image: img.base64,
      productModelId: productModelId ? Number(productModelId) : null,
      machineId: machineId ? Number(machineId) : null,
      modelId: modelId ? Number(modelId) : null,
    });
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("anomaly.desc")}</p>
      <div className="grid md:grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label>{t("anomaly.productModelId")}</Label>
          <Input type="number" value={productModelId} onChange={(e) => setProductModelId(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>{t("anomaly.machineId")}</Label>
          <Input type="number" value={machineId} onChange={(e) => setMachineId(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>{t("anomaly.modelId")}</Label>
          <Input type="number" value={modelId} onChange={(e) => setModelId(e.target.value)} />
        </div>
      </div>
      <ImagePicker label={t("anomaly.pickImage")} value={img} onChange={setImg} />
      <Button onClick={run} disabled={m.isPending || !img}>
        {m.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        {t("anomaly.run")}
      </Button>
      {m.error && <p className="text-sm text-destructive">{m.error.message}</p>}
      {m.data && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2 items-center">
            <Badge variant={m.data.isAnomaly ? "destructive" : "default"}>
              {m.data.isAnomaly ? t("anomaly.anomaly") : t("anomaly.normal")}
            </Badge>
            <Badge variant="secondary">{t("anomaly.source")}: {m.data.source}</Badge>
            {m.data.degraded && <Badge variant="outline">{t("anomaly.degraded")}</Badge>}
            <span className="text-sm text-muted-foreground">
              {t("anomaly.score")} = {m.data.score.toFixed(4)}
              {m.data.threshold != null && <> / {t("anomaly.threshold")} = {m.data.threshold.toFixed(4)}</>}
            </span>
            <span className="text-sm text-muted-foreground">{t("anomaly.bankSize")}: {m.data.bankSize}</span>
          </div>
          {m.data.reason && (
            <p className="text-sm text-muted-foreground">
              {t("anomaly.reason")}: {m.data.reason === "no_profile" ? t("anomaly.noProfile") : m.data.reason}
            </p>
          )}
          <ResultJson data={m.data} />
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────

export default function AdvancedVisionLabPage() {
  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Wand2 className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Advanced Vision Lab</h1>
            <p className="text-sm text-muted-foreground">
              Thử 8 tính năng xử lý ảnh nâng cao (LLaVA + sharp). Upload ảnh thật từ AOI để kiểm tra trực tiếp.
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Phòng thí nghiệm tính năng</CardTitle>
            <CardDescription>
              Mỗi tab tương ứng 1 endpoint <code>aiAdvancedVision.*</code>. Các tính năng dùng LLaVA (D, G, A, H) sẽ chậm hơn vì gọi GGUF model.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="compare" className="w-full">
              <TabsList className="flex flex-wrap h-auto">
                <TabsTrigger value="compare"><Eye className="h-4 w-4 mr-1" /> A. Compare</TabsTrigger>
                <TabsTrigger value="quality"><Activity className="h-4 w-4 mr-1" /> B. Quality</TabsTrigger>
                <TabsTrigger value="heatmap"><FlameKindling className="h-4 w-4 mr-1" /> C. Heatmap</TabsTrigger>
                <TabsTrigger value="ocr"><ScanText className="h-4 w-4 mr-1" /> D. OCR</TabsTrigger>
                <TabsTrigger value="roi"><Crop className="h-4 w-4 mr-1" /> E. ROI</TabsTrigger>
                <TabsTrigger value="augment"><ImageIcon className="h-4 w-4 mr-1" /> F. Augment</TabsTrigger>
                <TabsTrigger value="vqa"><MessageSquareQuote className="h-4 w-4 mr-1" /> G. Visual QA</TabsTrigger>
                <TabsTrigger value="batch"><Layers className="h-4 w-4 mr-1" /> H. Batch</TabsTrigger>
                <TabsTrigger value="similar"><Search className="h-4 w-4 mr-1" /> I. Tìm lỗi tương tự</TabsTrigger>
                <TabsTrigger value="anomaly"><ShieldAlert className="h-4 w-4 mr-1" /> J. Anomaly</TabsTrigger>
                <TabsTrigger value="explain"><Lightbulb className="h-4 w-4 mr-1" /> K. XAI</TabsTrigger>
              </TabsList>
              <div className="mt-4">
                <TabsContent value="compare"><TabCompare /></TabsContent>
                <TabsContent value="quality"><TabQuality /></TabsContent>
                <TabsContent value="heatmap"><TabHeatmap /></TabsContent>
                <TabsContent value="ocr"><TabOcr /></TabsContent>
                <TabsContent value="roi"><TabRoi /></TabsContent>
                <TabsContent value="augment"><TabAugment /></TabsContent>
                <TabsContent value="vqa"><TabVqa /></TabsContent>
                <TabsContent value="batch"><TabBatch /></TabsContent>
                <TabsContent value="similar"><TabSimilar /></TabsContent>
                <TabsContent value="anomaly"><TabAnomaly /></TabsContent>
                <TabsContent value="explain"><TabExplain /></TabsContent>
              </div>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
