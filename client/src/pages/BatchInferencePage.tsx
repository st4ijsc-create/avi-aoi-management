import { useState } from "react";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge, type BadgeVariant } from "@/components/patterns";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Layers, Plus, RefreshCw, XCircle, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

/** Job status → shared <StatusBadge> map (solid shadcn variant, W4). */
const STATUS_MAP: Record<string, { variant: BadgeVariant }> = {
  PENDING: { variant: "outline" },
  RUNNING: { variant: "default" },
  COMPLETED: { variant: "secondary" },
  FAILED: { variant: "destructive" },
  CANCELLED: { variant: "outline" },
};

export default function BatchInferencePage() {
  const { t } = useTranslation();

  const [createOpen, setCreateOpen] = useState(false);
  const [newJobName, setNewJobName] = useState("");
  const [newModelId, setNewModelId] = useState("");
  const [newInputs, setNewInputs] = useState(""); // JSON array of { reference, type }
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);

  // ── Queries ────────────────────────────────────────────────
  const { data: jobs, isLoading, refetch } = trpc.aiAdvanced.batch.list.useQuery(
    { limit: 50 },
    { refetchInterval: 5000 },
  );

  const { data: models } = trpc.aiModel.list.useQuery(
    { status: "ACTIVE", limit: 100 },
    { staleTime: 60_000 },
  );

  const { data: selectedJob, refetch: refetchJob } = trpc.aiAdvanced.batch.getById.useQuery(
    { id: selectedJobId! },
    { enabled: selectedJobId !== null, refetchInterval: 3000 },
  );

  const { data: progress } = trpc.aiAdvanced.batch.progress.useQuery(
    { id: selectedJobId! },
    { enabled: selectedJobId !== null, refetchInterval: 2000 },
  );

  // ── Mutations ──────────────────────────────────────────────
  const createMutation = trpc.aiAdvanced.batch.create.useMutation({
    onSuccess: () => {
      toast.success(t("batch.created", "Batch job created"));
      setCreateOpen(false);
      setNewJobName("");
      setNewModelId("");
      setNewInputs("");
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const cancelMutation = trpc.aiAdvanced.batch.cancel.useMutation({
    onSuccess: () => { refetch(); refetchJob(); },
    onError: (err) => toast.error(err.message),
  });

  // ── Helpers ────────────────────────────────────────────────
  function handleCreate() {
    let inputs: Array<{ reference: string; type?: string }>;
    try {
      inputs = JSON.parse(newInputs);
      if (!Array.isArray(inputs)) throw new Error();
    } catch {
      toast.error(t("batch.invalidJson", "Invalid JSON input"));
      return;
    }
    createMutation.mutate({
      name: newJobName,
      modelId: Number(newModelId),
      inputs,
    });
  }

  const progressPercent = progress
    ? Math.round(((progress.completedItems ?? 0) / Math.max(progress.totalItems, 1)) * 100)
    : 0;

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Layers className="h-7 w-7 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">{t("batch.title", "Batch Inference Jobs")}</h1>
              <p className="text-sm text-muted-foreground">
                {t("batch.subtitle", "Run AI inference on large sets of images in parallel")}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-1" />
              {t("common.refresh", "Refresh")}
            </Button>

            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-1" />
                  {t("batch.newJob", "New Job")}
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>{t("batch.createTitle", "Create Batch Job")}</DialogTitle>
                  <DialogDescription>
                    {t("batch.createDesc", "Provide a JSON array of inputs to process.")}
                  </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-4 py-2">
                  <div className="flex flex-col gap-1.5">
                    <Label>{t("batch.jobName", "Job Name")}</Label>
                    <Input
                      placeholder={t("batch.jobNamePlaceholder", "e.g. Daily QC Batch 2024-07")}
                      value={newJobName}
                      onChange={(e) => setNewJobName(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>{t("batch.model", "AI Model")}</Label>
                    <select
                      className="border rounded px-3 py-2 text-sm bg-background"
                      value={newModelId}
                      onChange={(e) => setNewModelId(e.target.value)}
                    >
                      <option value="">{t("batch.selectModel", "-- Select a model --")}</option>
                      {(models as any[])?.map((m: any) => (
                        <option key={m.id} value={m.id}>{m.code} — {m.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>{t("batch.inputs", "Inputs (JSON array)")}</Label>
                    <textarea
                      className="border rounded px-3 py-2 text-sm font-mono h-32 resize-y bg-background"
                      placeholder='[{"reference": "/uploads/img1.jpg"}, {"reference": "/uploads/img2.jpg"}]'
                      value={newInputs}
                      onChange={(e) => setNewInputs(e.target.value)}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setCreateOpen(false)}>
                    {t("common.cancel", "Cancel")}
                  </Button>
                  <Button
                    onClick={handleCreate}
                    disabled={!newJobName || !newModelId || !newInputs || createMutation.isPending}
                  >
                    {createMutation.isPending ? t("common.creating", "Creating…") : t("common.create", "Create")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Jobs list */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{t("batch.jobs", "Jobs")}</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="p-4 space-y-2">
                    {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                  </div>
                ) : !jobs?.length ? (
                  <p className="p-6 text-center text-muted-foreground text-sm">
                    {t("batch.noJobs", "No batch jobs yet. Create one to get started.")}
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("batch.name", "Name")}</TableHead>
                        <TableHead>{t("batch.status", "Status")}</TableHead>
                        <TableHead>{t("batch.items", "Items")}</TableHead>
                        <TableHead>{t("batch.created", "Created")}</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {jobs.map((job: any) => (
                        <TableRow
                          key={job.id}
                          className={`cursor-pointer ${selectedJobId === job.id ? "bg-muted/50" : ""}`}
                          onClick={() => setSelectedJobId(job.id)}
                        >
                          <TableCell className="font-medium">{job.name}</TableCell>
                          <TableCell>
                            <StatusBadge status={job.status} variant={STATUS_MAP[job.status]?.variant ?? "outline"} />
                          </TableCell>
                          <TableCell>{job.totalItems ?? "—"}</TableCell>
                          <TableCell className="text-muted-foreground text-xs">
                            {job.createdAt ? format(new Date(job.createdAt), "MM/dd HH:mm") : "—"}
                          </TableCell>
                          <TableCell>
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Job detail panel */}
          <div className="lg:col-span-1">
            {selectedJob ? (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <CardTitle className="text-base">{selectedJob.name}</CardTitle>
                    {["PENDING", "RUNNING"].includes(selectedJob.status) && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => cancelMutation.mutate({ id: selectedJob.id })}
                        disabled={cancelMutation.isPending}
                      >
                        <XCircle className="h-4 w-4 mr-1" /> {t("common.cancel", "Cancel")}
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-2 items-center">
                    <StatusBadge status={selectedJob.status} variant={STATUS_MAP[selectedJob.status]?.variant ?? "outline"} />
                    <span className="text-xs text-muted-foreground">ID #{selectedJob.id}</span>
                  </div>

                  {progress && (
                    <div>
                      <div className="flex justify-between text-xs text-muted-foreground mb-1">
                        <span>{t("batch.progress", "Progress")}</span>
                        <span>{progress.completedItems ?? 0} / {progress.totalItems}</span>
                      </div>
                      <Progress value={progressPercent} className="h-2" />
                    </div>
                  )}

                  <Separator />

                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("batch.successCount", "Succeeded")}</span>
                      <span className="font-medium text-green-600">{selectedJob.completedItems}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("batch.failCount", "Failed")}</span>
                      <span className="font-medium text-red-500">{selectedJob.failedItems}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("batch.totalItems", "Total items")}</span>
                      <span className="font-medium">{selectedJob.totalItems ?? 0}</span>
                    </div>
                  </div>

                  {selectedJob.errorLog && (
                    <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950 rounded p-2 break-all">
                      {selectedJob.errorLog}
                    </p>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card className="flex items-center justify-center h-48">
                <p className="text-sm text-muted-foreground">
                  {t("batch.selectHint", "Select a job to view details")}
                </p>
              </Card>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
