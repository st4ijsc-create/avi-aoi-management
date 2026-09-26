/**
 * LƯỚI bóc vỏ superjson. Máy chủ dùng transformer superjson ⇒ dữ liệu thật nằm ở
 * `result.data.json`. Bóc sai một tầng thì mọi danh sách đều rỗng mà KHÔNG có lỗi nào — hỏng im.
 */
import { describe, it, expect } from "vitest";
import { boBoiSuperjson } from "./trpc";

describe("boBoiSuperjson", () => {
  it("★★★ bóc đúng result.data.json", () => {
    expect(boBoiSuperjson({ result: { data: { json: { projects: [1] } } } })).toEqual({ projects: [1] });
  });
  it("★★ dạng không bọc json vẫn bóc được result.data", () => {
    expect(boBoiSuperjson({ result: { data: { projects: [2] } } })).toEqual({ projects: [2] });
  });
  it("★★★ đáp ứng lỗi ⇒ null (không giả vờ có dữ liệu)", () => {
    expect(boBoiSuperjson({ error: { json: { message: "x" } } })).toBeNull();
    expect(boBoiSuperjson(null)).toBeNull();
  });
});
