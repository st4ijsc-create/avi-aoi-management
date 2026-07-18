/**
 * doc 59 Cụm G — "Export" nested tab-group của Reporting Studio: gom PDF + PPTX thành
 * các ĐÍCH xuất của một chỗ (thay vì 2 trang riêng). Nhúng *Content sẵn có (additive).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FileText, Presentation } from "lucide-react";
import { PdfReportsContent } from "@/pages/PdfReports";
import { PowerPointExportContent } from "@/pages/PowerPointExport";

const INNER = [
  { value: "pdf", labelKey: "reportingStudio.export.pdf", fallback: "PDF", icon: <FileText className="h-4 w-4" />, Content: PdfReportsContent },
  { value: "pptx", labelKey: "reportingStudio.export.pptx", fallback: "PowerPoint", icon: <Presentation className="h-4 w-4" />, Content: PowerPointExportContent },
] as const;

export function ExportTabGroup() {
  const { t } = useTranslation();
  const [inner, setInner] = useState<string>(INNER[0].value);
  return (
    <Tabs value={inner} onValueChange={setInner} className="space-y-3">
      <TabsList className="flex h-9 flex-wrap">
        {INNER.map((it) => (
          <TabsTrigger key={it.value} value={it.value} className="h-7 gap-1.5 text-xs">
            {it.icon}
            {t(it.labelKey, it.fallback)}
          </TabsTrigger>
        ))}
      </TabsList>
      {INNER.map((it) => (
        <TabsContent key={it.value} value={it.value} className="mt-2">
          <it.Content />
        </TabsContent>
      ))}
    </Tabs>
  );
}

export default ExportTabGroup;
