import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, Home } from "lucide-react";
import { useLocation } from "wouter";
import { useTranslation } from 'react-i18next';

// B16 (doc 46 FE-W1) — 404 renders OUTSIDE the app-shell by design, so it carries its own
// chrome. Restyled to the SYNAPSE design tokens (teal `--primary`, `bg-background`/`bg-card`,
// `text-foreground`) so it stays on-brand and theme-aware in both light and dark modes.
export default function NotFound() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-lg border-border bg-card shadow-lg">
        <CardContent className="pt-10 pb-10 text-center">
          <div className="flex justify-center mb-6">
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10 glow-primary">
              <AlertCircle className="h-9 w-9 text-primary" />
            </div>
          </div>

          <p className="text-5xl font-bold tracking-tight text-primary mb-2">404</p>

          <h1 className="text-xl font-semibold text-foreground mb-3">
            {t('errors.pageNotFound')}
          </h1>

          <p className="text-sm text-muted-foreground mb-8 leading-relaxed max-w-sm mx-auto">
            {t('errors.pageNotFoundDesc')}
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button
              onClick={() => setLocation("/")}
              size="lg"
              className="shadow-lg hover:shadow-xl transition-all"
            >
              <Home className="w-4 h-4 mr-2" />
              {t('errors.goHome')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
