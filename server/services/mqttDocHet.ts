/**
 * Node 26 đổi `Readable.read()` không đối số: buffer có nhiều chunk thì chỉ trả chunk ĐẦU, dù tài liệu nói trả hết.
 * aedes gọi `conn.read(null)` đúng một lần mỗi sự kiện 'readable' và coi là đã rút hết. Phần còn lại nằm trong buffer mà
 * `needReadable` đang false nên không có 'readable' nào nữa: gói bị kẹt đến khi đóng kết nối.
 * Triệu chứng đo được: mqtt.js gửi CONNECT thành 11 frame WebSocket ⇒ broker không bao giờ trả CONNACK, client "connack timeout".
 * TCP cũng kẹt, đã đo: xác thực bất đồng bộ làm aedes ngừng đọc, PUBLISH chia 5 mảnh chất trong buffer ⇒ không có PUBACK (chia 2 mảnh thì không kẹt).
 * Image Docker chạy Node 20 nên không dính; máy DEV chạy Node 26.
 */
import type { Readable } from "node:stream";

/** `read()` / `read(null)` trên `conn` lại trả HẾT buffer như các bản Node trước. `read(n)` không đổi. */
export function docHetMoiLan<T extends Readable>(conn: T): T {
  const docGoc = conn.read;
  conn.read = function (this: T, n?: number | null) {
    return docGoc.call(this, n ?? (this.readableLength || undefined));
  };
  return conn;
}

/** Gói `handle` của broker: mọi kết nối (TCP, WebSocket, TLS) đều đi qua đây trước khi tới aedes. */
export function boDocHetVaoBroker<C extends Readable, R, K>(broker: { handle: (conn: C, req?: R) => K }): void {
  const handleGoc = broker.handle;
  broker.handle = (conn, req) => handleGoc.call(broker, docHetMoiLan(conn), req);
}
