// Doc 31 OP5 (decision #3) — AQL lot acceptance panel for a product model.
// (a) AQL config: create/edit sampling plans with AQL levels + sample size +
//     accept/reject numbers (the numbers an engineer copies from ANSI/ASQ Z1.4).
// (b) Lot board: recent lots (by batchNumber) with their accept/reject/pending
//     disposition, computed by server/services/lotAcceptanceService.ts.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, XCircle, Clock, ClipboardCheck } from "lucide-react";

interface Props {
  productModelId: number;
  canEdit?: boolean;
}

const WINDOW_OPTS = [
  { key: "7", days: 7 },
  { key: "30", days: 30 },
  { key: "90", days: 90 },
];

export function ProductLotAcceptancePanel({ productModelId, canEdit }: Props) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const [windowKey, setWindowKey] = useState("30");
  const [selectedPlanId, setSelectedPlanId] = useState<number | undefined>(undefined);

  const { data: plans } = trpc.samplingPlan.listByProduct.useQuery({ productModelId });

  const startDate = useMemo(() => {
    const days = WINDOW_OPTS.find((w) => w.key === windowKey)?.days ?? 30;
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  }, [windowKey]);

  const { data: lots, isFetching } = trpc.samplingPlan.listLots.useQuery({
    productModelId,
    samplingPlanId: selectedPlanId,
    startDate,
    limit: 50,
  });

  // ── AQL config form state (create a new plan) ──────────────────────────────
  const [showForm, setShowForm] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [lotSize, setLotSize] = useState("");
  const [sampleSize, setSampleSize] = useState("");
  const [acceptanceQty, setAcceptanceQty] = useState("0");
  const [rejectionQty, setRejectionQty] = useState("1");
  const [aqlMajor, setAqlMajor] = useState("");
  const [aqlMinor, setAqlMinor] = useState("");
  const [aqlCritical, setAqlCritical] = useState("");

  const createMut = trpc.samplingPlan.create.useMutation({
    onSuccess: () => {
      utils.samplingPlan.listByProduct.invalidate({ productModelId });
      toast.success(t("lotAcceptance.planSaved"));
      setShowForm(false);
      setCode(""); setName(""); setLotSize(""); setSampleSize("");
      setAcceptanceQty("0"); setRejectionQty("1"); setAqlMajor(""); setAqlMinor(""); setAqlCritical("");
    },
    onError: (e) => toast.error(e.message),
  });

  const save = () => {
    if (!code.trim() || !name.trim()) {
      toast.error(t("lotAcceptance.codeNameRequired"));
      return;
    }
    createMut.mutate({
      productModelId,
      code: code.trim(),
      name: name.trim(),
      strategy: "aql",
      lotSize: lotSize ? parseInt(lotSize, 10) : undefined,
      sampleSize: sampleSize ? parseInt(sampleSize, 10) : undefined,
      acceptanceQty: acceptanceQty ? parseInt(acceptanceQty, 10) : undefined,
      rejectionQty: rejectionQty ? parseInt(rejectionQty, 10) : undefined,
      aqlMajor: aqlMajor || undefined,
      aqlMinor: aqlMinor || undefined,
      aqlCritical: aqlCritical || undefined,
      isActive: true,
    });
  };

  const dispositionBadge = (d: string) => {
    if (d === "accept") return <Badge className="bg-green-600"><CheckCircle2 className="h-3 w-3 mr-1" />{t("lotAcceptance.accept")}</Badge>;
    if (d === "reject") return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />{t("lotAcceptance.reject")}</Badge>;
    if (d === "pending") return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />{t("lotAcceptance.pending")}</Badge>;
    return <Badge variant="outline">{t("lotAcceptance.noPlan")}</Badge>;
  };

  return (
    <div className="space-y-3 rounded border p-3">
      <div className="flex items-center justify-between">
        <h4 className="flex items-center gap-1 text-sm font-medium">
          <ClipboardCheck className="h-4 w-4" />
          {t("lotAcceptance.title")}
        </h4>
        <div className="flex items-center gap-2">
          <Select value={windowKey} onValueChange={setWindowKey}>
            <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              {WINDOW_OPTS.map((w) => (
                <SelectItem key={w.key} value={w.key}>{t("lotAcceptance.lastNDays", { n: w.days })}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {(plans?.length ?? 0) > 0 && (
            <Select value={selectedPlanId ? String(selectedPlanId) : "__auto"} onValueChange={(v) => setSelectedPlanId(v === "__auto" ? undefined : parseInt(v, 10))}>
              <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__auto">{t("lotAcceptance.autoPlan")}</SelectItem>
                {(plans ?? []).map((p: any) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.code}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{t("lotAcceptance.help")}</p>

      {/* AQL config */}
      {canEdit && (
        <div className="space-y-2">
          {!showForm ? (
            <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>{t("lotAcceptance.addAqlPlan")}</Button>
          ) : (
            <div className="space-y-2 rounded border p-2 bg-muted/20">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1"><Label className="text-xs">{t("lotAcceptance.code")}</Label><Input className="h-8" value={code} onChange={(e) => setCode(e.target.value)} /></div>
                <div className="space-y-1"><Label className="text-xs">{t("lotAcceptance.name")}</Label><Input className="h-8" value={name} onChange={(e) => setName(e.target.value)} /></div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1"><Label className="text-xs">{t("lotAcceptance.lotSize")}</Label><Input className="h-8" type="number" value={lotSize} onChange={(e) => setLotSize(e.target.value)} /></div>
                <div className="space-y-1"><Label className="text-xs">{t("lotAcceptance.sampleSize")}</Label><Input className="h-8" type="number" value={sampleSize} onChange={(e) => setSampleSize(e.target.value)} /></div>
                <div className="space-y-1"><Label className="text-xs">AQL {t("lotAcceptance.major")}</Label><Input className="h-8" value={aqlMajor} onChange={(e) => setAqlMajor(e.target.value)} placeholder="1.0" /></div>
              </div>
              <div className="grid grid-cols-4 gap-2">
                <div className="space-y-1"><Label className="text-xs">Ac</Label><Input className="h-8" type="number" value={acceptanceQty} onChange={(e) => setAcceptanceQty(e.target.value)} /></div>
                <div className="space-y-1"><Label className="text-xs">Re</Label><Input className="h-8" type="number" value={rejectionQty} onChange={(e) => setRejectionQty(e.target.value)} /></div>
                <div className="space-y-1"><Label className="text-xs">AQL {t("lotAcceptance.minor")}</Label><Input className="h-8" value={aqlMinor} onChange={(e) => setAqlMinor(e.target.value)} placeholder="2.5" /></div>
                <div className="space-y-1"><Label className="text-xs">AQL {t("lotAcceptance.critical")}</Label><Input className="h-8" value={aqlCritical} onChange={(e) => setAqlCritical(e.target.value)} placeholder="0.65" /></div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={save} disabled={createMut.isPending}>{t("common.save")}</Button>
                <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>{t("common.cancel")}</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Lot board */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-1 pr-2">{t("lotAcceptance.batch")}</th>
              <th className="py-1 pr-2">{t("lotAcceptance.inspected")}</th>
              <th className="py-1 pr-2">{t("lotAcceptance.sample")}</th>
              <th className="py-1 pr-2">{t("lotAcceptance.defectives")}</th>
              <th className="py-1 pr-2">Ac/Re</th>
              <th className="py-1 pr-2">{t("lotAcceptance.disposition")}</th>
            </tr>
          </thead>
          <tbody>
            {(lots ?? []).map((lot: any, i: number) => (
              <tr key={i} className="border-b">
                <td className="py-1 pr-2 font-mono">{lot.batchNumber ?? t("lotAcceptance.unbatched")}</td>
                <td className="py-1 pr-2">{lot.inspected}</td>
                <td className="py-1 pr-2">{lot.sampleTaken}{lot.plan?.sampleSize ? `/${lot.plan.sampleSize}` : ""}</td>
                <td className="py-1 pr-2">{lot.defectives}</td>
                <td className="py-1 pr-2">{lot.plan ? `${lot.plan.acceptNumber}/${lot.plan.rejectNumber}` : "—"}</td>
                <td className="py-1 pr-2">{dispositionBadge(lot.disposition)}</td>
              </tr>
            ))}
            {!isFetching && (lots?.length ?? 0) === 0 && (
              <tr><td colSpan={6} className="py-3 text-center text-muted-foreground italic">{t("lotAcceptance.noLots")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default ProductLotAcceptancePanel;
