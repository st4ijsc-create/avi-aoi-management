import { describe, expect, it } from "vitest";
import { baseName } from "./repoPath";

describe("baseName — tên tệp cuối, tách theo '/' (relPath repo dùng '/' mọi OS)", () => {
  it("lấy đoạn cuối", () => {
    expect(baseName("server/services/ai/dotnetNewScaffold.ts")).toBe("dotnetNewScaffold.ts");
    expect(baseName("App.xaml")).toBe("App.xaml");
  });
  it("bỏ dấu '/' thừa hai đầu", () => {
    expect(baseName("/a/b/")).toBe("b");
    expect(baseName("a//b")).toBe("b");
  });
  it("KHÔNG tách theo '\\' — '\\' là ký tự tên tệp, không phải phân cấp", () => {
    // Một đường tương đối repo không bao giờ có '\' làm phân cấp; nếu có '\' thì nó thuộc tên tệp.
    expect(baseName("dir/wei\\rd")).toBe("wei\\rd");
  });
  it("chuỗi rỗng / chỉ dấu '/' ⇒ trả nguyên đầu vào", () => {
    expect(baseName("")).toBe("");
    expect(baseName("/")).toBe("/");
  });
});
