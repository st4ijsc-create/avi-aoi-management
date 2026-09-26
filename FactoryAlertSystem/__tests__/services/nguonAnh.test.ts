/**
 * Lưới cho `nguonAnh` — **CỔNG ẢNH của app**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ VÌ SAO LƯỚI NÀY GỌI HTTP THẬT, KHÔNG CHỈ SO CHUỖI
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Một lưới chỉ khẳng định `nguonAnh(u).headers['x-master-key'] === khoá` chứng minh **đúng một
 * điều**: hàm trả về cái tôi vừa bảo nó trả về. Nó **KHÔNG** chứng minh máy chủ nhận header ấy —
 * mà đó mới là câu hỏi. Đúng lớp lỗi "thiết bị đo mù đúng thứ nó được dựng ra để đo" đã trả giá
 * nhiều lần trong repo này.
 * ⇒ Nhóm §3 lấy ĐẦU RA của `nguonAnh` ném thẳng vào `fetch` tới máy chủ đang chạy, rồi đọc
 *   `Content-Type`. Không có máy chủ ⇒ **BỎ QUA có tuyên bố**, không im lặng xanh.
 *
 * ⚠ Ca ÂM là phần đắt nhất: §2 canh chiều "KHÔNG được gắn khoá". Một hàm gắn khoá cho MỌI URL vẫn
 *   làm ảnh hiện lên (nên §1 và §3 vẫn xanh) trong khi đang rò khoá toàn quyền sang host lạ.
 */
import { nguonAnh } from '../../src/services/imageService';
import { useSettingsStore } from '../../src/store/settingsStore';

const MAY_CHU = process.env.AVI_TEST_SERVER || 'http://127.0.0.1:3000';
const KHOA = process.env.AVI_TEST_MASTER_KEY || '';

/**
 * ⚠ Khoá GIẢ cho các nhóm so chuỗi. Cố ý **không** dùng `KHOA` thật ở đây: bản đầu của lưới này
 * viết `beforeEach(() => datCauHinh(MAY_CHU, KHOA || 'khoa-gia-de-test'))` rồi khẳng định
 * `toBe('khoa-gia-de-test')` — khi `AVI_TEST_MASTER_KEY` CÓ mặt thì vế trái là khoá thật, và ba ca
 * §1 đỏ vì **lưới sai**, không vì hàm sai. Một hằng số riêng làm lỗi ấy không diễn đạt được nữa.
 */
const KHOA_GIA = 'khoa-gia-de-test';

function datCauHinh(apiBaseUrl: string, apiKey: string) {
  useSettingsStore.getState().updateAppSettings({ apiBaseUrl, apiKey });
}

describe('nguonAnh — cổng ảnh phía app', () => {
  beforeEach(() => datCauHinh(MAY_CHU, KHOA_GIA));

  describe('§1 CHIỀU DƯƠNG — URL của máy chủ ta thì PHẢI mang khoá', () => {
    it('đường dẫn tương đối `/uploads/**` (dạng MQTT + /api/external trả về) mang khoá', () => {
      const n = nguonAnh('/uploads/inspections/142/R105.jpg');
      expect(n.uri).toBe('/uploads/inspections/142/R105.jpg');
      expect(n.headers?.['x-master-key']).toBe(KHOA_GIA);
    });

    it('URL tuyệt đối CÙNG gốc với máy chủ đã cấu hình mang khoá', () => {
      const n = nguonAnh(`${MAY_CHU}/uploads/measurement-points/30/a.png`);
      expect(n.headers?.['x-master-key']).toBe(KHOA_GIA);
    });

    it('URL ĐÃ CÓ VÉ vẫn được gắn khoá — vé chỉ sống 900 giây, header là lưới đỡ khi vé hết hạn', () => {
      const n = nguonAnh('/uploads/x/y.png?exp=1&pv=anh&sig=' + 'a'.repeat(64));
      expect(n.headers?.['x-master-key']).toBe(KHOA_GIA);
      // ⚠ vé phải được giữ NGUYÊN VẸN, không bị cắt/ghi đè
      expect(n.uri).toContain('sig=' + 'a'.repeat(64));
    });
  });

  describe('§2 CHIỀU ÂM — KHÔNG được gắn khoá (đây là phần chống rò khoá)', () => {
    it('❌ KHÔNG gắn khoá cho host LẠ — gắn là rò khoá toàn quyền sang máy chủ của người khác', () => {
      const n = nguonAnh('http://ke-la.example.com/uploads/x.png');
      expect(n.headers).toBeUndefined();
    });

    it('❌ KHÔNG gắn khoá cho `data:` — không có lượt gọi mạng nào', () => {
      const n = nguonAnh('data:image/png;base64,iVBORw0KGgo=');
      expect(n.headers).toBeUndefined();
    });

    it('❌ KHÔNG gắn khoá khi app CHƯA cấu hình khoá', () => {
      datCauHinh(MAY_CHU, '');
      expect(nguonAnh('/uploads/x.png').headers).toBeUndefined();
    });

    it('❌ chuỗi rỗng trả `{uri:""}` — không đẻ header, không ném', () => {
      expect(nguonAnh('').headers).toBeUndefined();
      expect(nguonAnh(null).uri).toBe('');
      expect(nguonAnh(undefined).uri).toBe('');
    });

    it('❌ cùng HOST nhưng khác CỔNG vẫn là máy chủ khác', () => {
      datCauHinh('http://127.0.0.1:3000', 'k');
      expect(nguonAnh('http://127.0.0.1:9999/uploads/x.png').headers).toBeUndefined();
    });
  });

  describe('§3 HTTP THẬT — header do `nguonAnh` sinh ra có MỞ ĐƯỢC cổng ảnh không', () => {
    const duong = '/uploads/measurement-points/30/AREA1-crop-E2Qm7OMZ.png';
    let songDuoc = false;

    beforeAll(async () => {
      try {
        const r = await fetch(`${MAY_CHU}/api/external/health`, {
          headers: KHOA ? { 'x-master-key': KHOA } : {},
        });
        songDuoc = r.ok;
      } catch {
        songDuoc = false;
      }
      if (!songDuoc) {
        console.warn(
          `[nguonAnh.test] BỎ QUA §3 — không tới được ${MAY_CHU} hoặc thiếu AVI_TEST_MASTER_KEY. ` +
            `Đây KHÔNG phải một lượt xanh: nhóm §3 chưa chạy.`,
        );
      }
    });

    it('TRẦN (không header) → 401, CÓ header của `nguonAnh` → 200 + byte ảnh', async () => {
      if (!songDuoc) return;
      datCauHinh(MAY_CHU, KHOA);

      const tran = await fetch(`${MAY_CHU}${duong}`);
      expect(tran.status).toBe(401);

      const n = nguonAnh(`${MAY_CHU}${duong}`);
      expect(n.headers).toBeDefined();
      const co = await fetch(n.uri, { headers: n.headers as Record<string, string> });
      expect(co.status).toBe(200);
      expect(co.headers.get('content-type')).toMatch(/^image\//);
    }, 20000);

    it('header cũng mở được biến thể resize `?w=&q=` (khuôn gallery/panelParts dùng)', async () => {
      if (!songDuoc) return;
      datCauHinh(MAY_CHU, KHOA);
      const n = nguonAnh(`${MAY_CHU}${duong}?w=200&q=60`);
      const r = await fetch(n.uri, { headers: n.headers as Record<string, string> });
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toMatch(/^image\//);
    }, 20000);
  });
});
