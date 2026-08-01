/**
 * doc 46 FE-W2 — reusable FONT-SAFE export menu for tabular data grids.
 *
 * A single "Export" dropdown offering PDF / Excel / CSV in VN / EN / ZH, rendered
 * server-side via `useReportExport` (embedded BeVietnamPro → correct diacritics).
 * Drop it onto any management grid that has columns + row objects; canvas/chart
 * screenshot exports keep their own client-side path.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, FileText, FileSpreadsheet, FileType, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  useReportExport,
  type ExportColumnSpec,
  type ExportFormat,
  type ExportLanguage,
} from "@/lib/serverReportExport";

const LANG_STORAGE_KEY = "synapse.export.language";

function resolveInitialLanguage(appLang: string): ExportLanguage {
  const saved = typeof localStorage !== "undefined" ? localStorage.getItem(LANG_STORAGE_KEY) : null;
  if (saved === "vi" || saved === "en" || saved === "zh") return saved;
  if (appLang.startsWith("en")) return "en";
  if (appLang.startsWith("zh")) return "zh";
  return "vi";
}

export interface ExportMenuProps {
  title: string;
  subtitle?: string;
  columns: ExportColumnSpec[];
  /** Row objects keyed by column.key. */
  data: Record<string, unknown>[];
  /** Report id → default filename (e.g. "sla_cockpit"). */
  type?: string;
  fileName?: string;
  disabled?: boolean;
  size?: "sm" | "default";
  variant?: "outline" | "default" | "ghost";
  className?: string;
}

export function ExportMenu({
  title,
  subtitle,
  columns,
  data,
  type,
  fileName,
  disabled,
  size = "sm",
  variant = "outline",
  className,
}: ExportMenuProps): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { exportReport, busy, isExporting } = useReportExport();
  const [language, setLanguage] = useState<ExportLanguage>(() => resolveInitialLanguage(i18n.language));

  const noData = !data || data.length === 0;

  const run = async (format: ExportFormat) => {
    if (noData) {
      toast.info(t("export.reportMenu.noData", "Không có dữ liệu để xuất"));
      return;
    }
    try {
      await exportReport({ type, title, subtitle, columns, data, fileName }, format, language);
      toast.success(t("export.reportMenu.success", "Đã xuất báo cáo"));
    } catch (err) {
      console.error("[ExportMenu] export failed:", err);
      toast.error(t("export.reportMenu.error", "Xuất báo cáo thất bại"));
    }
  };

  const onLanguageChange = (v: string) => {
    const lang = (v === "en" || v === "zh" ? v : "vi") as ExportLanguage;
    setLanguage(lang);
    try {
      localStorage.setItem(LANG_STORAGE_KEY, lang);
    } catch {
      /* localStorage unavailable (private mode) — keep in-memory only */
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size={size} disabled={disabled || isExporting} className={className}>
          {isExporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
          {t("export.reportMenu.button", "Xuất")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{t("export.reportMenu.language", "Ngôn ngữ")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={language} onValueChange={onLanguageChange}>
          <DropdownMenuRadioItem value="vi">{t("export.reportMenu.langVi", "Tiếng Việt")}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="en">{t("export.reportMenu.langEn", "English")}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="zh">{t("export.reportMenu.langZh", "中文")}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t("export.reportMenu.format", "Định dạng")}</DropdownMenuLabel>
        <DropdownMenuItem disabled={busy != null} onClick={() => run("pdf")}>
          <FileText className="mr-2 h-4 w-4" />
          {t("export.reportMenu.pdf", "PDF (font chuẩn VN)")}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={busy != null} onClick={() => run("xlsx")}>
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          {t("export.reportMenu.excel", "Excel (.xlsx)")}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={busy != null} onClick={() => run("csv")}>
          <FileType className="mr-2 h-4 w-4" />
          {t("export.reportMenu.csv", "CSV")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default ExportMenu;
