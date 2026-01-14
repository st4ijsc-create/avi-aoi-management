import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCw, Bug, Home, AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  showDetails?: boolean;
  className?: string;
  variant?: 'default' | 'compact' | 'inline' | 'fullscreen';
  title?: string;
  description?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    
    // Log error to console for debugging
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    
    // Call optional error handler
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleGoHome = () => {
    window.location.href = '/';
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    const { hasError, error, errorInfo } = this.state;
    const { 
      children, 
      fallback, 
      showDetails = false, 
      className,
      variant = 'default',
      title = 'Đã xảy ra lỗi',
      description = 'Không thể hiển thị nội dung này. Vui lòng thử lại hoặc liên hệ hỗ trợ.'
    } = this.props;

    if (!hasError) {
      return children;
    }

    // Custom fallback
    if (fallback) {
      return fallback;
    }

    // Fullscreen variant - for app-level errors (original behavior)
    if (variant === 'fullscreen') {
      return (
        <div className="flex items-center justify-center min-h-screen p-8 bg-background">
          <div className="flex flex-col items-center w-full max-w-2xl p-8">
            <AlertTriangle
              size={48}
              className="text-destructive mb-6 flex-shrink-0"
            />

            <h2 className="text-xl mb-4">An unexpected error occurred.</h2>

            <div className="p-4 w-full rounded bg-muted overflow-auto mb-6">
              <pre className="text-sm text-muted-foreground whitespace-break-spaces">
                {error?.stack}
              </pre>
            </div>

            <button
              onClick={this.handleReload}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg",
                "bg-primary text-primary-foreground",
                "hover:opacity-90 cursor-pointer"
              )}
            >
              <RotateCcw size={16} />
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    // Inline variant - minimal error display
    if (variant === 'inline') {
      return (
        <div className={cn(
          'flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600',
          className
        )}>
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span className="text-sm">{title}</span>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={this.handleRetry}
            className="ml-auto h-7 px-2 text-red-600 hover:text-red-700 hover:bg-red-500/20"
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            Thử lại
          </Button>
        </div>
      );
    }

    // Compact variant - for widgets and small areas
    if (variant === 'compact') {
      return (
        <div className={cn(
          'flex flex-col items-center justify-center py-8 px-4 text-center',
          className
        )}>
          <div className="rounded-full p-3 bg-red-500/10 mb-3">
            <AlertCircle className="h-6 w-6 text-red-500" />
          </div>
          <p className="text-sm font-medium text-foreground mb-1">{title}</p>
          <p className="text-xs text-muted-foreground mb-4">{description}</p>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={this.handleRetry}
            className="gap-2"
          >
            <RefreshCw className="h-3 w-3" />
            Thử lại
          </Button>
        </div>
      );
    }

    // Default variant - full error card
    return (
      <div className={cn('flex items-center justify-center p-6', className)}>
        <Card className="max-w-md w-full border-red-500/20 bg-red-500/5">
          <CardHeader className="text-center">
            <div className="mx-auto rounded-full p-4 bg-red-500/10 mb-4">
              <Bug className="h-8 w-8 text-red-500" />
            </div>
            <CardTitle className="text-xl">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {showDetails && error && (
              <div className="p-3 rounded-lg bg-muted/50 overflow-auto max-h-40">
                <p className="text-xs font-mono text-red-600 mb-2">
                  {error.name}: {error.message}
                </p>
                {errorInfo && (
                  <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap">
                    {errorInfo.componentStack}
                  </pre>
                )}
              </div>
            )}
            
            <div className="flex gap-3 justify-center">
              <Button 
                variant="outline" 
                onClick={this.handleGoHome}
                className="gap-2"
              >
                <Home className="h-4 w-4" />
                Trang chủ
              </Button>
              <Button 
                onClick={this.handleRetry}
                className="gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                Thử lại
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }
}

// Functional wrapper for easier use with hooks
interface ErrorBoundaryWrapperProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  showDetails?: boolean;
  className?: string;
  variant?: 'default' | 'compact' | 'inline' | 'fullscreen';
  title?: string;
  description?: string;
}

export function withErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  errorBoundaryProps?: Omit<ErrorBoundaryWrapperProps, 'children'>
) {
  return function WithErrorBoundary(props: P) {
    return (
      <ErrorBoundary {...errorBoundaryProps}>
        <WrappedComponent {...props} />
      </ErrorBoundary>
    );
  };
}

// Specialized error boundaries for common use cases
export function ChartErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      variant="compact"
      title="Không thể hiển thị biểu đồ"
      description="Đã xảy ra lỗi khi render biểu đồ. Vui lòng thử lại."
    >
      {children}
    </ErrorBoundary>
  );
}

export function TableErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      variant="compact"
      title="Không thể hiển thị bảng"
      description="Đã xảy ra lỗi khi render bảng dữ liệu. Vui lòng thử lại."
    >
      {children}
    </ErrorBoundary>
  );
}

export function WidgetErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      variant="inline"
      title="Lỗi widget"
    >
      {children}
    </ErrorBoundary>
  );
}

export function AnalyticsErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      variant="compact"
      title="Không thể tải dữ liệu phân tích"
      description="Đã xảy ra lỗi khi tải dữ liệu phân tích. Vui lòng thử lại sau."
    >
      {children}
    </ErrorBoundary>
  );
}

export default ErrorBoundary;
