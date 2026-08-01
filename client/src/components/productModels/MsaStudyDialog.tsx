/**
 * doc 48 R4 (tech-debt) — "MSA (Gage R&R) study wizard dialog" extracted VERBATIM from ProductModels.tsx.
 * PURE RELOCATION: the page still owns all state/queries/mutations/handlers and threads
 * them 1:1 as props (names unchanged); `t`/`user` are re-derived from hooks locally, as in
 * the sibling components/products/* dialogs. Identical JSX/handlers — no behavior change.
 */

import type { Dispatch, SetStateAction, ChangeEvent, RefObject } from "react";
import { type RouterOutputs, type MeasurementPoint, type ProductModel } from "./types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { Save, Upload } from "lucide-react";

interface MsaStudyDialogProps {
  addMsaObservationMutation: ReturnType<typeof trpc.msaWizard.addObservation.useMutation>;
  batchAddMsaObservationsMutation: ReturnType<typeof trpc.msaWizard.addObservationsBatch.useMutation>;
  completeMsaStudyMutation: ReturnType<typeof trpc.msaWizard.completeStudy.useMutation>;
  generateMsaMatrixMutation: ReturnType<typeof trpc.msaWizard.generateMatrix.useMutation>;
  handleAddMsaObservation: () => void;
  handleApplyMsaCsvMapping: () => void;
  handleApplyMsaPreset: (baseValue: number, noisePct: number) => void;
  handleBatchImportMsaObservations: () => void;
  handleCompleteMsaStudy: () => void;
  handleDeleteMsaCsvPreset: () => void;
  handleFillNextMsaCell: () => void;
  handleGenerateMsaMatrix: () => void;
  handleLoadMsaCsvPreset: (key: string) => void;
  handleMsaCsvFileSelected: (event: ChangeEvent<HTMLInputElement>) => void;
  handleSaveMsaCsvPreset: () => void;
  handleStartMsaStudy: () => void;
  isMsaDialogOpen: boolean;
  measurementInstruments: RouterOutputs["measurementInstrument"]["list"] | undefined;
  measurementPoints: MeasurementPoint[];
  msaAutoAddNext: boolean;
  msaBatchInput: string;
  msaBatchPreview: { total: number; validRows: Array<{ operatorName: string; partLabel: string; trialNo: number; measuredValue: string; notes?: string }>; invalidRows: Array<{ lineNo: number; reason: string }> };
  msaBatchSkipDuplicates: boolean;
  msaCellStats: { filledCells: number; totalCells: number; nextCell: { operatorName: string; partLabel: string; trialNo: number } | null };
  msaCsvColumnMap: { operator: number; part: number; trial: number; value: number; notes: number };
  msaCsvFileInputRef: RefObject<HTMLInputElement | null>;
  msaCsvHasHeader: boolean;
  msaCsvHeaders: string[];
  msaCsvPresetName: string;
  msaCsvPresetOptions: Array<{ key: string; id: any; name: any; source: any; instrumentId: any; hasHeader: any; columnMap: any; updatedAt: any }>;
  msaCsvRows: string[][];
  msaCsvSelectedPresetKey: string;
  msaCsvSourceKey: string;
  msaInstrumentId: number | undefined;
  msaLastSummary: any;
  msaMatrixBaseValue: string;
  msaMatrixNoisePct: string;
  msaMatrixOverwriteExisting: boolean;
  msaMeasuredValue: string;
  msaMeasurementPointId: number | undefined;
  msaOperatorCount: number;
  msaOperatorName: string;
  msaPartCount: number;
  msaPartLabel: string;
  msaStudyCode: string;
  msaStudyData: RouterOutputs["msaWizard"]["getStudy"] | undefined;
  msaStudyName: string;
  msaSuggestBaseValue: boolean;
  msaTrialCount: number;
  msaTrialNo: number;
  msaWizardStep: 1 | 2 | 3;
  selectedProduct: ProductModel | null;
  setIsMsaDialogOpen: Dispatch<SetStateAction<boolean>>;
  setMsaAutoAddNext: Dispatch<SetStateAction<boolean>>;
  setMsaBatchInput: Dispatch<SetStateAction<string>>;
  setMsaBatchSkipDuplicates: Dispatch<SetStateAction<boolean>>;
  setMsaCsvColumnMap: Dispatch<SetStateAction<{ operator: number; part: number; trial: number; value: number; notes: number }>>;
  setMsaCsvHasHeader: Dispatch<SetStateAction<boolean>>;
  setMsaCsvPresetName: Dispatch<SetStateAction<string>>;
  setMsaCsvSourceKey: Dispatch<SetStateAction<string>>;
  setMsaInstrumentId: Dispatch<SetStateAction<number | undefined>>;
  setMsaMatrixBaseValue: Dispatch<SetStateAction<string>>;
  setMsaMatrixNoisePct: Dispatch<SetStateAction<string>>;
  setMsaMatrixOverwriteExisting: Dispatch<SetStateAction<boolean>>;
  setMsaMeasuredValue: Dispatch<SetStateAction<string>>;
  setMsaMeasurementPointId: Dispatch<SetStateAction<number | undefined>>;
  setMsaOperatorCount: Dispatch<SetStateAction<number>>;
  setMsaOperatorName: Dispatch<SetStateAction<string>>;
  setMsaPartCount: Dispatch<SetStateAction<number>>;
  setMsaPartLabel: Dispatch<SetStateAction<string>>;
  setMsaStudyCode: Dispatch<SetStateAction<string>>;
  setMsaStudyName: Dispatch<SetStateAction<string>>;
  setMsaSuggestBaseValue: Dispatch<SetStateAction<boolean>>;
  setMsaTrialCount: Dispatch<SetStateAction<number>>;
  setMsaTrialNo: Dispatch<SetStateAction<number>>;
  setMsaWizardStep: Dispatch<SetStateAction<1 | 2 | 3>>;
  startMsaStudyMutation: ReturnType<typeof trpc.msaWizard.startStudy.useMutation>;
}

export function MsaStudyDialog(props: MsaStudyDialogProps) {
  const {
    addMsaObservationMutation, batchAddMsaObservationsMutation, completeMsaStudyMutation, generateMsaMatrixMutation,
    handleAddMsaObservation, handleApplyMsaCsvMapping, handleApplyMsaPreset, handleBatchImportMsaObservations,
    handleCompleteMsaStudy, handleDeleteMsaCsvPreset, handleFillNextMsaCell, handleGenerateMsaMatrix,
    handleLoadMsaCsvPreset, handleMsaCsvFileSelected, handleSaveMsaCsvPreset, handleStartMsaStudy,
    isMsaDialogOpen, measurementInstruments, measurementPoints, msaAutoAddNext,
    msaBatchInput, msaBatchPreview, msaBatchSkipDuplicates, msaCellStats,
    msaCsvColumnMap, msaCsvFileInputRef, msaCsvHasHeader, msaCsvHeaders,
    msaCsvPresetName, msaCsvPresetOptions, msaCsvRows, msaCsvSelectedPresetKey,
    msaCsvSourceKey, msaInstrumentId, msaLastSummary, msaMatrixBaseValue,
    msaMatrixNoisePct, msaMatrixOverwriteExisting, msaMeasuredValue, msaMeasurementPointId,
    msaOperatorCount, msaOperatorName, msaPartCount, msaPartLabel,
    msaStudyCode, msaStudyData, msaStudyName, msaSuggestBaseValue,
    msaTrialCount, msaTrialNo, msaWizardStep, selectedProduct,
    setIsMsaDialogOpen, setMsaAutoAddNext, setMsaBatchInput, setMsaBatchSkipDuplicates,
    setMsaCsvColumnMap, setMsaCsvHasHeader, setMsaCsvPresetName, setMsaCsvSourceKey,
    setMsaInstrumentId, setMsaMatrixBaseValue, setMsaMatrixNoisePct, setMsaMatrixOverwriteExisting,
    setMsaMeasuredValue, setMsaMeasurementPointId, setMsaOperatorCount, setMsaOperatorName,
    setMsaPartCount, setMsaPartLabel, setMsaStudyCode, setMsaStudyName,
    setMsaSuggestBaseValue, setMsaTrialCount, setMsaTrialNo, setMsaWizardStep,
    startMsaStudyMutation,
  } = props;
  return (
    <>
      <Dialog open={isMsaDialogOpen} onOpenChange={setIsMsaDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>P3.6 MSA Wizard (Gage R&R)</DialogTitle>
            <DialogDescription>
              Step {msaWizardStep}/3 — backend scaffold first, UI wizard for study setup, observations and summary.
            </DialogDescription>
          </DialogHeader>

          {msaWizardStep === 1 && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Study Code</Label>
                  <Input value={msaStudyCode} onChange={(e) => setMsaStudyCode(e.target.value)} placeholder="MSA-2026-001" />
                </div>
                <div className="space-y-2">
                  <Label>Study Name</Label>
                  <Input value={msaStudyName} onChange={(e) => setMsaStudyName(e.target.value)} placeholder="Critical Dimension Gage R&R" />
                </div>
                <div className="space-y-2">
                  <Label>Instrument</Label>
                  <Select
                    value={msaInstrumentId?.toString() || "__none"}
                    onValueChange={(value) => setMsaInstrumentId(value === "__none" ? undefined : parseInt(value, 10))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select instrument" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">None</SelectItem>
                      {(measurementInstruments || []).map((inst: any) => (
                        <SelectItem key={inst.id} value={String(inst.id)}>{inst.code} - {inst.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Measurement Point</Label>
                  <Select
                    value={msaMeasurementPointId?.toString() || "__none"}
                    onValueChange={(value) => setMsaMeasurementPointId(value === "__none" ? undefined : parseInt(value, 10))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select point" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">None</SelectItem>
                      {(measurementPoints || []).map((p: any) => (
                        <SelectItem key={p.id ?? p.code} value={String(p.id)}>{p.code} - {p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Operator Count</Label>
                  <Input type="number" min={1} value={msaOperatorCount} onChange={(e) => setMsaOperatorCount(Number(e.target.value) || 1)} />
                </div>
                <div className="space-y-2">
                  <Label>Part Count</Label>
                  <Input type="number" min={1} value={msaPartCount} onChange={(e) => setMsaPartCount(Number(e.target.value) || 1)} />
                </div>
                <div className="space-y-2">
                  <Label>Trial Count</Label>
                  <Input type="number" min={1} value={msaTrialCount} onChange={(e) => setMsaTrialCount(Number(e.target.value) || 1)} />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setIsMsaDialogOpen(false)}>Close</Button>
                <Button onClick={handleStartMsaStudy} disabled={startMsaStudyMutation.isPending || !selectedProduct}>
                  {startMsaStudyMutation.isPending ? "Starting..." : "Start Study"}
                </Button>
              </div>
            </div>
          )}

          {msaWizardStep === 2 && (
            <div className="space-y-4 py-2">
              <div className="border rounded-md p-3 bg-muted/10">
                <p className="text-sm font-medium mb-2">Auto-generate matrix</p>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">Presets:</span>
                  <Button type="button" variant="outline" size="sm" onClick={() => handleApplyMsaPreset(10, 1)}>Fine</Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => handleApplyMsaPreset(10, 2)}>Normal</Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => handleApplyMsaPreset(10, 4)}>Coarse</Button>
                </div>
                <div className="grid grid-cols-3 gap-2 items-end">
                  <div className="space-y-1">
                    <Label className="text-xs">Base Value</Label>
                    <Input value={msaMatrixBaseValue} onChange={(e) => setMsaMatrixBaseValue(e.target.value)} placeholder="10" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Noise %</Label>
                    <Input value={msaMatrixNoisePct} onChange={(e) => setMsaMatrixNoisePct(e.target.value)} placeholder="2" />
                  </div>
                  <Button variant="secondary" onClick={handleGenerateMsaMatrix} disabled={generateMsaMatrixMutation.isPending}>
                    {generateMsaMatrixMutation.isPending ? "Generating..." : "Generate Matrix"}
                  </Button>
                </div>
                <label className="mt-2 inline-flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={msaMatrixOverwriteExisting}
                    onChange={(e) => setMsaMatrixOverwriteExisting(e.target.checked)}
                  />
                  Overwrite existing matrix cells
                </label>
                <div className="mt-2 flex flex-wrap items-center gap-4">
                  <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={msaAutoAddNext}
                      onChange={(e) => setMsaAutoAddNext(e.target.checked)}
                    />
                    Add & Next mode
                  </label>
                  <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={msaSuggestBaseValue}
                      onChange={(e) => setMsaSuggestBaseValue(e.target.checked)}
                    />
                    Suggest base measured value
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-3">
                <div className="space-y-2">
                  <Label>Operator</Label>
                  <Input value={msaOperatorName} onChange={(e) => setMsaOperatorName(e.target.value)} placeholder="OP-01" />
                </div>
                <div className="space-y-2">
                  <Label>Part</Label>
                  <Input value={msaPartLabel} onChange={(e) => setMsaPartLabel(e.target.value)} placeholder="P-01" />
                </div>
                <div className="space-y-2">
                  <Label>Trial #</Label>
                  <Input type="number" min={1} value={msaTrialNo} onChange={(e) => setMsaTrialNo(Number(e.target.value) || 1)} />
                </div>
                <div className="space-y-2">
                  <Label>Measured Value</Label>
                  <Input value={msaMeasuredValue} onChange={(e) => setMsaMeasuredValue(e.target.value)} placeholder="12.345" />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2 text-xs">
                <span className="text-muted-foreground">
                  Matrix progress: <span className="font-medium text-foreground">{msaCellStats.filledCells}/{msaCellStats.totalCells}</span>
                </span>
                <Button type="button" variant="outline" size="sm" onClick={handleFillNextMsaCell}>
                  {msaCellStats.nextCell ? `Fill Next: ${msaCellStats.nextCell.operatorName} / ${msaCellStats.nextCell.partLabel} / T${msaCellStats.nextCell.trialNo}` : "Matrix Complete"}
                </Button>
              </div>

              <p className="text-[11px] text-muted-foreground">
                Shortcuts: Enter = Add, Ctrl+Enter = Add &amp; Next, F2 = Fill Next Cell.
              </p>

              <div className="flex justify-between gap-2">
                <Button variant="outline" onClick={() => setMsaWizardStep(1)}>Back</Button>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={handleAddMsaObservation} disabled={addMsaObservationMutation.isPending}>
                    {addMsaObservationMutation.isPending ? "Adding..." : (msaAutoAddNext ? "Add & Next" : "Add Observation")}
                  </Button>
                  <Button onClick={handleCompleteMsaStudy} disabled={completeMsaStudyMutation.isPending}>
                    {completeMsaStudyMutation.isPending ? "Calculating..." : "Complete Study"}
                  </Button>
                </div>
              </div>

              <div className="border rounded-md p-3 max-h-72 overflow-y-auto">
                <p className="text-sm font-medium mb-2">Observations ({msaStudyData?.observations?.length || 0})</p>
                <div className="space-y-1">
                  {(msaStudyData?.observations || []).slice(-50).map((r: any) => (
                    <div key={r.id} className="text-xs border rounded px-2 py-1 flex items-center justify-between">
                      <span>{r.operatorName} | {r.partLabel} | T{r.trialNo}</span>
                      <span className="font-medium">{r.measuredValue}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border rounded-md p-3 bg-muted/10 space-y-2">
                <p className="text-sm font-medium">Step 9: Paste Grid Import</p>
                <p className="text-xs text-muted-foreground">
                  Paste lines with format: operator, part, trial, value[, notes]. Delimiters: comma, tab or semicolon.
                </p>
                <div className="rounded border bg-background p-2 space-y-2">
                  <p className="text-xs font-medium">Step 10: CSV Upload + Column Mapping</p>
                  <input
                    ref={msaCsvFileInputRef}
                    type="file"
                    accept=".csv,.txt"
                    className="hidden"
                    onChange={handleMsaCsvFileSelected}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => msaCsvFileInputRef.current?.click()}>
                      <Upload className="h-3.5 w-3.5 mr-1" />Upload CSV
                    </Button>
                    <Input
                      value={msaCsvSourceKey}
                      onChange={(e) => setMsaCsvSourceKey(e.target.value)}
                      placeholder="Source machine (e.g. AOI-LINE1-CAMTOP)"
                      className="h-8 w-65"
                    />
                    <Input
                      value={msaCsvPresetName}
                      onChange={(e) => setMsaCsvPresetName(e.target.value)}
                      placeholder="Preset name"
                      className="h-8 w-45"
                    />
                    <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={msaCsvHasHeader}
                        onChange={(e) => setMsaCsvHasHeader(e.target.checked)}
                      />
                      File has header row
                    </label>
                    <Button type="button" variant="secondary" size="sm" onClick={handleApplyMsaCsvMapping} disabled={msaCsvRows.length === 0}>
                      Apply Mapping
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={handleSaveMsaCsvPreset}>
                      Save Preset
                    </Button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Select value={msaCsvSelectedPresetKey} onValueChange={handleLoadMsaCsvPreset}>
                      <SelectTrigger className="h-8 w-[320px]"><SelectValue placeholder="Load preset" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">None</SelectItem>
                        {msaCsvPresetOptions.map((preset) => (
                          <SelectItem key={preset.key} value={preset.key}>
                            {preset.source} / {preset.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="outline" size="sm" onClick={handleDeleteMsaCsvPreset}>
                      Delete Preset
                    </Button>
                    <span className="text-[11px] text-muted-foreground">
                      Presets are shared via server database by product + source + preset name.
                    </span>
                  </div>

                  {msaCsvRows.length > 0 && (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Operator Column</Label>
                        <Select value={String(msaCsvColumnMap.operator)} onValueChange={(v) => setMsaCsvColumnMap((prev) => ({ ...prev, operator: Number(v) }))}>
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {(msaCsvHeaders.length > 0 ? msaCsvHeaders : (msaCsvRows[0] || []).map((_, i) => `Column ${i + 1}`)).map((name, idx) => (
                              <SelectItem key={`operator-${idx}`} value={String(idx)}>{name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Part Column</Label>
                        <Select value={String(msaCsvColumnMap.part)} onValueChange={(v) => setMsaCsvColumnMap((prev) => ({ ...prev, part: Number(v) }))}>
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {(msaCsvHeaders.length > 0 ? msaCsvHeaders : (msaCsvRows[0] || []).map((_, i) => `Column ${i + 1}`)).map((name, idx) => (
                              <SelectItem key={`part-${idx}`} value={String(idx)}>{name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Trial Column</Label>
                        <Select value={String(msaCsvColumnMap.trial)} onValueChange={(v) => setMsaCsvColumnMap((prev) => ({ ...prev, trial: Number(v) }))}>
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {(msaCsvHeaders.length > 0 ? msaCsvHeaders : (msaCsvRows[0] || []).map((_, i) => `Column ${i + 1}`)).map((name, idx) => (
                              <SelectItem key={`trial-${idx}`} value={String(idx)}>{name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Value Column</Label>
                        <Select value={String(msaCsvColumnMap.value)} onValueChange={(v) => setMsaCsvColumnMap((prev) => ({ ...prev, value: Number(v) }))}>
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {(msaCsvHeaders.length > 0 ? msaCsvHeaders : (msaCsvRows[0] || []).map((_, i) => `Column ${i + 1}`)).map((name, idx) => (
                              <SelectItem key={`value-${idx}`} value={String(idx)}>{name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1 col-span-2">
                        <Label className="text-xs">Notes Column (Optional)</Label>
                        <Select value={String(msaCsvColumnMap.notes)} onValueChange={(v) => setMsaCsvColumnMap((prev) => ({ ...prev, notes: Number(v) }))}>
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="-1">None</SelectItem>
                            {(msaCsvHeaders.length > 0 ? msaCsvHeaders : (msaCsvRows[0] || []).map((_, i) => `Column ${i + 1}`)).map((name, idx) => (
                              <SelectItem key={`notes-${idx}`} value={String(idx)}>{name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}
                </div>

                <Textarea
                  value={msaBatchInput}
                  onChange={(e) => setMsaBatchInput(e.target.value)}
                  placeholder={"OP-01,P-01,1,10.123\nOP-01,P-01,2,10.111\nOP-02,P-01,1,10.146,shift-B"}
                  className="min-h-30"
                />
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">
                    Parsed: {msaBatchPreview.total} lines | Valid: {msaBatchPreview.validRows.length} | Invalid: {msaBatchPreview.invalidRows.length}
                  </span>
                  <label className="inline-flex items-center gap-2 text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={msaBatchSkipDuplicates}
                      onChange={(e) => setMsaBatchSkipDuplicates(e.target.checked)}
                    />
                    Skip duplicates
                  </label>
                </div>
                {msaBatchPreview.invalidRows.length > 0 && (
                  <div className="max-h-24 overflow-y-auto rounded border bg-background p-2 text-xs space-y-1">
                    {msaBatchPreview.invalidRows.slice(0, 20).map((item) => (
                      <p key={`${item.lineNo}-${item.reason}`} className="text-destructive">
                        Line {item.lineNo}: {item.reason}
                      </p>
                    ))}
                  </div>
                )}
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleBatchImportMsaObservations}
                    disabled={batchAddMsaObservationsMutation.isPending || msaBatchPreview.validRows.length === 0}
                  >
                    {batchAddMsaObservationsMutation.isPending ? "Importing..." : "Import Valid Rows"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {msaWizardStep === 3 && (
            <div className="space-y-4 py-2">
              <div className="border rounded-md p-4 bg-muted/20">
                <p className="text-sm font-medium mb-2">MSA Summary</p>
                {(() => {
                  const summary = msaLastSummary || msaStudyData?.study?.summary;
                  if (!summary) return <p className="text-sm text-muted-foreground">No summary available yet.</p>;
                  const ev = Number(summary.repeatabilityEV ?? 0);
                  const av = Number(summary.reproducibilityAV ?? 0);
                  const grr = Number(summary.grr ?? 0);
                  const maxBar = Math.max(ev, av, grr, 1e-9);
                  const evPct = (ev / maxBar) * 100;
                  const avPct = (av / maxBar) * 100;
                  const grrPctBar = (grr / maxBar) * 100;
                  return (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <p>Sample Size: <span className="font-medium">{summary.sampleSize ?? 0}</span></p>
                        <p>Average: <span className="font-medium">{Number(summary.avg ?? 0).toFixed(4)}</span></p>
                        <p>Std Dev: <span className="font-medium">{Number(summary.stdDev ?? 0).toFixed(4)}</span></p>
                        <p>GRR%: <span className="font-medium">{Number(summary.grrPct ?? 0).toFixed(2)}%</span></p>
                        <p>NDC: <span className="font-medium">{summary.ndc ?? "-"}</span></p>
                        <p>Verdict: <Badge variant={summary.verdict === "good" ? "default" : summary.verdict === "acceptable" ? "secondary" : "destructive"}>{summary.verdict || "unknown"}</Badge></p>
                      </div>

                      <div className="space-y-2">
                        <p className="text-xs font-medium">EV / AV / GRR visualization</p>
                        <div className="space-y-2">
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-xs"><span>EV</span><span>{ev.toFixed(4)}</span></div>
                            <div className="h-2 rounded bg-muted overflow-hidden"><div className="h-full bg-info" style={{ width: `${Math.max(2, evPct)}%` }} /></div>
                          </div>
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-xs"><span>AV</span><span>{av.toFixed(4)}</span></div>
                            <div className="h-2 rounded bg-muted overflow-hidden"><div className="h-full bg-primary" style={{ width: `${Math.max(2, avPct)}%` }} /></div>
                          </div>
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-xs"><span>GRR</span><span>{grr.toFixed(4)}</span></div>
                            <div className="h-2 rounded bg-muted overflow-hidden"><div className="h-full bg-warning" style={{ width: `${Math.max(2, grrPctBar)}%` }} /></div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setMsaWizardStep(2)}>Back</Button>
                <Button onClick={() => setIsMsaDialogOpen(false)}>Done</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
