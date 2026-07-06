import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ClipboardCheck } from "lucide-react";

type IpcClass = "1" | "2" | "3";

function acceptBadge(accept: string) {
  const map: Record<string, string> = {
    accept: "border-transparent bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    process: "border-transparent bg-amber-500/15 text-amber-600 dark:text-amber-400",
    reject: "border-transparent bg-destructive/15 text-destructive",
  };
  return <Badge className={map[accept] ?? "border-transparent bg-muted text-muted-foreground"}>{accept}</Badge>;
}

// IPC-A-610 per-class acceptance profile — surfaces the orphaned
// `ipcAcceptance` router (listClasses + listProfile).
export function IpcAcceptancePanel() {
  const { t } = useTranslation();
  const [ipcClass, setIpcClass] = useState<IpcClass>("2");
  const [filter, setFilter] = useState("");

  const classesQuery = trpc.ipcAcceptance.listClasses.useQuery();
  const profileQuery = trpc.ipcAcceptance.listProfile.useQuery({ ipcClass });

  const classes = classesQuery.data?.classes ?? [];
  const profile = profileQuery.data;
  const items = (profile?.items ?? []).filter((it: any) => {
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    return (
      String(it.code ?? "").toLowerCase().includes(q) ||
      String(it.name ?? "").toLowerCase().includes(q) ||
      String(it.category ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4" />
            {t("ipcAcceptance.title")}
          </CardTitle>
          <CardDescription>{t("ipcAcceptance.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <div className="space-y-1">
              <Label>{t("ipcAcceptance.class")}</Label>
              <Select value={ipcClass} onValueChange={(v) => setIpcClass(v as IpcClass)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {classes.length > 0 ? (
                    classes.map((c: any) => (
                      <SelectItem key={String(c.id)} value={String(c.id)}>
                        {`Class ${c.id}`}{c.name ? ` — ${c.name}` : ""}
                      </SelectItem>
                    ))
                  ) : (
                    <>
                      <SelectItem value="1">Class 1</SelectItem>
                      <SelectItem value="2">Class 2</SelectItem>
                      <SelectItem value="3">Class 3</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>{t("common.search")}</Label>
              <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t("ipcAcceptance.searchPlaceholder")} />
            </div>
          </div>

          {/* Summary counters */}
          {profile && (
            <div className="flex flex-wrap gap-3 text-sm">
              <span className="text-muted-foreground">{t("ipcAcceptance.total")}: <b>{profile.total}</b></span>
              <span className="text-emerald-600 dark:text-emerald-400">{t("ipcAcceptance.acceptCount")}: <b>{profile.acceptCount}</b></span>
              <span className="text-amber-600 dark:text-amber-400">{t("ipcAcceptance.processCount")}: <b>{profile.processCount}</b></span>
              <span className="text-destructive">{t("ipcAcceptance.rejectCount")}: <b>{profile.rejectCount}</b></span>
            </div>
          )}

          {profileQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : profileQuery.isError ? (
            <p className="text-sm text-destructive">{profileQuery.error.message}</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("ipcAcceptance.none")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("common.code")}</TableHead>
                  <TableHead>{t("common.name")}</TableHead>
                  <TableHead>{t("ipcAcceptance.category")}</TableHead>
                  <TableHead>{t("ipcAcceptance.verdict")}</TableHead>
                  <TableHead>{t("ipcAcceptance.reference")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((it: any) => (
                  <TableRow key={it.id ?? it.code}>
                    <TableCell className="font-medium">{it.code}</TableCell>
                    <TableCell>{it.nameVi ?? it.name}</TableCell>
                    <TableCell className="text-muted-foreground">{it.category ?? "—"}</TableCell>
                    <TableCell>{acceptBadge(it.accept)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {[it.ipcReference, it.ipcSection].filter(Boolean).join(" · ") || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default IpcAcceptancePanel;
