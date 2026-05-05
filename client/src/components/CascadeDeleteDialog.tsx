import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

interface CascadeInfo {
  workshops?: number;
  lines?: number;
  stations?: number;
  machines?: number;
}

interface CascadeDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: "factory" | "workshop" | "line" | "station";
  entityName?: string;
  cascadeInfo?: CascadeInfo;
  isLoadingInfo?: boolean;
  onDeleteSingle: () => void;
  onDeleteCascade: () => void;
  isDeleting?: boolean;
}

export function CascadeDeleteDialog({
  open,
  onOpenChange,
  entityType,
  entityName,
  cascadeInfo,
  isLoadingInfo,
  onDeleteSingle,
  onDeleteCascade,
  isDeleting = false,
}: CascadeDeleteDialogProps) {
  const { t } = useTranslation();

  const totalChildren = cascadeInfo
    ? (cascadeInfo.workshops ?? 0) +
      (cascadeInfo.lines ?? 0) +
      (cascadeInfo.stations ?? 0) +
      (cascadeInfo.machines ?? 0)
    : 0;

  const hasChildren = totalChildren > 0;

  const buildChildrenSummary = () => {
    if (!cascadeInfo) return "";
    const parts: string[] = [];
    if (cascadeInfo.workshops && cascadeInfo.workshops > 0)
      parts.push(`${cascadeInfo.workshops} ${t("settings.workshopCount")}`);
    if (cascadeInfo.lines && cascadeInfo.lines > 0)
      parts.push(`${cascadeInfo.lines} ${t("settings.lineCount")}`);
    if (cascadeInfo.stations && cascadeInfo.stations > 0)
      parts.push(`${cascadeInfo.stations} ${t("settings.stationCount")}`);
    if (cascadeInfo.machines && cascadeInfo.machines > 0)
      parts.push(`${cascadeInfo.machines} ${t("settings.machineCount")}`);
    return parts.join(", ");
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-muted text-destructive">
              {hasChildren ? (
                <AlertTriangle className="h-5 w-5" />
              ) : (
                <Trash2 className="h-5 w-5" />
              )}
            </div>
            <AlertDialogTitle>{t("settings.confirmDelete")}</AlertDialogTitle>
          </div>
          <AlertDialogDescription className="pt-2 space-y-2">
            <span className="block">
              {t(`settings.delete${entityType.charAt(0).toUpperCase() + entityType.slice(1)}Confirm`, { name: entityName })}
            </span>
            {entityName && (
              <span className="block font-medium text-foreground">
                &quot;{entityName}&quot;
              </span>
            )}
            {isLoadingInfo && (
              <span className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("common.loading")}...
              </span>
            )}
            {hasChildren && (
              <span className="block mt-2 p-3 bg-destructive/10 border border-destructive/20 rounded-md text-destructive text-sm">
                <AlertTriangle className="h-4 w-4 inline mr-1" />
                {t("settings.cascadeDeleteWarning", { children: buildChildrenSummary() })}
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel disabled={isDeleting}>
            {t("common.cancel")}
          </AlertDialogCancel>
          {hasChildren ? (
            <>
              <Button
                variant="outline"
                onClick={onDeleteSingle}
                disabled={isDeleting || isLoadingInfo}
                className="border-destructive text-destructive hover:bg-destructive/10"
              >
                {isDeleting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {t("settings.deleteOnlyThis")}
              </Button>
              <Button
                onClick={onDeleteCascade}
                disabled={isDeleting || isLoadingInfo}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {isDeleting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {t("settings.deleteWithChildren")}
              </Button>
            </>
          ) : (
            <Button
              onClick={onDeleteSingle}
              disabled={isDeleting || isLoadingInfo}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {t("common.delete")}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
