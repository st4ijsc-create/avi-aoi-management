/**
 * doc69 Giai đoạn 5 / Wave E3 (E3-2) — Training Studio "Corpus" tab.
 *
 * Lists registered corpora (`trpc.kbStudio.listCorpora`, chunk/job stats already computed
 * server-side), a "create corpus" dialog, and a destructive delete flow. `deleteCorpus` is
 * gated ADMIN-ONLY + 2FA on the server (kbStudioRouter.ts — narrower than the rest of this
 * router); the delete button is hidden here for non-admins as a UX courtesy, but the server
 * gate is the actual enforcement. The delete confirmation requires TYPING the exact corpus
 * name (server re-checks this — see kbStudioRouter.ts's deleteCorpus doc comment) so a
 * misclick can never delete the wrong corpus.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { mapTrpcError } from "@/lib/trpcErrors";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";

export function CorpusTab() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const utils = trpc.useUtils();

  const corporaQuery = trpc.kbStudio.listCorpora.useQuery();

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const createMutation = trpc.kbStudio.createCorpus.useMutation({
    onSuccess: (data) => {
      toast.success(t("kbStudio.corpus.createSuccess", { name: data.name }));
      setCreateOpen(false);
      setNewName("");
      setNewDesc("");
      void utils.kbStudio.listCorpora.invalidate();
    },
    onError: (err) => toast.error(t("kbStudio.corpus.createError"), { description: mapTrpcError(err) }),
  });

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const deleteMutation = trpc.kbStudio.deleteCorpus.useMutation({
    onSuccess: (data) => {
      toast.success(
        t("kbStudio.corpus.deleteSuccess", {
          name: data.name,
          chunksRemoved: data.chunksRemoved,
          jobsRemoved: data.jobsRemoved,
        }),
      );
      setDeleteTarget(null);
      setConfirmText("");
      void utils.kbStudio.listCorpora.invalidate();
      void utils.kbStudio.listJobs.invalidate();
    },
    onError: (err) => toast.error(t("kbStudio.corpus.deleteError"), { description: mapTrpcError(err) }),
  });

  const corpora = corporaQuery.data?.corpora ?? [];

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">{t("kbStudio.corpus.title")}</CardTitle>
          <CardDescription>{t("kbStudio.corpus.desc")}</CardDescription>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1.5" />
              {t("kbStudio.corpus.createButton")}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{t("kbStudio.corpus.createTitle")}</DialogTitle>
              <DialogDescription>{t("kbStudio.corpus.createDesc")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label htmlFor="kb-studio-new-corpus-name">{t("kbStudio.corpus.nameLabel")}</Label>
                <Input
                  id="kb-studio-new-corpus-name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={t("kbStudio.corpus.namePlaceholder")}
                  aria-label={t("kbStudio.corpus.nameAria")}
                />
              </div>
              <div>
                <Label htmlFor="kb-studio-new-corpus-desc">{t("kbStudio.corpus.descLabel")}</Label>
                <Textarea
                  id="kb-studio-new-corpus-desc"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder={t("kbStudio.corpus.descPlaceholder")}
                  aria-label={t("kbStudio.corpus.descAria")}
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={createMutation.isPending}>
                {t("common.cancel", "Cancel")}
              </Button>
              <Button
                onClick={() => createMutation.mutate({ name: newName.trim(), description: newDesc.trim() || undefined })}
                disabled={!newName.trim() || createMutation.isPending}
              >
                {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {t("kbStudio.corpus.createSubmit")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {corporaQuery.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : corporaQuery.isError ? (
          <EmptyState
            variant="error"
            compact
            title={t("kbStudio.corpus.loadError")}
            description={corporaQuery.error instanceof Error ? mapTrpcError(corporaQuery.error) : undefined}
            actionLabel={t("common.retry", "Retry")}
            onAction={() => corporaQuery.refetch()}
          />
        ) : corporaQuery.data && !corporaQuery.data.tableAvailable ? (
          <EmptyState
            variant="no-config"
            compact
            title={t("kbStudio.corpus.tableUnavailable")}
            description={t("kbStudio.corpus.desc")}
          />
        ) : corpora.length === 0 ? (
          <EmptyState variant="no-data" compact title={t("kbStudio.corpus.empty")} description={t("kbStudio.corpus.desc")} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("kbStudio.corpus.colName")}</TableHead>
                  <TableHead>{t("kbStudio.corpus.colDescription")}</TableHead>
                  <TableHead className="text-right">{t("kbStudio.corpus.colChunks")}</TableHead>
                  <TableHead className="text-right">{t("kbStudio.corpus.colJobs")}</TableHead>
                  <TableHead>{t("kbStudio.corpus.colLastIngest")}</TableHead>
                  <TableHead>{t("kbStudio.corpus.colCreated")}</TableHead>
                  {isAdmin && <TableHead>{t("kbStudio.corpus.colActions")}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {corpora.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="max-w-[260px] truncate text-muted-foreground" title={c.description ?? undefined}>
                      {c.description ?? ""}
                    </TableCell>
                    <TableCell className="text-right">{c.chunkCount}</TableCell>
                    <TableCell className="text-right">{c.jobCount}</TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {c.lastIngestAt ? new Date(c.lastIngestAt).toLocaleString() : t("kbStudio.corpus.never")}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(c.createdAt).toLocaleString()}
                    </TableCell>
                    {isAdmin && (
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => {
                            setDeleteTarget(c.name);
                            setConfirmText("");
                          }}
                        >
                          <Trash2 className="h-4 w-4 mr-1.5" />
                          {t("kbStudio.corpus.deleteButton")}
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {!isAdmin && corpora.length > 0 && (
          <p className="text-xs text-muted-foreground mt-3">{t("kbStudio.corpus.adminOnlyNote")}</p>
        )}
      </CardContent>

      <AlertDialog open={deleteTarget != null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">
              {t("kbStudio.corpus.deleteTitle", { name: deleteTarget ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("kbStudio.corpus.deleteWarning")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="kb-studio-delete-confirm">{t("kbStudio.corpus.deleteConfirmLabel")}</Label>
            <Input
              id="kb-studio-delete-confirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              aria-label={t("kbStudio.corpus.deleteConfirmAria")}
              autoComplete="off"
            />
            {confirmText.length > 0 && confirmText !== deleteTarget && (
              <p className="text-xs text-destructive">{t("kbStudio.corpus.deleteConfirmMismatch")}</p>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>{t("common.cancel", "Cancel")}</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={!deleteTarget || confirmText !== deleteTarget || deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate({ name: deleteTarget, confirm: confirmText })}
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {t("kbStudio.corpus.deleteSubmit")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export default CorpusTab;
