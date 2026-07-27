/**
 * doc69 Giai đoạn 5 / Wave E3 (E3-2) — Training Studio "Jobs" tab.
 *
 * Recent ingest attempts (`trpc.kbStudio.listJobs`), polled so a running job's status
 * updates without a manual refresh (mirrors the repo's `usePollingInterval` convention —
 * see client/src/hooks/usePollingInterval.ts's doc comment: pauses while the tab is hidden,
 * refetches immediately on focus).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { usePollingInterval } from "@/hooks/usePollingInterval";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const STATUS_CLASS: Record<string, string> = {
  succeeded: "status-ok",
  failed: "status-ng",
  running: "status-info",
  pending: "status-ntf",
};

export function JobsTab() {
  const { t } = useTranslation();
  const [corpusFilter, setCorpusFilter] = useState<string>("__all__");
  const polling = usePollingInterval(5000);

  const corporaQuery = trpc.kbStudio.listCorpora.useQuery();
  const jobsQuery = trpc.kbStudio.listJobs.useQuery(
    { corpus: corpusFilter === "__all__" ? undefined : corpusFilter, limit: 50 },
    { ...polling },
  );

  const jobs = jobsQuery.data?.jobs ?? [];

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">{t("kbStudio.jobs.title")}</CardTitle>
          <CardDescription>{t("kbStudio.jobs.desc")}</CardDescription>
        </div>
        <Select value={corpusFilter} onValueChange={setCorpusFilter}>
          <SelectTrigger size="sm" aria-label={t("kbStudio.jobs.filterAllAria")} className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{t("kbStudio.jobs.filterAll")}</SelectItem>
            {(corporaQuery.data?.corpora ?? []).map((c) => (
              <SelectItem key={c.name} value={c.name}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {jobsQuery.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : jobsQuery.data && !jobsQuery.data.tableAvailable ? (
          <EmptyState
            variant="no-config"
            compact
            title={t("kbStudio.jobs.tableUnavailable")}
            description={t("kbStudio.jobs.desc")}
          />
        ) : jobs.length === 0 ? (
          <EmptyState variant="no-data" compact title={t("kbStudio.jobs.empty")} description={t("kbStudio.jobs.desc")} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("kbStudio.jobs.colCorpus")}</TableHead>
                  <TableHead>{t("kbStudio.jobs.colSource")}</TableHead>
                  <TableHead>{t("kbStudio.jobs.colType")}</TableHead>
                  <TableHead>{t("kbStudio.jobs.colStatus")}</TableHead>
                  <TableHead className="text-right">{t("kbStudio.jobs.colChunks")}</TableHead>
                  <TableHead>{t("kbStudio.jobs.colCreated")}</TableHead>
                  <TableHead>{t("kbStudio.jobs.colError")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell className="font-medium">{job.corpus}</TableCell>
                    <TableCell className="max-w-[220px] truncate" title={job.sourceRef}>
                      {job.sourceRef}
                    </TableCell>
                    <TableCell>{job.sourceType}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={STATUS_CLASS[job.status] ?? ""}>
                        {t(`kbStudio.jobs.status.${job.status}`, job.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{job.chunksAdded ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(job.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="max-w-[240px] truncate text-xs text-destructive" title={job.error ?? undefined}>
                      {job.error ?? ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default JobsTab;
