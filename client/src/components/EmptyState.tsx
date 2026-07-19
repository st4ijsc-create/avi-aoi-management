import React from 'react';
import { useTranslation } from 'react-i18next';
import { LucideIcon, Inbox, FileQuestion, Database, BarChart3, Settings, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type EmptyStateVariant = 
  | 'default' 
  | 'no-data' 
  | 'no-results' 
  | 'no-analytics' 
  | 'no-config' 
  | 'error';

interface EmptyStateProps {
  variant?: EmptyStateVariant;
  icon?: LucideIcon;
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
  compact?: boolean;
  /**
   * doc 67 W7 GĐ1 — trạng thái "TẤT CẢ ỔN" (ISA-101: trạng thái quan-trọng-nhất,
   * nhận diện được từ xa). "Rỗng" ở đây là TIN TỐT chứ không phải thiếu dữ liệu:
   * icon CheckCircle2 tone success + thông điệp tích cực mặc định
   * "Không có gì bất thường — hệ thống ổn định" (override qua title/description).
   * Khi bật, `allClear` thắng `variant`. Mặc định false → không đổi hành vi cũ.
   */
  allClear?: boolean;
}

const variantConfig: Record<EmptyStateVariant, { 
  icon: LucideIcon; 
  titleKey: string; 
  descriptionKey: string;
  iconColor: string;
}> = {
  default: {
    icon: Inbox,
    titleKey: 'common.noData',
    descriptionKey: 'common.noDataDescription',
    iconColor: 'text-muted-foreground'
  },
  'no-data': {
    icon: Database,
    titleKey: 'common.noDataYet',
    descriptionKey: 'common.noDataYetDescription',
    iconColor: 'text-info'
  },
  'no-results': {
    icon: FileQuestion,
    titleKey: 'common.noResults',
    descriptionKey: 'common.noResultsDescription',
    iconColor: 'text-warning'
  },
  'no-analytics': {
    icon: BarChart3,
    titleKey: 'common.noAnalytics',
    descriptionKey: 'common.noAnalyticsDescription',
    iconColor: 'text-success'
  },
  'no-config': {
    icon: Settings,
    titleKey: 'common.noConfig',
    descriptionKey: 'common.noConfigDescription',
    iconColor: 'text-primary'
  },
  error: {
    icon: AlertCircle,
    titleKey: 'errors.occurred',
    descriptionKey: 'errors.loadDataFailed',
    iconColor: 'text-destructive'
  }
};

export function EmptyState({
  variant = 'default',
  icon: CustomIcon,
  title: customTitle,
  description: customDescription,
  actionLabel,
  onAction,
  className,
  compact = false,
  allClear = false
}: EmptyStateProps) {
  const { t } = useTranslation();
  const config = allClear
    ? // Chuỗi tiếng Việt trực tiếp (không thêm key i18n ở GĐ1); override được.
      { icon: CheckCircle2, titleKey: '', descriptionKey: '', iconColor: 'text-success' }
    : variantConfig[variant];
  const Icon = CustomIcon || config.icon;
  const title = customTitle || (allClear ? 'Không có gì bất thường' : t(config.titleKey));
  const description =
    customDescription || (allClear ? 'Hệ thống ổn định' : t(config.descriptionKey));

  if (compact) {
    return (
      <div className={cn(
        'flex flex-col items-center justify-center py-6 px-4 text-center',
        className
      )}>
        <Icon className={cn('h-8 w-8 mb-2', config.iconColor)} />
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
        {actionLabel && onAction && (
          <Button 
            variant="outline" 
            size="sm" 
            onClick={onAction}
            className="mt-3"
          >
            {actionLabel}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className={cn(
      'flex flex-col items-center justify-center py-12 px-6 text-center',
      className
    )}>
      <div className={cn(
        'rounded-full p-4 mb-4',
        allClear ? 'bg-success/10' : variant === 'error' ? 'bg-destructive/10' : 'bg-muted'
      )}>
        <Icon className={cn('h-12 w-12', config.iconColor)} />
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-md">{description}</p>
      {actionLabel && onAction && (
        <Button 
          variant={variant === 'error' ? 'destructive' : 'default'} 
          onClick={onAction}
          className="mt-6"
        >
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

// Specialized empty states for common use cases
export function NoWorkstationData({ onRefresh }: { onRefresh?: () => void }) {
  const { t } = useTranslation();
  return (
    <EmptyState
      variant="no-analytics"
      title={t('machines.noWorkstationData')}
      description={t('machines.noWorkstationDataDescription')}
      actionLabel={onRefresh ? t('common.refresh') : undefined}
      onAction={onRefresh}
    />
  );
}

export function NoMeasurementPoints({ onAdd }: { onAdd?: () => void }) {
  const { t } = useTranslation();
  return (
    <EmptyState
      variant="no-config"
      title={t('products.noMeasurementPoints')}
      description={t('products.noMeasurementPointsDescription')}
      actionLabel={onAdd ? t('products.addMeasurementPoint') : undefined}
      onAction={onAdd}
    />
  );
}

export function NoInspectionResults({ onSeedData }: { onSeedData?: () => void }) {
  const { t } = useTranslation();
  return (
    <EmptyState
      variant="no-data"
      title={t('history.noInspectionResults')}
      description={t('history.noInspectionResultsDescription')}
      actionLabel={onSeedData ? t('history.createSampleData') : undefined}
      onAction={onSeedData}
    />
  );
}

export function NoChartData() {
  const { t } = useTranslation();
  return (
    <EmptyState
      variant="no-analytics"
      title={t('dashboard.notEnoughData')}
      description={t('dashboard.notEnoughDataDescription')}
      compact
    />
  );
}

export function LoadingError({ onRetry }: { onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <EmptyState
      variant="error"
      title={t('errors.cannotLoadData')}
      description={t('errors.cannotLoadDataDescription')}
      actionLabel={onRetry ? t('common.retry') : undefined}
      onAction={onRetry}
    />
  );
}

export default EmptyState;
