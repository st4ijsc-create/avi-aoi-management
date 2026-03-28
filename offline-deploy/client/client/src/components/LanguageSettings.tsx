import { useTranslation } from "react-i18next";
import { languages, type LanguageCode } from "@/i18n";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Globe, Check } from "lucide-react";
import { toast } from "sonner";

export default function LanguageSettings() {
  const { t, i18n } = useTranslation();
  const currentLang = i18n.language as LanguageCode;

  const handleChange = (code: LanguageCode) => {
    i18n.changeLanguage(code);
    toast.success(t("language.changed"));
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            {t("language.title")}
          </CardTitle>
          <CardDescription>{t("language.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground mb-4">
              {t("language.currentLanguage")}:{" "}
              <Badge variant="default" className="ml-1">
                {languages.find(l => l.code === currentLang)?.flag}{" "}
                {languages.find(l => l.code === currentLang)?.name}
              </Badge>
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {languages.map((lang) => {
                const isActive = currentLang === lang.code || (currentLang.startsWith(lang.code));
                return (
                  <button
                    key={lang.code}
                    onClick={() => handleChange(lang.code)}
                    className={`relative flex flex-col items-center gap-3 p-6 border-2 rounded-xl transition-all hover:shadow-md ${
                      isActive
                        ? "border-primary bg-primary/5 shadow-sm"
                        : "border-muted hover:border-primary/50"
                    }`}
                  >
                    {isActive && (
                      <div className="absolute top-2 right-2">
                        <Check className="h-5 w-5 text-primary" />
                      </div>
                    )}
                    <span className="text-4xl">{lang.flag}</span>
                    <div className="text-center">
                      <p className="font-semibold">{lang.name}</p>
                      <p className="text-xs text-muted-foreground uppercase">{lang.code}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Preview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("language.preview")}</CardTitle>
          <CardDescription>
            {t("language.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="space-y-2">
              <p><strong>{t("common.save")}</strong> — Save / Lưu / 保存</p>
              <p><strong>{t("common.cancel")}</strong> — Cancel / Hủy / 取消</p>
              <p><strong>{t("common.delete")}</strong> — Delete / Xóa / 删除</p>
              <p><strong>{t("common.search")}</strong> — Search / Tìm kiếm / 搜索</p>
            </div>
            <div className="space-y-2">
              <p><strong>{t("backup.title")}</strong></p>
              <p><strong>{t("webhook.title")}</strong></p>
              <p><strong>{t("language.title")}</strong></p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
