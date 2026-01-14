import React from 'react';
import { LucideIcon, Inbox, FileQuestion, Database, BarChart3, Settings, AlertCircle } from 'lucide-react';
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
}

const variantConfig: Record<EmptyStateVariant, { 
  icon: LucideIcon; 
  title: string; 
  description: string;
  iconColor: string;
}> = {
  default: {
    icon: Inbox,
    title: 'Không có dữ liệu',
    description: 'Chưa có dữ liệu nào được ghi nhận trong hệ thống.',
    iconColor: 'text-muted-foreground'
  },
  'no-data': {
    icon: Database,
    title: 'Chưa có dữ liệu',
    description: 'Dữ liệu sẽ được hiển thị khi có kết quả kiểm tra từ máy.',
    iconColor: 'text-blue-500'
  },
  'no-results': {
    icon: FileQuestion,
    title: 'Không tìm thấy kết quả',
    description: 'Không có kết quả nào phù hợp với bộ lọc hiện tại. Thử thay đổi điều kiện tìm kiếm.',
    iconColor: 'text-amber-500'
  },
  'no-analytics': {
    icon: BarChart3,
    title: 'Chưa có dữ liệu phân tích',
    description: 'Cần có dữ liệu kiểm tra để hiển thị biểu đồ và thống kê.',
    iconColor: 'text-emerald-500'
  },
  'no-config': {
    icon: Settings,
    title: 'Chưa cấu hình',
    description: 'Vui lòng cấu hình các thông số cần thiết để sử dụng tính năng này.',
    iconColor: 'text-purple-500'
  },
  error: {
    icon: AlertCircle,
    title: 'Đã xảy ra lỗi',
    description: 'Không thể tải dữ liệu. Vui lòng thử lại sau.',
    iconColor: 'text-red-500'
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
  compact = false
}: EmptyStateProps) {
  const config = variantConfig[variant];
  const Icon = CustomIcon || config.icon;
  const title = customTitle || config.title;
  const description = customDescription || config.description;

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
        variant === 'error' ? 'bg-red-500/10' : 'bg-muted'
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
  return (
    <EmptyState
      variant="no-analytics"
      title="Chưa có dữ liệu công trạm"
      description="Dữ liệu phân tích công trạm sẽ được hiển thị khi có kết quả kiểm tra từ các điểm đo được gán công trạm."
      actionLabel={onRefresh ? "Làm mới" : undefined}
      onAction={onRefresh}
    />
  );
}

export function NoMeasurementPoints({ onAdd }: { onAdd?: () => void }) {
  return (
    <EmptyState
      variant="no-config"
      title="Chưa có điểm đo"
      description="Thêm các điểm đo để định nghĩa vị trí kiểm tra trên sản phẩm."
      actionLabel={onAdd ? "Thêm điểm đo" : undefined}
      onAction={onAdd}
    />
  );
}

export function NoInspectionResults({ onSeedData }: { onSeedData?: () => void }) {
  return (
    <EmptyState
      variant="no-data"
      title="Chưa có kết quả kiểm tra"
      description="Kết quả kiểm tra sẽ được hiển thị khi máy AVI/AOI gửi dữ liệu qua API."
      actionLabel={onSeedData ? "Tạo dữ liệu mẫu" : undefined}
      onAction={onSeedData}
    />
  );
}

export function NoChartData() {
  return (
    <EmptyState
      variant="no-analytics"
      title="Chưa đủ dữ liệu"
      description="Cần có ít nhất một số kết quả kiểm tra để hiển thị biểu đồ."
      compact
    />
  );
}

export function LoadingError({ onRetry }: { onRetry?: () => void }) {
  return (
    <EmptyState
      variant="error"
      title="Không thể tải dữ liệu"
      description="Đã xảy ra lỗi khi tải dữ liệu. Vui lòng kiểm tra kết nối và thử lại."
      actionLabel={onRetry ? "Thử lại" : undefined}
      onAction={onRetry}
    />
  );
}

export default EmptyState;
