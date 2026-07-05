/**
 * Doc 31 — Đợt C (MP5 / PM4 · decision #5) — Centroid / pick-place import wizard.
 *
 * Generic CSV importer with a CONFIGURABLE column map (defers vendor-specific
 * formats to UI mapping — no code change to onboard Fuji / Panasonic / Siemens /
 * KiCad / Altium files). Flow: upload → auto-detect + map columns → live preview
 * (with unit / Y-flip / fit-to-image controls) → apply → measurement points.
 */
import { useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Upload, CircuitBoard, AlertTriangle, Loader2, CheckCircle, FlipVertical, Wand2 } from "lucide-react";

interface CentroidImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productModelId: number;
  productModelName: string;
  onSuccess?: () => void;
}

// The logical target fields, in display order. * = required.
const FIELDS: Array<{ key: string; required?: boolean; i18n: string; fallback: string }> = [
  { key: "refDesignator", required: true, i18n: "products.centroidImport.fieldRefDes", fallback: "Ref designator *" },
  { key: "x", required: true, i18n: "products.centroidImport.fieldX", fallback: "X *" },
  { key: "y", required: true, i18n: "products.centroidImport.fieldY", fallback: "Y *" },
  { key: "rotation", i18n: "products.centroidImport.fieldRotation", fallback: "Rotation" },
  { key: "side", i18n: "products.centroidImport.fieldSide", fallback: "Side" },
  { key: "package", i18n: "products.centroidImport.fieldPackage", fallback: "Package" },
  { key: "componentCode", i18n: "products.centroidImport.fieldValue", fallback: "Value / component" },
  { key: "placedStatus", i18n: "products.centroidImport.fieldPlaced", fallback: "Placed status" },
  { key: "name", i18n: "products.centroidImport.fieldName", fallback: "Name" },
];

const UNMAPPED = "__none__";
const MEASUREMENT_TYPES = ["VISUAL", "DIMENSION", "ELECTRICAL", "POSITION", "COLOR", "SURFACE", "OTHER"];

export function CentroidImportDialog({
  open, onOpenChange, productModelId, productModelName, onSuccess,
}: CentroidImportDialogProps) {
  const { t } = useTranslation();
  const tf = (key: string, fallback: string, opts?: any): string =>
    t(key, { defaultValue: fallback, ...opts }) as string;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState("");
  const [text, setText] = useState("");
  const [headers, setHeaders] = useState<string[] | null>(null);
  const [columnMap, setColumnMap] = useState<Record<string, number>>({});
  const [delimiter, setDelimiter] = useState<"," | ";" | "\t" | "auto">("auto");
  const [decimal, setDecimal] = useState<"." | ",">(".");
  const [unit, setUnit] = useState<"mm" | "cm" | "mil" | "inch" | "um">("mm");
  const [flipY, setFlipY] = useState(false);
  const [flipX, setFlipX] = useState(false);
  const [fitToImage, setFitToImage] = useState(true);
  const [measurementType, setMeasurementType] = useState("VISUAL");
  const [radius, setRadius] = useState(20);
  const [preview, setPreview] = useState<any>(null);
  const [result, setResult] = useState<any>(null);

  const inspectM = trpc.cadImport.centroidInspect.useMutation();
  const previewM = trpc.cadImport.centroidPreview.useMutation();
  const commitM = trpc.cadImport.centroidCommit.useMutation();
  const applyM = trpc.cadImport.centroidApply.useMutation();

  const buildColumnMapPayload = useCallback(() => {
    const payload: Record<string, number> = {};
    for (const f of FIELDS) {
      const v = columnMap[f.key];
      if (v != null && v >= 0) payload[f.key] = v;
    }
    return payload;
  }, [columnMap]);

  const parseOptions = useCallback(() => ({
    delimiter, decimal, hasHeader: true,
  }), [delimiter, decimal]);

  const transformOptions = useCallback(() => ({
    unit, flipX, flipY, fitToImage,
  }), [unit, flipX, flipY, fitToImage]);

  const runPreview = useCallback(async () => {
    if (!text) return;
    const map = buildColumnMapPayload();
    try {
      const res = await previewM.mutateAsync({
        productModelId,
        content: text,
        columnMap: (map.refDesignator != null && map.x != null && map.y != null) ? (map as any) : undefined,
        parseOptions: parseOptions() as any,
        transformOptions: transformOptions() as any,
      });
      setPreview(res);
    } catch (e: any) {
      toast.error(e.message);
    }
  }, [text, productModelId, buildColumnMapPayload, parseOptions, transformOptions, previewM]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setResult(null);
    setPreview(null);
    setFileName(f.name);
    const content = await f.text();
    setText(content);
    try {
      const ins = await inspectM.mutateAsync({ content, delimiter, hasHeader: true });
      setHeaders(ins.headers);
      setDelimiter(ins.detectedDelimiter);
      // Seed the map from the server's guess.
      const guessed: Record<string, number> = {};
      for (const [k, v] of Object.entries(ins.guessedMap || {})) {
        if (typeof v === "number") guessed[k] = v;
      }
      setColumnMap(guessed);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const requiredMapped = columnMap.refDesignator != null && columnMap.x != null && columnMap.y != null;

  const handleImport = async () => {
    const map = buildColumnMapPayload();
    if (map.refDesignator == null || map.x == null || map.y == null) {
      toast.error(tf("products.centroidImport.mapRequired", "Map ref designator, X and Y first."));
      return;
    }
    try {
      const committed = await commitM.mutateAsync({
        productModelId,
        fileName: fileName || "centroid.csv",
        content: text,
        columnMap: map as any,
        parseOptions: parseOptions() as any,
        transformOptions: transformOptions() as any,
      });
      const applied = await applyM.mutateAsync({
        jobId: committed.jobId,
        measurementType: measurementType as any,
        radius,
      });
      setResult(applied);
      if (applied.applied > 0) {
        toast.success(tf("products.centroidImport.applied", "Imported {{n}} points ({{s}} skipped)", { n: applied.applied, s: applied.skipped }));
        onSuccess?.();
      } else {
        toast.info(tf("products.centroidImport.nothingApplied", "No new points (all {{s}} already existed)", { s: applied.skipped }));
      }
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const reset = () => {
    setFileName(""); setText(""); setHeaders(null); setColumnMap({});
    setPreview(null); setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const columnOptions = headers ?? [];
  const busy = commitM.isPending || applyM.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CircuitBoard className="h-5 w-5" />
            {tf("products.centroidImport.title", "Import centroid (CAD / pick-place)")}
          </DialogTitle>
          <DialogDescription>
            {tf("products.centroidImport.description", "Map your pick-place CSV columns to measurement points for {{name}}.", { name: productModelName })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto space-y-4 pr-1">
          {/* Upload */}
          <div className="border-2 border-dashed rounded-lg p-5 text-center">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt,.pos,.tsv"
              onChange={handleFile}
              className="hidden"
              id="centroid-upload"
            />
            <label htmlFor="centroid-upload" className="cursor-pointer">
              <Upload className="h-9 w-9 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm font-medium">{fileName || tf("products.centroidImport.selectFile", "Select a centroid / pick-place CSV")}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {tf("products.centroidImport.formats", "CSV / TXT / .pos — comma, semicolon or tab delimited")}
              </p>
            </label>
          </div>

          {headers && (
            <>
              {/* Column mapping */}
              <div className="space-y-2">
                <h4 className="text-sm font-medium flex items-center gap-2">
                  <Wand2 className="h-4 w-4" />
                  {tf("products.centroidImport.mapColumns", "Map columns")}
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {FIELDS.map((f) => (
                    <div key={f.key} className="space-y-1">
                      <Label className="text-xs">{tf(f.i18n, f.fallback)}</Label>
                      <Select
                        value={columnMap[f.key] != null ? String(columnMap[f.key]) : UNMAPPED}
                        onValueChange={(v) => {
                          setColumnMap((prev) => {
                            const next = { ...prev };
                            if (v === UNMAPPED) delete next[f.key];
                            else next[f.key] = Number(v);
                            return next;
                          });
                        }}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {!f.required && <SelectItem value={UNMAPPED}>—</SelectItem>}
                          {columnOptions.map((h, i) => (
                            <SelectItem key={i} value={String(i)}>{h || `col ${i}`}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>

              {/* Parse + transform options */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
                <div className="space-y-1">
                  <Label className="text-xs">{tf("products.centroidImport.unit", "Unit")}</Label>
                  <Select value={unit} onValueChange={(v) => setUnit(v as any)}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["mm", "cm", "mil", "inch", "um"].map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{tf("products.centroidImport.delimiter", "Delimiter")}</Label>
                  <Select value={delimiter} onValueChange={(v) => setDelimiter(v as any)}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">auto</SelectItem>
                      <SelectItem value=",">, (comma)</SelectItem>
                      <SelectItem value=";">; (semicolon)</SelectItem>
                      <SelectItem value={"\t"}>tab</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{tf("products.centroidImport.decimal", "Decimal")}</Label>
                  <Select value={decimal} onValueChange={(v) => setDecimal(v as any)}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value=".">. (point)</SelectItem>
                      <SelectItem value=",">, (comma)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2 pb-1">
                  <Switch id="flipY" checked={flipY} onCheckedChange={setFlipY} />
                  <Label htmlFor="flipY" className="text-xs flex items-center gap-1">
                    <FlipVertical className="h-3 w-3" />{tf("products.centroidImport.flipY", "Flip Y")}
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch id="flipX" checked={flipX} onCheckedChange={setFlipX} />
                  <Label htmlFor="flipX" className="text-xs">{tf("products.centroidImport.flipX", "Flip X")}</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch id="fit" checked={fitToImage} onCheckedChange={setFitToImage} />
                  <Label htmlFor="fit" className="text-xs">{tf("products.centroidImport.fitToImage", "Fit to image")}</Label>
                </div>
                <div className="md:col-span-2">
                  <Button variant="outline" size="sm" onClick={runPreview} disabled={!requiredMapped || previewM.isPending} className="w-full gap-1">
                    {previewM.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {tf("products.centroidImport.preview", "Preview")}
                  </Button>
                </div>
              </div>

              {/* Apply defaults */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">{tf("products.centroidImport.measurementType", "Measurement type")}</Label>
                  <Select value={measurementType} onValueChange={setMeasurementType}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MEASUREMENT_TYPES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{tf("products.centroidImport.radius", "Point radius (px)")}</Label>
                  <Input type="number" min={1} value={radius} onChange={(e) => setRadius(Number(e.target.value) || 20)} className="h-8 text-xs" />
                </div>
              </div>
            </>
          )}

          {/* Preview result */}
          {preview && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <Badge variant="secondary">{tf("products.centroidImport.parsedN", "{{n}} parsed", { n: preview.stats?.parsed ?? 0 })}</Badge>
                {preview.stats?.skipped > 0 && <Badge variant="outline">{tf("products.centroidImport.skippedN", "{{n}} skipped", { n: preview.stats.skipped })}</Badge>}
                {preview.stats?.duplicates > 0 && <Badge variant="outline">{tf("products.centroidImport.dupN", "{{n}} duplicate", { n: preview.stats.duplicates })}</Badge>}
                <Badge variant="outline">{preview.coordinateMode}</Badge>
                {!preview.hasImageDimensions && <Badge variant="destructive">{tf("products.centroidImport.noDims", "no image size")}</Badge>}
              </div>

              {preview.warnings?.length > 0 && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>{tf("products.centroidImport.warnings", "Warnings")}</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc list-inside text-xs mt-1">
                      {preview.warnings.slice(0, 6).map((w: string, i: number) => <li key={i}>{w}</li>)}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              <ScrollArea className="h-56 border rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="p-1.5 text-left">RefDes</th>
                      <th className="p-1.5 text-center">X</th>
                      <th className="p-1.5 text-center">Y</th>
                      <th className="p-1.5 text-center">Rot</th>
                      <th className="p-1.5 text-left">Side</th>
                      <th className="p-1.5 text-left">Package</th>
                      <th className="p-1.5 text-left">Component</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(preview.candidates ?? []).slice(0, 300).map((c: any, i: number) => (
                      <tr key={i} className="border-t">
                        <td className="p-1.5 font-mono">{c.refDesignator}</td>
                        <td className="p-1.5 text-center">{Math.round(c.positionX)}</td>
                        <td className="p-1.5 text-center">{Math.round(c.positionY)}</td>
                        <td className="p-1.5 text-center">{c.rotation ?? "—"}</td>
                        <td className="p-1.5">{c.side ?? "—"}</td>
                        <td className="p-1.5">{c.package ?? "—"}</td>
                        <td className="p-1.5 font-mono text-muted-foreground">{c.componentCode ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            </div>
          )}

          {result && (
            <Alert variant="default">
              <CheckCircle className="h-4 w-4" />
              <AlertTitle>{tf("products.centroidImport.importResult", "Import result")}</AlertTitle>
              <AlertDescription className="text-xs">
                {tf("products.centroidImport.resultLine", "{{a}} points created, {{s}} skipped (already existed).", { a: result.applied, s: result.skipped })}
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => { reset(); onOpenChange(false); }}>
            {t("common.close")}
          </Button>
          <Button onClick={handleImport} disabled={!requiredMapped || busy || !text}>
            {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
            {tf("products.centroidImport.importBtn", "Import points")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CentroidImportDialog;
