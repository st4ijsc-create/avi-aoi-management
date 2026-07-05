// W2-D — Step 2: choose the ingestion mode.
//   hot-folder : the machine drops CSV/XML/JSON exports into a watched folder
//                (config shape = W2-A's hot_folder_configs; provisioned at sign-off).
//   http-push  : the machine POSTs to the platform API (endpoint + feed-spec shown).
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FolderOpen, Globe, Info } from "lucide-react";
import { toast } from "sonner";
import type { StepProps } from "./types";

/** Published spec for custom/Chinese vendors (doc 27 §11 decision #3, W2-B owns the doc). */
const FEED_SPEC_PATH = "docs/ECOSYSTEM/28_ST4I_STANDARD_INSPECTION_FEED_SPEC.md";

export default function Step2DataSource({ state, update, onNext, onBack }: StepProps) {
  const { t } = useTranslation();

  const setHotFolder = (patch: Partial<typeof state.hotFolder>) =>
    update({ hotFolder: { ...state.hotFolder, ...patch } });

  const pushEndpoint = `${window.location.origin}/api/trpc/machineApi.submitInspection`;

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(() => toast.success(t("aoiOnboarding.copied")));
  };

  const hotFolderValid = state.ingestionMode !== "hot-folder" || state.hotFolder.watchPath.trim().length > 0;

  return (
    <div className="space-y-4">
      <RadioGroup
        value={state.ingestionMode}
        onValueChange={(v) => update({ ingestionMode: v as "hot-folder" | "http-push" })}
        className="grid gap-3 sm:grid-cols-2"
      >
        <Label
          htmlFor="aoi-mode-hot-folder"
          className={
            "rounded-lg border p-4 cursor-pointer space-y-1 " +
            (state.ingestionMode === "hot-folder" ? "border-primary ring-1 ring-primary" : "")
          }
        >
          <span className="flex items-center gap-2 font-medium">
            <RadioGroupItem value="hot-folder" id="aoi-mode-hot-folder" />
            <FolderOpen className="h-4 w-4" />
            {t("aoiOnboarding.step2.hotFolder")}
          </span>
          <span className="block text-xs text-muted-foreground font-normal">
            {t("aoiOnboarding.step2.hotFolderDesc")}
          </span>
        </Label>
        <Label
          htmlFor="aoi-mode-http-push"
          className={
            "rounded-lg border p-4 cursor-pointer space-y-1 " +
            (state.ingestionMode === "http-push" ? "border-primary ring-1 ring-primary" : "")
          }
        >
          <span className="flex items-center gap-2 font-medium">
            <RadioGroupItem value="http-push" id="aoi-mode-http-push" />
            <Globe className="h-4 w-4" />
            {t("aoiOnboarding.step2.httpPush")}
          </span>
          <span className="block text-xs text-muted-foreground font-normal">
            {t("aoiOnboarding.step2.httpPushDesc")}
          </span>
        </Label>
      </RadioGroup>

      {state.ingestionMode === "hot-folder" ? (
        <div className="rounded-lg border p-4 space-y-3">
          <div className="space-y-1">
            <Label htmlFor="aoi-hf-watch">{t("aoiOnboarding.step2.watchPath")} *</Label>
            <Input
              id="aoi-hf-watch"
              data-testid="aoi-wizard-watch-path"
              placeholder="D:\\AOI\\export"
              value={state.hotFolder.watchPath}
              onChange={(e) => setHotFolder({ watchPath: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">{t("aoiOnboarding.step2.watchPathHint")}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="aoi-hf-pattern">{t("aoiOnboarding.step2.filePattern")}</Label>
              <Input
                id="aoi-hf-pattern"
                value={state.hotFolder.filePattern}
                onChange={(e) => setHotFolder({ filePattern: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="aoi-hf-archive">{t("aoiOnboarding.step2.archivePath")}</Label>
              <Input
                id="aoi-hf-archive"
                placeholder={t("aoiOnboarding.step2.optionalDefault")}
                value={state.hotFolder.archivePath}
                onChange={(e) => setHotFolder({ archivePath: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="aoi-hf-error">{t("aoiOnboarding.step2.errorPath")}</Label>
              <Input
                id="aoi-hf-error"
                placeholder={t("aoiOnboarding.step2.optionalDefault")}
                value={state.hotFolder.errorPath}
                onChange={(e) => setHotFolder({ errorPath: e.target.value })}
              />
            </div>
          </div>
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs">
              {t("aoiOnboarding.step2.provisionHint")}
            </AlertDescription>
          </Alert>
        </div>
      ) : (
        <div className="rounded-lg border p-4 space-y-3">
          <div className="space-y-1">
            <Label>{t("aoiOnboarding.step2.endpoint")}</Label>
            <div className="flex items-center gap-2">
              <code className="text-xs bg-muted rounded px-2 py-1.5 flex-1 overflow-x-auto whitespace-nowrap">
                {pushEndpoint}
              </code>
              <Button size="sm" variant="outline" onClick={() => copy(pushEndpoint)}>
                {t("aoiOnboarding.copy")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("aoiOnboarding.step2.endpointHint")}</p>
          </div>
          <div className="space-y-1">
            <Label>{t("aoiOnboarding.step2.spec")}</Label>
            <div className="flex items-center gap-2">
              <code className="text-xs bg-muted rounded px-2 py-1.5 flex-1 overflow-x-auto whitespace-nowrap">
                {FEED_SPEC_PATH}
              </code>
              <Button size="sm" variant="outline" onClick={() => copy(FEED_SPEC_PATH)}>
                {t("aoiOnboarding.copy")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("aoiOnboarding.step2.specHint")}</p>
          </div>
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>{t("aoiOnboarding.back")}</Button>
        <Button data-testid="aoi-wizard-step2-next" onClick={onNext} disabled={!hotFolderValid}>
          {t("aoiOnboarding.next")}
        </Button>
      </div>
    </div>
  );
}
