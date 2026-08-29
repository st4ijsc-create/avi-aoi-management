/**
 * LƯỚI đọc đề xuất sửa CỤC BỘ. Ở chế độ LOCAL, máy chủ KHÔNG phát `pending_action` (codingMode
 * false) — đề xuất đến từ VĂN BẢN model, nên parser này là cửa duy nhất. Sai một nhịp ở đây là
 * ghi nhầm tệp trên máy lập trình viên ⇒ mọi ca biên đều phải trả `[]` chứ KHÔNG đoán.
 */
import { describe, it, expect } from "vitest";
import { docDeXuatCucBo } from "./deXuatCucBo";

const KHOI = (j: string) => "Giải thích...\n```avi-tool\n" + j + "\n```\nxong.";

describe("docDeXuatCucBo", () => {
  it("★★★ đọc đề xuất sửa ĐOẠN", () => {
    const r = docDeXuatCucBo(KHOI('{"tool":"de_xuat_sua_doan","args":{"path":"src/A.cs","dongDau":3,"dongCuoi":5,"thayThe":"X"}}'));
    expect(r).toEqual([{ loai: "doan", path: "src/A.cs", dongDau: 3, dongCuoi: 5, thayThe: "X" }]);
  });

  it("★★★ đọc đề xuất TOÀN VĂN", () => {
    const r = docDeXuatCucBo(KHOI('{"tool":"de_xuat_sua","args":{"path":"src/A.cs","modified":"NOI DUNG MOI"}}'));
    expect(r).toEqual([{ loai: "toanVan", path: "src/A.cs", modified: "NOI DUNG MOI" }]);
  });

  it("★★★ JSON hỏng ⇒ [] , KHÔNG ném, KHÔNG đoán", () => {
    expect(docDeXuatCucBo(KHOI("{khong-phai-json}"))).toEqual([]);
  });

  it("★★★ thiếu trường bắt buộc ⇒ bỏ qua ĐỀ XUẤT ĐÓ", () => {
    expect(docDeXuatCucBo(KHOI('{"tool":"de_xuat_sua_doan","args":{"path":"a"}}'))).toEqual([]);
    expect(docDeXuatCucBo(KHOI('{"tool":"de_xuat_sua","args":{"modified":"x"}}'))).toEqual([]);
  });

  it("★★ dòng âm / dongCuoi < dongDau ⇒ bỏ qua", () => {
    expect(docDeXuatCucBo(KHOI('{"tool":"de_xuat_sua_doan","args":{"path":"a","dongDau":0,"dongCuoi":2,"thayThe":""}}'))).toEqual([]);
    expect(docDeXuatCucBo(KHOI('{"tool":"de_xuat_sua_doan","args":{"path":"a","dongDau":5,"dongCuoi":2,"thayThe":""}}'))).toEqual([]);
  });

  it("★★ NHIỀU khối trong một lượt ⇒ đọc đủ, đúng thứ tự", () => {
    const v = KHOI('{"tool":"de_xuat_sua","args":{"path":"a","modified":"1"}}') +
              KHOI('{"tool":"de_xuat_sua","args":{"path":"b","modified":"2"}}');
    expect(docDeXuatCucBo(v).map((x) => x.path)).toEqual(["a", "b"]);
  });

  it("★★ tool KHÁC (đọc/grep — việc của Đợt D) ⇒ bỏ qua ở đợt này", () => {
    expect(docDeXuatCucBo(KHOI('{"tool":"doc_tep","args":{"path":"a"}}'))).toEqual([]);
  });

  it("★ văn bản không có khối nào ⇒ []", () => {
    expect(docDeXuatCucBo("chỉ là văn xuôi")).toEqual([]);
  });
});
