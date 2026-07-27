/**
 * doc69 Giai đoạn 5 / Wave E3 (E3-2) — Training Studio "Model Builder" tab.
 *
 * PLACEHOLDER ONLY — LoRA fine-tuning is task E3-6, not built here (see the brief: "do NOT
 * build training here, just a disabled/planned panel"). No mutation, no backend call — a
 * disabled affordance that sets honest expectations instead of a dead-end / missing tab.
 */
import { useTranslation } from "react-i18next";
import { Wrench } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function ModelBuilderTab() {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <CardTitle className="text-base">{t("kbStudio.modelBuilder.title")}</CardTitle>
          <Badge variant="outline">{t("kbStudio.modelBuilder.comingSoon")}</Badge>
        </div>
        <CardDescription>{t("kbStudio.modelBuilder.desc")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Wrench className="h-6 w-6" />
        </div>
        <p className="text-sm max-w-md text-muted-foreground">{t("kbStudio.modelBuilder.comingSoonDesc")}</p>
        <Button disabled variant="outline">
          {t("kbStudio.modelBuilder.startButton")}
        </Button>
      </CardContent>
    </Card>
  );
}

export default ModelBuilderTab;
