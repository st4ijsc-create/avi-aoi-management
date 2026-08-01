// Doc 31 UX4 (WE-3) — extracted VERBATIM from ProductModels.tsx (the "Template
// Dialog" — save current points as a template / apply an existing one). Pure move:
// same JSX/bindings/i18n; state stays owned by the parent, threaded through props.
import { useTranslation } from "react-i18next";
import { Layers, Save, Download, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PermissionGate } from "@/components/PermissionGate";

export interface PointTemplateRow {
  id: number;
  name: string;
  category?: string | null;
  description?: string | null;
  points?: unknown;
}

interface PointTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  setName: (v: string) => void;
  category: string;
  setCategory: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  isSaving: boolean;
  pointCount: number;
  templates: PointTemplateRow[] | undefined;
  onSaveAsTemplate: () => void;
  onApplyTemplate: (template: PointTemplateRow) => void;
  onDeleteTemplate: (id: number) => void;
}

export function PointTemplateDialog(props: PointTemplateDialogProps) {
  const { t } = useTranslation();
  const {
    open, onOpenChange, name, setName, category, setCategory,
    description, setDescription, isSaving, pointCount, templates,
    onSaveAsTemplate, onApplyTemplate, onDeleteTemplate,
  } = props;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5" />
            {t("products.manageTemplates")}
          </DialogTitle>
          <DialogDescription>
            {t("products.templateDialogDesc")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Save as Template Section */}
          <div className="space-y-4 border-b pb-4">
            <h4 className="font-medium">{t("products.saveAsNewTemplate")}</h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("products.templateNameLabel")}</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('products.templateNameExample')}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("common.category")}</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("products.selectCategory")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="electronics">{t("products.catElectronics")}</SelectItem>
                    <SelectItem value="mechanical">{t("products.catMechanical")}</SelectItem>
                    <SelectItem value="assembly">{t("products.catAssembly")}</SelectItem>
                    <SelectItem value="general">{t("products.catGeneral")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("products.descriptionLabel")}</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("products.templateDescPlaceholder")}
                rows={2}
              />
            </div>
            <Button
              onClick={onSaveAsTemplate}
              disabled={isSaving || pointCount === 0}
              className="gap-2"
            >
              <Save className="h-4 w-4" />
              {t("products.savePointsAsTemplate", { count: pointCount })}
            </Button>
          </div>

          {/* Apply Template Section */}
          <div className="space-y-4">
            <h4 className="font-medium">{t("products.applyExistingTemplate")}</h4>
            <ScrollArea className="h-50 border rounded-md p-2">
              {templates && templates.length > 0 ? (
                <div className="space-y-2">
                  {templates.map((template) => (
                    <div
                      key={template.id}
                      className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent/50"
                    >
                      <div>
                        <div className="font-medium">{template.name}</div>
                        <div className="text-sm text-muted-foreground">
                          {template.category} • {template.description || t("products.noDescription")}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onApplyTemplate(template)}
                          className="gap-1"
                        >
                          <Download className="h-3 w-3" />
                          {t("common.apply")}
                        </Button>
                        <PermissionGate module="settings_products" action="canDelete">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onDeleteTemplate(template.id)}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </PermissionGate>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  {t("products.noTemplatesYet")}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
