import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileText, ShieldAlert, CheckCircle2, Loader2 } from "lucide-react";

type RiskClass = "low" | "medium" | "high";

interface CardFormState {
  intendedUse: string;
  trainingDataDesc: string;
  evalSummary: string;
  limitations: string;
  riskClass: RiskClass;
  owner: string;
  notes: string;
}

const EMPTY_CARD_FORM: CardFormState = {
  intendedUse: "",
  trainingDataDesc: "",
  evalSummary: "",
  limitations: "",
  riskClass: "medium",
  owner: "",
  notes: "",
};

/**
 * D3 (doc69 Giai đoạn 4/Wave 3) — Model Card governance viewer/editor + the
 * card-required activation-gate affordance.
 *
 * Self-contained: queries `aiModel.getCard`, and depending on its `blocking` flag
 * either renders a warning banner (activation is CURRENTLY refused without a force
 * override — surfaces the exact backend reason) with a "Model Card" button, or a
 * plain "Model Card" button (with a checkmark once approved) when nothing is blocked.
 * Either way, clicking it opens the same editor dialog — create/update the governance
 * fields, then Approve once complete. Drop `<ModelCardManageButton modelId={id} />`
 * into any page that manages a model's versions.
 */
export function ModelCardManageButton({
  modelId,
  onChanged,
}: {
  modelId: number;
  onChanged?: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<CardFormState>(EMPTY_CARD_FORM);

  const query = trpc.aiModel.getCard.useQuery(
    { modelId },
    { enabled: modelId != null, staleTime: 15_000 },
  );

  useEffect(() => {
    const card = query.data?.card as
      | (CardFormState & { approvedAt?: string | Date | null; approvedBy?: number | null })
      | null
      | undefined;
    if (card) {
      setForm({
        intendedUse: card.intendedUse ?? "",
        trainingDataDesc: card.trainingDataDesc ?? "",
        evalSummary: card.evalSummary ?? "",
        limitations: card.limitations ?? "",
        riskClass: (card.riskClass as RiskClass) ?? "medium",
        owner: card.owner ?? "",
        notes: card.notes ?? "",
      });
    } else if (query.data && !card) {
      setForm(EMPTY_CARD_FORM);
    }
  }, [query.data]);

  const invalidate = () => {
    query.refetch();
    onChanged?.();
  };

  const createCard = trpc.aiModel.createCard.useMutation({
    onSuccess: () => {
      toast.success(t("modelCard.saved", "Model card saved"));
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const updateCard = trpc.aiModel.updateCard.useMutation({
    onSuccess: () => {
      toast.success(t("modelCard.saved", "Model card saved"));
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const approveCard = trpc.aiModel.approveCard.useMutation({
    onSuccess: () => {
      toast.success(t("modelCard.approvedToast", "Model card approved"));
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const hasCard = !!query.data?.card;
  const saving = createCard.isPending || updateCard.isPending;

  const handleSave = () => {
    const payload = {
      modelId,
      intendedUse: form.intendedUse.trim(),
      trainingDataDesc: form.trainingDataDesc.trim(),
      evalSummary: form.evalSummary.trim(),
      limitations: form.limitations.trim(),
      riskClass: form.riskClass,
      owner: form.owner.trim() || undefined,
      notes: form.notes.trim() || undefined,
    };
    if (hasCard) {
      updateCard.mutate(payload);
    } else {
      createCard.mutate(payload);
    }
  };

  const blocking = query.data?.blocking ?? false;

  return (
    <>
      {blocking ? (
        <div className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-destructive">
              {t("modelCard.gateBlockedTitle", "Activation blocked — model card required")}
            </div>
            <div className="mt-0.5 text-muted-foreground">
              {query.data?.reason ??
                t("modelCard.gateBlockedDesc", "Create and approve a model card before activating a version.")}
            </div>
          </div>
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => setOpen(true)}>
            <FileText className="mr-1.5 h-3.5 w-3.5" />
            {t("modelCard.manage", "Model Card")}
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <FileText className="mr-1.5 h-3.5 w-3.5" />
          {t("modelCard.manage", "Model Card")}
          {query.data?.approved ? <CheckCircle2 className="ml-1.5 h-3.5 w-3.5 text-success" /> : null}
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {t("modelCard.title", "Model Card")}
            </DialogTitle>
            <DialogDescription>
              {t(
                "modelCard.subtitle",
                "Governance metadata for this model. Required before activation once the card-required policy is turned on.",
              )}
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[60vh] pr-4">
            <div className="space-y-4 pb-2">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {query.data?.approved ? (
                  <Badge variant="default">{t("modelCard.approved", "Approved")}</Badge>
                ) : (
                  <Badge variant="outline">{t("modelCard.notApproved", "Not approved")}</Badge>
                )}
                {!query.data?.complete && hasCard ? (
                  <Badge variant="secondary">{t("modelCard.incomplete", "Incomplete")}</Badge>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label>{t("modelCard.intendedUse", "Intended Use")} *</Label>
                <Textarea
                  rows={2}
                  value={form.intendedUse}
                  onChange={(e) => setForm((p) => ({ ...p, intendedUse: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("modelCard.trainingDataDesc", "Training Data")} *</Label>
                <Textarea
                  rows={2}
                  value={form.trainingDataDesc}
                  onChange={(e) => setForm((p) => ({ ...p, trainingDataDesc: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("modelCard.evalSummary", "Evaluation Summary")} *</Label>
                <Textarea
                  rows={2}
                  value={form.evalSummary}
                  onChange={(e) => setForm((p) => ({ ...p, evalSummary: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("modelCard.limitations", "Limitations")} *</Label>
                <Textarea
                  rows={2}
                  value={form.limitations}
                  onChange={(e) => setForm((p) => ({ ...p, limitations: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("modelCard.riskClass", "Risk Class")} *</Label>
                  <Select
                    value={form.riskClass}
                    onValueChange={(v) => setForm((p) => ({ ...p, riskClass: v as RiskClass }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">{t("modelCard.riskLow", "Low")}</SelectItem>
                      <SelectItem value="medium">{t("modelCard.riskMedium", "Medium")}</SelectItem>
                      <SelectItem value="high">{t("modelCard.riskHigh", "High")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t("modelCard.owner", "Owner")} *</Label>
                  <Input value={form.owner} onChange={(e) => setForm((p) => ({ ...p, owner: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t("modelCard.notes", "Notes")}</Label>
                <Textarea
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                />
              </div>
            </div>
          </ScrollArea>

          <DialogFooter className="gap-2 sm:justify-between">
            <div>
              {hasCard && !query.data?.approved ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!query.data?.complete || approveCard.isPending}
                  title={
                    !query.data?.complete
                      ? t("modelCard.approveHint", "Fill in all required fields first")
                      : undefined
                  }
                  onClick={() => approveCard.mutate({ modelId })}
                >
                  {approveCard.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                  )}
                  {t("modelCard.approve", "Approve")}
                </Button>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                {t("common.cancel", "Cancel")}
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {t("common.save", "Save")}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
