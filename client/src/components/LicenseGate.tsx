/**
 * LicenseGate – Route-level guard that blocks access to unlicensed modules.
 *
 * Wrap any route content with this component. If the current route's module
 * is not allowed by the active license, it shows a "module not licensed" message
 * instead of rendering the children.
 *
 * Core modules are always allowed regardless of license status.
 */

import { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { useLicenseModules } from "@/hooks/useLicenseModules";
import { getModuleByRoute } from "../../../shared/module-registry";
import { ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface LicenseGateProps {
  children: ReactNode;
  /** Override route detection with a specific route path */
  route?: string;
}

export function LicenseGate({ children, route }: LicenseGateProps) {
  const { t } = useTranslation();
  const [location] = useLocation();
  const { isRouteAllowed, noLicenseKey, isLoading } = useLicenseModules();

  const currentRoute = route || location;

  // Still loading license info – render nothing (or a spinner)
  if (isLoading) return <>{children}</>;

  // Check if route is allowed
  if (isRouteAllowed(currentRoute)) {
    return <>{children}</>;
  }

  const mod = getModuleByRoute(currentRoute);

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="max-w-md w-full">
        <CardContent className="pt-8 pb-8 text-center space-y-4">
          <ShieldX className="w-16 h-16 text-destructive mx-auto" />
          <div>
            <h2 className="text-xl font-semibold mb-1">{t("licGate.moduleChuaDuocCapPhep", "Module chưa được cấp phép")}</h2>
            <p className="text-muted-foreground text-sm">
              {mod ? (
                <>
                  Module <strong>{mod.name}</strong> ({mod.code}) chưa được bao gồm
                  trong license hiện tại.
                </>
              ) : (
                t("licenseGate.trangNayThuocModuleChua", "Trang này thuộc module chưa được cấp phép trong license hiện tại.")
              )}
            </p>
          </div>
          {noLicenseKey && (
            <p className="text-xs text-muted-foreground">
              Chưa có license key nào được kích hoạt. Vui lòng liên hệ quản trị viên.
            </p>
          )}
          <Button variant="outline" onClick={() => (window.location.href = "/dashboard")}>
            Quay về Dashboard
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
