/**
 * StationDetail — shared local types.
 * MB11 decomposition: moved verbatim from StationDetailScreen.tsx.
 */
/** Panel time range type (today / yesterday / 7 days / 30 days) */
type PanelTimeRange = 'today' | 'yesterday' | 'week' | 'month';

/** Layout info for the actual rendered image area within the canvas (contain mode) */
interface ImageLayout {
  renderW: number;
  renderH: number;
  offsetX: number;
  offsetY: number;
  canvasH: number;
}

/** Info for NG alert bubble callout */
interface AlertBubbleInfo {
  pointName: string;
  result: string;
  errorDesc: string;
  actualValue?: string;
  expectedValue?: string;
}

type ViewerImageData = {
  imageUrl: string;
  label?: string;
  isNG?: boolean;
  // ProductImageItem fields (optional)
  pointName?: string;
  type?: 'reference' | 'fail' | 'sample';
  supportsResize?: boolean; // true nếu ảnh từ server (hỗ trợ ?w=&q=)
};

export type { PanelTimeRange, ImageLayout, AlertBubbleInfo, ViewerImageData };
