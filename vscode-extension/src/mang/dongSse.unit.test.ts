/**
 * LƯỚI vòng đọc SSE. Dựng ReadableStream GIẢ cắt chunk ở giữa khung để chứng minh vòng đọc mang
 * đệm sang đúng — đây là chỗ mà lưới của `tachKhungSse` một mình KHÔNG phủ (nó đo hàm, còn đây
 * đo VÒNG dùng hàm).
 */
import { describe, it, expect } from "vitest";
import { docLuongSse } from "./dongSse";

function luongTu(manh: string[]): ReadableStream<Uint8Array> {
  const bo = new TextEncoder();
  return new ReadableStream({
    start(dk) {
      for (const m of manh) dk.enqueue(bo.encode(m));
      dk.close();
    },
  });
}

describe("docLuongSse", () => {
  it("★★★ khung cắt ngang chunk vẫn ra ĐỦ sự kiện, ĐÚNG thứ tự", async () => {
    const thu: Array<Record<string, unknown>> = [];
    await docLuongSse(luongTu(['data: {"i":1}\n\ndata: {"i', '":2}\n\n']), (sk) => thu.push(sk));
    expect(thu).toEqual([{ i: 1 }, { i: 2 }]);
  });

  it("★★★ khung hỏng được BÁO CÁO chứ không nuốt", async () => {
    const r = await docLuongSse(luongTu(["data: {hong}\n\n"]), () => {});
    expect(r.hong).toEqual(["{hong}"]);
  });

  it("★★ luồng kết thúc giữa khung dở ⇒ không ném, khung dở bị bỏ", async () => {
    const thu: Array<Record<string, unknown>> = [];
    const r = await docLuongSse(luongTu(['data: {"i":1}\n\ndata: {"do']), (sk) => thu.push(sk));
    expect(thu).toEqual([{ i: 1 }]);
    expect(r.hong).toEqual([]);
  });

  it("★★★ ký tự nhiều byte bị cắt GIỮA hai chunk không bị vỡ (chữ Việt)", async () => {
    // 'à' trong UTF-8 là 2 byte. Cắt vào GIỮA hai byte đó ⇒ decoder buộc phải giữ trạng thái
    // giữa hai lần đọc. Không có `{stream:true}` thì ký tự này biến thành ký tự thay thế.
    const bo = new TextEncoder();
    const byte = bo.encode('data: {"t":"Chào"}\n\n');
    const truoc = bo.encode('data: {"t":"Ch').length; // byte ĐẦU của 'à'
    const cat = truoc + 1; // rơi vào GIỮA 'à'
    const luong = new ReadableStream<Uint8Array>({
      start(dk) {
        dk.enqueue(byte.slice(0, cat));
        dk.enqueue(byte.slice(cat));
        dk.close();
      },
    });
    const thu: Array<Record<string, unknown>> = [];
    await docLuongSse(luong, (sk) => thu.push(sk));
    expect(thu).toEqual([{ t: "Chào" }]);
  });
});
