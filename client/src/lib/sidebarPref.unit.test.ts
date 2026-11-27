// @vitest-environment jsdom
// Lựa chọn mở/thu gọn thanh bên — sidebarPref
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readSidebarOpen, workbenchSidebarKey, writeSidebarOpen } from "./sidebarPref";

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe("workbenchSidebarKey", () => {
  it("null → null", () => {
    expect(workbenchSidebarKey(null)).toBeNull();
  });
  it("undefined → null", () => {
    expect(workbenchSidebarKey(undefined)).toBeNull();
  });
  it("số 0 → \"sidebar_open:workbench:u0\"", () => {
    expect(workbenchSidebarKey(0)).toBe("sidebar_open:workbench:u0");
  });
  it("chuỗi \"u42\" → \"sidebar_open:workbench:uu42\"", () => {
    expect(workbenchSidebarKey("u42")).toBe("sidebar_open:workbench:uu42");
  });
});

describe("readSidebarOpen — màn thường (workbench=false)", () => {
  it("chưa lưu ⇒ true", () => {
    expect(readSidebarOpen({ workbench: false, userId: null })).toBe(true);
  });
  it("khoá \"false\" ⇒ false", () => {
    localStorage.setItem("sidebar_open", "false");
    expect(readSidebarOpen({ workbench: false, userId: null })).toBe(false);
  });
  it("khoá \"true\" ⇒ true", () => {
    localStorage.setItem("sidebar_open", "true");
    expect(readSidebarOpen({ workbench: false, userId: null })).toBe(true);
  });
  it("khoá \"0\" ⇒ true", () => {
    localStorage.setItem("sidebar_open", "0");
    expect(readSidebarOpen({ workbench: false, userId: null })).toBe(true);
  });
  it("khoá chuỗi rỗng ⇒ true", () => {
    localStorage.setItem("sidebar_open", "");
    expect(readSidebarOpen({ workbench: false, userId: null })).toBe(true);
  });
});

describe("readSidebarOpen — màn workbench (workbench=true)", () => {
  it("userId=null ⇒ false (dù khoá thường=\"true\")", () => {
    localStorage.setItem("sidebar_open", "true");
    expect(readSidebarOpen({ workbench: true, userId: null })).toBe(false);
  });
  it("userId=1, chưa lưu ⇒ false", () => {
    expect(readSidebarOpen({ workbench: true, userId: 1 })).toBe(false);
  });
  it("userId=1, khoá=\"true\" ⇒ true", () => {
    localStorage.setItem("sidebar_open:workbench:u1", "true");
    expect(readSidebarOpen({ workbench: true, userId: 1 })).toBe(true);
  });
  it("userId=1, khoá=\"false\" ⇒ false", () => {
    localStorage.setItem("sidebar_open:workbench:u1", "false");
    expect(readSidebarOpen({ workbench: true, userId: 1 })).toBe(false);
  });
  it("mỗi userId một khoá riêng (u1 mở ≠ u2 mở)", () => {
    localStorage.setItem("sidebar_open:workbench:u1", "true");
    expect(readSidebarOpen({ workbench: true, userId: 1 })).toBe(true);
    expect(readSidebarOpen({ workbench: true, userId: 2 })).toBe(false);
  });
  it("không bao giờ đọc khoá \"sidebar_open\"", () => {
    localStorage.setItem("sidebar_open", "true");
    expect(readSidebarOpen({ workbench: true, userId: 1 })).toBe(false);
  });
});

describe("readSidebarOpen — getItem ném lỗi", () => {
  it("workbench=false, getItem=ném ⇒ true, không văng", () => {
    const boom = () => {
      throw new Error("chan");
    };
    vi.stubGlobal("localStorage", { getItem: boom, setItem: boom, removeItem: boom });
    expect(() => readSidebarOpen({ workbench: false, userId: null })).not.toThrow();
    expect(readSidebarOpen({ workbench: false, userId: null })).toBe(true);
  });
  it("workbench=true, getItem=ném ⇒ false, không văng", () => {
    const boom = () => {
      throw new Error("chan");
    };
    vi.stubGlobal("localStorage", { getItem: boom, setItem: boom, removeItem: boom });
    expect(() => readSidebarOpen({ workbench: true, userId: 1 })).not.toThrow();
    expect(readSidebarOpen({ workbench: true, userId: 1 })).toBe(false);
  });
});

describe("writeSidebarOpen", () => {
  it("workbench=false, true → ghi \"true\" vào \"sidebar_open\"", () => {
    writeSidebarOpen(true, { workbench: false, userId: null });
    expect(localStorage.getItem("sidebar_open")).toBe("true");
  });
  it("workbench=false, false → ghi \"false\" vào \"sidebar_open\"", () => {
    writeSidebarOpen(false, { workbench: false, userId: null });
    expect(localStorage.getItem("sidebar_open")).toBe("false");
  });
  it("workbench=true, userId=5 → ghi vào khoá riêng, không đụng khoá thường", () => {
    writeSidebarOpen(true, { workbench: true, userId: 5 });
    expect(localStorage.getItem("sidebar_open:workbench:u5")).toBe("true");
    expect(localStorage.getItem("sidebar_open")).toBeNull();
  });
  it("workbench=true, userId=null → không ghi gì", () => {
    writeSidebarOpen(true, { workbench: true, userId: null });
    expect(localStorage.length).toBe(0);
  });
  it("workbench=false, setItem=ném → không văng", () => {
    const boom = () => {
      throw new Error("chan");
    };
    vi.stubGlobal("localStorage", { getItem: boom, setItem: boom, removeItem: boom });
    expect(() => writeSidebarOpen(true, { workbench: false, userId: null })).not.toThrow();
  });
});
