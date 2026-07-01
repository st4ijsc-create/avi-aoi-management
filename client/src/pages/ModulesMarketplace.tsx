/**
 * Modules Marketplace (doc 13 §7 — WS5.4). READ-ONLY surfacing page.
 *
 * Lists every SYSTEM_MODULE with its LIVE licensed/locked status derived from
 * useLicenseModules().modulesWithStatus ({ ...module, allowed }). Core modules are
 * always licensed; optional modules are licensed only when the active license
 * grants their code. Grouped into "Core" vs "Optional".
 *
 * This is a thin, read-only view: NO backend call beyond the existing license
 * hook, NO mutations. Honest when license data is absent/loading — it shows a
 * banner instead of pretending modules are unlocked, and never fabricates status.
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLicenseModules } from "@/hooks/useLicenseModules";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader } from "@/components/patterns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  LayoutGrid,
  Lock,
  CheckCircle2,
  ShieldCheck,
  Package,
  Info,
} from "lucide-react";

interface ModuleWithStatus {
  code: string;
  name: string;
  description: string;
  version: string;
  isCore: boolean;
  routes: string[];
  features: { code: string; name: string }[];
  allowed: boolean;
}

function StatusBadge({ allowed, isCore, t }: { allowed: boolean; isCore: boolean; t: (k: string, d: string) => string }) {
  if (isCore) {
    return (
      <Badge className="bg-sky-500 text-white">
        <ShieldCheck className="mr-1 h-3 w-3" />
        {t("modules.badgeCore", "Core")}
      </Badge>
    );
  }
  if (allowed) {
    return (
      <Badge className="bg-emerald-500 text-white">
        <CheckCircle2 className="mr-1 h-3 w-3" />
        {t("modules.badgeLicensed", "Licensed")}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-amber-400 text-amber-600">
      <Lock className="mr-1 h-3 w-3" />
      {t("modules.badgeLocked", "Locked")}
    </Badge>
  );
}

function ModuleCard({ m, t }: { m: ModuleWithStatus; t: (k: string, d: string) => string }) {
  const locked = !m.isCore && !m.allowed;
  return (
    <Card className={locked ? "opacity-80" : ""}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="h-4 w-4 text-primary" />
            {m.name}
          </CardTitle>
          <StatusBadge allowed={m.allowed} isCore={m.isCore} t={t} />
        </div>
        <p className="font-mono text-[11px] text-muted-foreground">{m.code} · v{m.version}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{m.description}</p>
        {m.features.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {m.features.slice(0, 6).map((f) => (
              <Badge key={f.code} variant="secondary" className="text-[10px] font-normal">
                {f.name}
              </Badge>
            ))}
            {m.features.length > 6 && (
              <Badge variant="secondary" className="text-[10px] font-normal">
                +{m.features.length - 6}
              </Badge>
            )}
          </div>
        )}
        {locked && (
          <p className="text-xs text-amber-600">
            {t("modules.upgradeHint", "Contact your administrator to license this module.")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function ModulesMarketplace() {
  const { t } = useTranslation();
  const {
    modulesWithStatus,
    isLicensed,
    licenseType,
    customerName,
    noLicenseKey,
    isLoading,
    isUsingCache,
  } = useLicenseModules();

  const { core, optional, licensedCount } = useMemo(() => {
    const mods = modulesWithStatus as unknown as ModuleWithStatus[];
    return {
      core: mods.filter((m) => m.isCore),
      optional: mods.filter((m) => !m.isCore),
      licensedCount: mods.filter((m) => m.allowed).length,
    };
  }, [modulesWithStatus]);

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-4 p-4 md:p-6">
        {/* Header — DS PageHeader (shared pattern) */}
        <PageHeader
          icon={<LayoutGrid className="h-6 w-6" />}
          title={t("modules.title", "Modules Marketplace")}
          description={t(
            "modules.subtitle",
            "All platform modules and their licensed status for this deployment (read-only).",
          )}
          actions={
            <Badge variant="outline" className="text-xs">
              {licensedCount}/{(modulesWithStatus as unknown[]).length}{" "}
              {t("modules.licensedCount", "licensed")}
            </Badge>
          }
        />

        {/* Honest license-state banner */}
        {(noLicenseKey || !isLicensed || isUsingCache) && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              {noLicenseKey
                ? t("modules.noLicense", "No license key is active — only core modules are available. Optional modules are shown as locked.")
                : isUsingCache
                  ? t("modules.usingCache", "License Server unreachable — showing cached module status.")
                  : t("modules.inactiveLicense", "No active license — optional modules are shown as locked.")}
            </div>
          </div>
        )}

        {(licenseType || customerName) && (
          <p className="text-xs text-muted-foreground">
            {customerName ? `${customerName} · ` : ""}
            {licenseType ? `${t("modules.licenseType", "License")}: ${licenseType}` : ""}
          </p>
        )}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t("modules.loading", "Loading modules…")}</p>
        ) : (
          <>
            {/* Core */}
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground">
                {t("modules.coreGroup", "Core modules")} ({core.length})
              </h2>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                {core.map((m) => (
                  <ModuleCard key={m.code} m={m} t={t} />
                ))}
              </div>
            </section>

            {/* Optional */}
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground">
                {t("modules.optionalGroup", "Optional modules")} ({optional.length})
              </h2>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                {optional.map((m) => (
                  <ModuleCard key={m.code} m={m} t={t} />
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
