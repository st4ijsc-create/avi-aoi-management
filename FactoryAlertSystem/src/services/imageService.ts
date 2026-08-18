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
import { getConfiguredApiKey, getServerBaseUrl } from './serverConfig';

// Default timeout for image API requests (ms)
const API_TIMEOUT = 15000;

/**
 * ★★★ **CHỦ DUY NHẤT** của câu hỏi *"cái `<Image>` này đi qua cổng ảnh bằng GÌ?"*
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO CẦN — ĐO ĐƯỢC, KHÔNG SUY RA (2026-08-18, máy chủ đang chạy `ANH_CONG_MO=false`)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Máy chủ **chỉ ký vé** cho ảnh trả về từ BA tuyến (`/api/inspection/:id/images`,
 * `/api/measurement-point/:id/reference-image`, `/api/product-model/:id/reference-images`).
 * Các tuyến app dùng NHIỀU HƠN vẫn trả **đường dẫn THÔ**:
 *
 *   | tuyến                                            | dạng `imageUrl` trả về            | đo được |
 *   |--------------------------------------------------|-----------------------------------|---------|
 *   | `/api/public/products/:code/measurement-points`   | `/uploads/measurement-points/…`   | ⛔ THÔ  |
 *   | `/api/external/inspections/images`                | `/uploads/inspections/…`          | ⛔ THÔ  |
 *   | `/api/external/stations/:id/inspection-points`    | `/uploads/…`                      | ⛔ THÔ  |
 *   | tải trọng cảnh báo qua **MQTT**                   | `/uploads/inspections/…`          | ⛔ THÔ  |
 *
 * Một đường dẫn THÔ gõ vào `/uploads/**` hôm nay trả **401 `AUTH_REQUIRED`** (đo bằng HTTP thật).
 * ⇒ Không có hàm này thì mọi ảnh của app hiện ô vỡ, trừ hai màn đi qua `fetchInspectionImages`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ TIỀN ĐỀ "RN KHÔNG GỬI ĐƯỢC HEADER TUỲ BIẾN" LÀ **SAI**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Chú thích ở `server/_core/anhKyUrl.ts` và `server/routes/_congAnh.ts` khai rằng
 * `<Image source={{uri}}>` của React Native **không** mang được header tuỳ biến, và toàn bộ cơ chế
 * vé ký được dựng trên tiền đề ấy. Đã kiểm trong chính `node_modules` của repo này:
 *   - `react-native/Libraries/Image/ImageSource.d.ts:35` → `headers?: {[key: string]: string}`
 *   - `react-native/Libraries/Image/ImageSource.js:118` → truyền `headers` xuống lớp native
 *   - `ReactAndroid/.../views/image/ReactImageView.java:403` → `setHeaders(ReadableMap)`
 * ⇒ Kênh header **CÓ THẬT** trên Android. Vé ký vẫn là đường chính (nó đã có sẵn và hẹp hơn);
 *   header `x-master-key` là đường phủ cho những URL máy chủ **không ký**.
 *
 * ⚠ VÌ SAO GẮN KHOÁ CẢ KHI URL **ĐÃ CÓ VÉ**: vé sống **900 giây**. Một tablet để mở màn trạm quá
 *   15 phút sẽ thấy ảnh chết dần — đúng lớp lỗi khó tố nhất ("lúc đầu xem được, sau thì không").
 *   Header là lưới đỡ cho vé hết hạn. Vé vẫn được giữ NGUYÊN trong URL, không cắt.
 *
 * ⚠⚠ **KHÔNG BAO GIỜ** gắn khoá vào URL trỏ sang máy chủ KHÁC: đó là rò khoá toàn quyền sang một
 *   host lạ. Chỉ gắn khi URL là đường dẫn tương đối, hoặc tuyệt đối và **cùng gốc** với máy chủ
 *   đã cấu hình. `data:` cũng không gắn (không có lượt gọi mạng nào).
 *
 * ⚠ Cố ý **KHÔNG** dùng `?masterKey=`: đã đo, `/uploads/**` trả **401** với kênh query ấy
 *   (`_congAnh.ts` từ chối có chủ ý vì khoá rò qua log/URL). Chỉ tuyến
 *   `/api/public/products/:code/reference-image-file` nhận `?masterKey=` — và chỗ đó đã có
 *   `stationService#resolveImageUrl` lo, không đụng tới.
 */
export interface NguonAnh {
  readonly uri: string;
  readonly headers?: Record<string, string>;
}

/** URL này có trỏ về đúng máy chủ app đã cấu hình không (⇒ có được gắn khoá không). */
function laMayChuCuaTa(uri: string): boolean {
  if (!/^https?:\/\//i.test(uri)) return true; // đường dẫn tương đối ⇒ luôn là máy chủ của ta
  const base = getServerBaseUrl();
  if (!base) return false; // chưa cấu hình ⇒ không biết là ai ⇒ KHÔNG gắn khoá
  const goc = (u: string) => {
    const m = /^https?:\/\/([^/?#]+)/i.exec(u);
    return m ? m[1].toLowerCase() : '';
  };
  const g = goc(uri);
  return g !== '' && g === goc(base);
}

/**
 * Dựng `source` cho `<Image>` sao cho nó qua được cổng ảnh.
 *
 * Dùng ở **mọi** điểm render ảnh của app. An toàn khi gọi thừa: với `data:`, với URL của host lạ,
 * và với chuỗi rỗng nó trả về đúng `{ uri }` như cũ — nên không có điểm render nào bị nó làm hỏng.
 */
export function nguonAnh(uri: string | null | undefined): NguonAnh {
  const u = uri || '';
  if (!u || u.startsWith('data:')) return { uri: u };
  if (!laMayChuCuaTa(u)) return { uri: u };
  const apiKey = getConfiguredApiKey();
  if (!apiKey) return { uri: u };
  return { uri: u, headers: { 'x-master-key': apiKey } };
}

/**
 * Nối thêm tham số truy vấn vào một URL ảnh — **cách DUY NHẤT đúng** kể từ khi máy chủ cấp vé ký.
 *
 * Với một URL đã mang vé (`…png?exp=…&pv=anh&sig=…`), nối tham số bằng `?` CỨNG sẽ tạo ra
 * **HAI dấu `?`** ⇒ URL hỏng ⇒ ảnh không tải được — và triệu chứng xuất hiện ĐÚNG LÚC bật cờ
 * `ANH_CONG_MO`, không phải lúc sửa mã.
 *
 * ⚠ ĐÍNH CHÍNH 2026-08-18 — bản ghi chú đầu của khối này khai khuôn hỏng "rải khắp app" và
 * nêu tên `panelParts.tsx`, `gallery.tsx`, `ImageViewerModal.tsx`. **Đã đọc từng chỗ: cả ba
 * VỐN ĐÚNG** — chúng tự tính `sep = url.includes('?') ? '&' : '?'`. Chỗ duy nhất sai là
 * `services/stationService.ts#resolveImageUrl`, và nó nối vào ĐÚNG tuyến được cấp vé ký
 * (`/reference-image-file`). Một ghi chú tố nhầm ba file lành còn tệ hơn không có ghi chú:
 * người sau sẽ đi "sửa" mã đang chạy đúng, rồi tin là đã xong.
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
