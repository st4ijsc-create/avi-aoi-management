/**
 * AnalyticsErrorBoundary Component
 * Catches errors in analytics sections and displays user-friendly messages
 */

import React, { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle, RotateCcw } from 'lucide-react';
import { mapTrpcError } from "@/lib/trpcErrors";

interface AnalyticsErrorBoundaryProps {
  children: ReactNode;
  title?: string;
  onRetry?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class AnalyticsErrorBoundary extends React.Component<
  AnalyticsErrorBoundaryProps,
  State
> {
  constructor(props: AnalyticsErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Analytics error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return <ErrorFallback 
        error={this.state.error} 
        title={this.props.title}
        onRetry={() => {
          this.setState({ hasError: false, error: null });
          this.props.onRetry?.();
        }}
      />;
    }

    return this.props.children;
  }
}

interface ErrorFallbackProps {
  error: Error | null;
  title?: string;
  onRetry?: () => void;
}

function ErrorFallback({ error, title, onRetry }: ErrorFallbackProps) {
  const { t } = useTranslation();

  return (
    <Card className="border-red-500/30 bg-red-500/5">
      <CardContent className="pt-6">
        <div className="flex gap-4">
          <AlertCircle className="h-6 w-6 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 space-y-2">
            <h3 className="font-semibold text-sm text-red-700">
              {title || t('common.error', 'Error')}
            </h3>
            <p className="text-sm text-red-600">
              {error ? mapTrpcError(error) : t('common.unexpectedError', 'An unexpected error occurred')}
            </p>
            {onRetry && (
              <Button
                variant="outline"
                size="sm"
                onClick={onRetry}
                className="mt-3"
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                {t('common.tryAgain', 'Try again')}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
