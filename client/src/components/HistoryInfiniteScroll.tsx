import { useCallback, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { 
  Cpu, 
  Calendar, 
  Eye, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle,
  History as HistoryIcon,
  Loader2,
  RefreshCw
} from "lucide-react";
import { Link } from "wouter";
import { format as formatDate } from "date-fns";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { InfiniteScrollList } from "@/components/InfiniteScrollList";

interface HistoryInfiniteScrollProps {
  filters: {
    factoryCode?: string;
    workshopCode?: string;
    lineCode?: string;
    stationCode?: string;
    machineCode?: string;
    serialNumber?: string;
    productModel?: string;
    result?: "OK" | "NG" | "NTF";
    startDate?: Date;
    endDate?: Date;
  };
  machines?: Array<{ id: number; name: string; code: string }>;
}

interface Inspection {
  id: number;
  machineId: number;
  serialNumber: string;
  productModel: string | null;
  overallResult: "OK" | "NG" | "NTF";
  inspectionTime: Date;
  corporateCode?: string | null;
  factoryCode?: string | null;
}

export function HistoryInfiniteScroll({ filters, machines }: HistoryInfiniteScrollProps) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const [filterKey, setFilterKey] = useState(0);
  // Lý do phạm vi rỗng do MÁY CHỦ khai (null = phạm vi bình thường). Giữ ở state vì phép phân
  // trang con trỏ trả từng trang một, còn lý do thì đi kèm MỌI trang.
  const [scopeEmptyReason, setScopeEmptyReason] = useState<string | null>(null);

  // Create fetch function for cursor-based pagination
  const fetchInspections = useCallback(async (cursor?: string) => {
    const result = await utils.inspection.listCursor.fetch({
      cursor,
      limit: 50,
      direction: 'forward',
      serialNumber: filters.serialNumber || undefined,
      productModel: filters.productModel || undefined,
      result: filters.result,
      startDate: filters.startDate,
      endDate: filters.endDate,
      corporateCode: filters.factoryCode || undefined, // Map factoryCode to corporateCode for API
      factoryCode: filters.factoryCode || undefined,
    });
    
    setScopeEmptyReason(result.scopeEmptyReason ?? null);

    return {
      data: result.data as Inspection[],
      nextCursor: result.nextCursor,
      prevCursor: result.prevCursor,
      hasMore: result.hasMore,
      total: result.data.length > 0 ? undefined : 0, // Cursor-based pagination doesn't have total
    };
  }, [utils.inspection.listCursor, filters]);

  const {
    data,
    isLoading,
    isLoadingMore,
    error,
    hasMore,
    loadMore,
    refresh,
    reset,
    total,
    loadMoreRef,
  } = useInfiniteScroll<Inspection>({
    fetchFn: fetchInspections,
    enabled: true,
  });

  // Reset and reload when filters change
  useEffect(() => {
    reset();
    setFilterKey(prev => prev + 1);
  }, [
    filters.factoryCode,
    filters.serialNumber,
    filters.productModel,
    filters.result,
    filters.startDate?.getTime(),
    filters.endDate?.getTime(),
    reset
  ]);

  // Reload after filter key changes
  useEffect(() => {
    if (filterKey > 0) {
      refresh();
    }
  }, [filterKey, refresh]);

  const getMachineName = (machineId: number) => {
    const machine = machines?.find(m => m.id === machineId);
    return machine?.name || `Machine #${machineId}`;
  };

  const getResultBadge = (result: string) => {
    switch (result) {
      case "OK":
        return (
          <Badge className="bg-success/20 text-success border-success/30 gap-1">
            <CheckCircle2 className="h-3 w-3" />
            OK
          </Badge>
        );
      case "NG":
        return (
          <Badge className="bg-destructive/20 text-destructive border-destructive/30 gap-1">
            <XCircle className="h-3 w-3" />
            NG
          </Badge>
        );
      case "NTF":
        return (
          <Badge className="bg-warning/20 text-warning border-warning/30 gap-1">
            <AlertTriangle className="h-3 w-3" />
            NTF
          </Badge>
        );
      default:
        return <Badge variant="secondary">{result}</Badge>;
    }
  };

  const renderInspectionItem = (inspection: Inspection) => (
    <div 
      className="flex items-center justify-between p-4 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors"
    >
      <div className="flex items-center gap-4">
        <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
          <Cpu className="h-6 w-6 text-primary" />
        </div>
        <div>
          <div className="flex items-center gap-3">
            <p className="font-semibold text-foreground">{inspection.serialNumber}</p>
            {getResultBadge(inspection.overallResult)}
          </div>
          <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Cpu className="h-3 w-3" />
              {getMachineName(inspection.machineId)}
            </span>
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {formatDate(new Date(inspection.inspectionTime), "dd/MM/yyyy HH:mm:ss")}
            </span>
            {inspection.productModel && (
              <span>Model: {inspection.productModel}</span>
            )}
          </div>
        </div>
      </div>
      <Link href={`/inspection/${inspection.id}`}>
        <Button variant="outline" size="sm" className="gap-2">
          <Eye className="h-4 w-4" />
          {t('common.details')}
        </Button>
      </Link>
    </div>
  );

  /**
   * ⚠ 2026-08-17 — TRẠNG THÁI RỖNG TRUNG THỰC.
   * 0 dòng của một tài khoản CHƯA ĐƯỢC GÁN NHÀ MÁY không được trình bày giống hệt 0 dòng của
   * một bộ lọc không khớp. Câu "không có kết quả — thử đổi bộ lọc" gửi người dùng đi chỉnh
   * bộ lọc suốt buổi, trong khi KHÔNG bộ lọc nào cứu được: phạm vi của họ rỗng. Máy chủ nói
   * ra lý do ở `scopeEmptyReason`; chỗ này chỉ việc đọc và không được im lặng.
   */
  const renderEmpty = () => (
    <div className="py-12 text-center">
      {scopeEmptyReason === 'no_factory_assignment' ? (
        <>
          <AlertTriangle className="h-12 w-12 mx-auto text-warning mb-4" />
          <p className="font-medium">{t('common.scopeEmpty.title')}</p>
          <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
            {t('common.scopeEmpty.hint')}
          </p>
        </>
      ) : (
        <>
          <HistoryIcon className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground">{t('common.noResults')}</p>
          <p className="text-sm text-muted-foreground mt-1">{t('common.tryChangeFilters')}</p>
        </>
      )}
    </div>
  );

  return (
    <Card className="glass-card">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">{t('history.searchResults')}</CardTitle>
            <CardDescription>
              {total
                ? t('history.foundResults', { count: total })
                : scopeEmptyReason === 'no_factory_assignment'
                  // Không được nói "không có dữ liệu" khi sự thật là phạm vi rỗng.
                  ? t('common.scopeEmpty.badge')
                  : t('common.noData')}
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={isLoading}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            {t('common.refresh')}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <InfiniteScrollList
          data={data}
          isLoading={isLoading}
          isLoadingMore={isLoadingMore}
          error={error}
          hasMore={hasMore}
          loadMoreRef={loadMoreRef}
          loadMore={loadMore}
          refresh={refresh}
          total={total}
          renderItem={renderInspectionItem}
          keyExtractor={(item) => item.id}
          renderEmpty={renderEmpty}
          showTotal={false}
          loadingText={t('history.loadingHistory')}
          loadMoreText={t('history.loadMoreResults')}
          emptyText={t('common.noResults')}
        />
      </CardContent>
    </Card>
  );
}

export default HistoryInfiniteScroll;
