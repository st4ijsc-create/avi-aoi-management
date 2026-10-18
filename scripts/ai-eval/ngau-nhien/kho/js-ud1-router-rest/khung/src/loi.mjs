/** Lỗi HTTP có chủ đích (4xx). GIAO DIỆN CHO SẴN — không sửa tệp này. */
export class HttpLoi extends Error {
  /**
   * @param {number} status   mã trạng thái HTTP
   * @param {string} ma       mã lỗi máy đọc được, vd "khong-tim-thay"
   * @param {unknown} [chiTiet] thông tin thêm (tuỳ chọn)
   * @param {Record<string,string>} [headers] header thêm vào phản hồi lỗi (khoá chữ thường)
   */
  constructor(status, ma, chiTiet, headers) {
    super(ma);
    this.name = "HttpLoi";
    this.status = status;
    this.ma = ma;
    this.chiTiet = chiTiet;
    this.headers = headers ?? {};
  }
}
