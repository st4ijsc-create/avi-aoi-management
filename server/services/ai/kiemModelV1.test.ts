/**
 * ★ M4 (audit bảo mật kiem-dinh 2026-10-21) — `/v1` nhận `model` do client gửi. Trước: chuỗi lạ đi THẲNG tới
 * `resolveModelPath` ⇒ đường tuyệt đối tồn tại được nạp, `..` thoát GGUF_MODELS_DIR, và thông điệp "GGUF model file not
 * found: <đường>" trả nguyên cho client (oracle tồn tại tệp).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kiemModelV1, thongDiepLoiChoKhachV1 } from "./kiemModelV1";
import { resolveLogicalModel } from "./modelResolver";
import { ANH_RONG, type AnhSoModel } from "./soModel/anhSoModel";

let dir: string;
let ngoai: string;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "m4-models-"));
  ngoai = fs.mkdtempSync(path.join(os.tmpdir(), "m4-ngoai-"));
  fs.writeFileSync(path.join(dir, "Model-A.gguf"), "GGUF");
  fs.writeFileSync(path.join(dir, "Co Dau Cach.gguf"), "GGUF"); // có THẬT trong thư mục nhưng ngoài danh sách ký tự
  fs.writeFileSync(path.join(ngoai, "bimat.gguf"), "GGUF");
});
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(ngoai, { recursive: true, force: true });
});

const anh: AnhSoModel = {
  ...ANH_RONG,
  taiLuc: 1,
  vaiTro: new Map([["extract", { envKey: "GGUF_FAST_MODEL", taskKind: "fast" }]]),
  profile: new Map([["ho-so@8k", { artifactFile: "Model-A.gguf", slotClass: "nang", artifactStatus: "available", license: "mit", enabled: true }]]),
  gan: [],
};

describe("kiemModelV1 — /v1 chỉ nhận tên logic, vai trò, hồ sơ trong sổ, hoặc TÊN TỆP nằm trong GGUF_MODELS_DIR", () => {
  const k = (m: string) => kiemModelV1(m, { thuMucModel: dir, anh });

  it("nhận: tên logic, auto, vai trò đã biết, hồ sơ (⇒ basename artifact), tên tệp có thật trong thư mục", () => {
    expect(k("chat")).toEqual({ ok: true, ten: "chat" });
    expect(k("auto")).toEqual({ ok: true, ten: "auto" });
    expect(k("extract")).toEqual({ ok: true, ten: "extract" });
    expect(k("ho-so@8k")).toEqual({ ok: true, ten: "Model-A" });
    expect(k("Model-A")).toEqual({ ok: true, ten: "Model-A" });
    expect(k("Model-A.gguf")).toEqual({ ok: true, ten: "Model-A.gguf" });
  });

  it("TỪ CHỐI: đường tuyệt đối, `..`, dấu phân cách, ổ đĩa, tệp không có, tệp ngoài thư mục", () => {
    for (const m of [
      path.join(ngoai, "bimat.gguf"),
      path.join(ngoai, "bimat"),
      `../${path.basename(ngoai)}/bimat`,
      "..\\x",
      "a/b",
      "C:bimat",
      "khong-co-model",
      "Co Dau Cach", // lớp 1 (danh sách ký tự) phải tự chặn — không trông vào lớp realpath
      "",
      "x".repeat(200),
    ]) {
      expect(k(m), m).toEqual({ ok: false });
    }
  });

  it("tên tệp là symlink trỏ RA NGOÀI thư mục ⇒ từ chối (kiểm realpath)", () => {
    const lien = path.join(dir, "Lien.gguf");
    try {
      fs.symlinkSync(path.join(ngoai, "bimat.gguf"), lien);
    } catch {
      return; // Windows không quyền tạo symlink ⇒ bỏ ca này (realpath vẫn được kiểm ở ca khác)
    }
    expect(k("Lien")).toEqual({ ok: false });
  });
});

describe("resolveLogicalModel — nhánh passthrough KHÔNG còn mang đường dẫn (phòng thủ chiều sâu cho mọi người gọi)", () => {
  it("chuỗi có dấu phân cách / `..` / ổ đĩa ⇒ undefined (engine dùng mặc định), tên trần vẫn giữ", () => {
    expect(resolveLogicalModel("../../etc/passwd")).toBeUndefined();
    expect(resolveLogicalModel("D:\\SOURCES\\x.gguf")).toBeUndefined();
    expect(resolveLogicalModel("/abs/model.gguf")).toBeUndefined();
    expect(resolveLogicalModel("C:model")).toBeUndefined();
    expect(resolveLogicalModel("Some-Model.gguf")).toBe("Some-Model");
  });
});

describe("thongDiepLoiChoKhachV1 — lỗi trả client KHÔNG mang đường dẫn", () => {
  it("lỗi không tìm thấy tệp / mang đường dẫn ⇒ thông điệp chung; lỗi thường giữ nguyên", () => {
    expect(thongDiepLoiChoKhachV1(new Error("GGUF model file not found: D:\\SOURCES\\16.AI\\x"), "chat completion failed")).toBe("model unavailable");
    expect(thongDiepLoiChoKhachV1(new Error("ENOENT: no such file or directory, open '/etc/x'"), "fail")).toBe("model unavailable");
    expect(thongDiepLoiChoKhachV1(new Error("context length exceeded"), "fail")).toBe("context length exceeded");
    expect(thongDiepLoiChoKhachV1(undefined, "completion failed")).toBe("completion failed");
  });
});
