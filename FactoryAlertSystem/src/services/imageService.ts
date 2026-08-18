/**
 * Factory Alert System - Image Service
 * Service tải ảnh theo yêu cầu (On-Demand Image Loading)
 * 
 * Thay vì gửi ảnh trực tiếp qua MQTT (gây chậm và nghẽn mạng),
 * app sẽ gọi REST API để tải ảnh khi user cần xem.
 * 
 * Flow: MQTT (lightweight payload) → Notification → User tap → 
 *       AlertDetail (text only) → "Xem ảnh" button → REST API → Display images
 */

import { InspectionImagesResponse, InspectionPointImage } from '../types';
import { getConfiguredApiKey } from './serverConfig';

// Default timeout for image API requests (ms)
const API_TIMEOUT = 15000;

/**
 * Nối thêm tham số truy vấn vào một URL ảnh — **cách DUY NHẤT đúng** kể từ khi máy chủ cấp vé ký.
 *
 * ⚠⚠ Khuôn cũ rải khắp app là `` `${url}?w=200&q=60` `` (xem
 * `screens/stationDetail/components/panelParts.tsx`, `gallery.tsx`, `ImageViewerModal.tsx`). Với
 * một URL đã mang vé (`…png?exp=…&pv=anh&sig=…`) khuôn ấy tạo ra **HAI dấu `?`** ⇒ URL hỏng ⇒ ảnh
 * không tải được. Dùng hàm này thay cho mọi lượt nối tay.
 */
export function themThamSoAnh(url: string, tham: Record<string, string | number>): string {
  if (!url) return url;
  const noi = url.includes('?') ? '&' : '?';
  const chuoi = Object.entries(tham)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return chuoi ? `${url}${noi}${chuoi}` : url;
}

class ImageService {
  private baseUrl: string = '';
  private apiKey: string = '';

  /**
   * Cập nhật base URL cho REST API
   * Thường được gọi khi settings thay đổi
   * @param url - Base URL (e.g., "http://192.168.1.100:3000")
   */
  setBaseUrl(url: string): void {
    // Remove trailing slash
    this.baseUrl = url.replace(/\/+$/, '');
    console.log('[ImageService] Base URL set to:', this.baseUrl);
  }

  /**
   * Cập nhật API key cho xác thực
   */
  setApiKey(key: string): void {
    this.apiKey = key;
  }

  /**
   * Lấy base URL hiện tại
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Build full URL từ relative path
   * @param relativePath - Relative URL từ MQTT (e.g., "/uploads/inspections/142/R105.jpg")
   * @returns Full URL (e.g., "http://192.168.1.100:3000/uploads/inspections/142/R105.jpg")
   *
   * ⚠ Hàm này CỐ Ý giữ nguyên query của `relativePath`. Máy chủ nay trả về đường dẫn đã kèm
   *   **vé ký** (`?exp=&pv=&sig=`) cho `<Image source={{uri}}>` — RN không gửi được cookie lẫn
   *   header tuỳ biến, nên query là kênh chứng thực duy nhất. Cắt/ghi đè query ở đây sẽ làm mọi
   *   ảnh chết khi máy chủ bật `ANH_CONG_MO=false`.
   * ⚠ Nơi nào cần thêm `?w=`/`?q=` PHẢI nối bằng `&` khi URL đã có `?` — xem `themThamSo` dưới.
   */
  buildImageUrl(relativePath: string): string {
    if (!relativePath) {
      return '';
    }

    // If already a full URL, return as-is
    if (relativePath.startsWith('http://') || relativePath.startsWith('https://')) {
      return relativePath;
    }

    if (!this.baseUrl) {
      console.warn('[ImageService] Base URL not set, cannot build full image URL');
      return relativePath;
    }

    // Ensure path starts with /
    const path = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
    return `${this.baseUrl}${path}`;
  }

  /**
   * Fetch danh sách ảnh của một lần kiểm tra từ REST API
   * GET /api/inspection/{inspectionId}/images
   * 
   * @param inspectionId - ID của lần kiểm tra
   * @returns Promise<InspectionImagesResponse>
   * @throws Error nếu request thất bại
   */
  async fetchInspectionImages(inspectionId: number): Promise<InspectionImagesResponse> {
    if (!this.baseUrl) {
      throw new Error('API base URL chưa được cấu hình. Vui lòng cập nhật trong Cài đặt.');
    }

    const url = `${this.baseUrl}/api/inspection/${inspectionId}/images`;
    console.log('[ImageService] Fetching images from:', url);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);

    try {
      const headers: Record<string, string> = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      };
      // ★★★ Dòng chú thích cũ ở đây ghi "does not require auth — no headers needed", và câu ấy
      //     ĐÚNG với máy chủ cũ: tuyến này nhận một SỐ NGUYÊN TUẦN TỰ rồi trả số serial + đường
      //     dẫn ảnh cho bất kỳ ai trong mạng nhà máy, không cần một chứng thực nào. Đó là lỗ đang
      //     được đóng, không phải một tính năng.
      //
      // ⚠ Máy chủ nay nhận `x-master-key` ở tuyến này (và sẽ TỪ CHỐI lượt gọi trần khi
      //   `ANH_CONG_MO=false`). App đã có sẵn khoá — cùng khoá `checkServerConnection` đang dùng
      //   bên dưới, và cùng khuôn với alertApiService/stationService/dashboardService.
      // ⚠ Gửi khoá KỂ CẢ KHI máy chủ còn mở: bản app này phải chạy được ở CẢ HAI phía của lượt
      //   bật cờ, vì đội máy ngoài hiện trường không cập nhật đồng thời với máy chủ.
      const apiKey = this.apiKey || getConfiguredApiKey();
      if (apiKey) {
        headers['x-master-key'] = apiKey;
      }

      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(
          `Lỗi tải ảnh (HTTP ${response.status}): ${errorText || response.statusText}`
        );
      }

      const data: InspectionImagesResponse = await response.json();

      if (!data.success) {
        throw new Error('Server trả về lỗi: response.success = false');
      }

      // Build full URLs for all image paths
      const pointsWithFullUrls: InspectionPointImage[] = data.pointsWithImages.map(point => ({
        ...point,
        imageUrl: this.buildImageUrl(point.imageUrl),
      }));

      const result: InspectionImagesResponse = {
        ...data,
        pointsWithImages: pointsWithFullUrls,
      };

      console.log(
        `[ImageService] Loaded ${result.pointsWithImages.length} images for inspection #${inspectionId}`
      );

      return result;
    } catch (error: any) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        throw new Error(`Hết thời gian tải ảnh (>${API_TIMEOUT / 1000}s). Kiểm tra kết nối mạng.`);
      }

      if (error.message?.includes('Network request failed')) {
        throw new Error(
          'Không thể kết nối đến server. Kiểm tra:\n' +
          '• Địa chỉ API server trong Cài đặt\n' +
          '• Kết nối mạng LAN\n' +
          '• Server đang chạy'
        );
      }

      throw error;
    }
  }

  /**
   * Kiểm tra kết nối đến API server
   * @returns true nếu server đang hoạt động
   */
  async checkServerConnection(): Promise<boolean> {
    if (!this.baseUrl) {
      return false;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      // A4/A5: probe the external health endpoint (the app uses /api/external/*)
      // and authenticate with the master key so it isn't rejected/redirected.
      const apiKey = this.apiKey || getConfiguredApiKey();
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (apiKey) {
        headers['x-master-key'] = apiKey;
      }

      const response = await fetch(`${this.baseUrl}/api/external/health`, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }
}

// Singleton instance
export const imageService = new ImageService();
