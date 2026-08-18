import { test } from "node:test";
import assert from "node:assert/strict";
import { validateTodo, MAX_TITLE } from "../src/validate.mjs";

test("chấp nhận tiêu đề bình thường", () => {
  const r = validateTodo({ title: "Mua vật tư" });
  assert.equal(r.ok, true);
  assert.equal(r.title, "Mua vật tư");
});

test("từ chối title không phải chuỗi", () => {
  assert.equal(validateTodo({ title: 123 }).ok, false);
  assert.equal(validateTodo({}).ok, false);
});

test("từ chối chuỗi rỗng", () => {
  assert.equal(validateTodo({ title: "" }).ok, false);
});

// ── HAI CA ĐANG ĐỎ — NHIỆM VỤ CỦA AI LÀ LÀM CHÚNG XANH ──────────────────────────────────

test("từ chối tiêu đề toàn khoảng trắng (cần trim)", () => {
  assert.equal(validateTodo({ title: "   " }).ok, false);
});

test("CẮT khoảng trắng đầu/cuối và từ chối tiêu đề quá dài", () => {
  // trim: "  Việc A  " ⇒ "Việc A"
  const r = validateTodo({ title: "  Việc A  " });
  assert.equal(r.ok, true);
  assert.equal(r.title, "Việc A");
  // quá dài ⇒ từ chối
  assert.equal(validateTodo({ title: "x".repeat(MAX_TITLE + 1) }).ok, false);
});
