// @vitest-environment jsdom
//
// doc 81 Đợt 1D final wave 3 (M8) — "Sổ ký" (SystemHealth) hiện "không đọc được" khi server không đọc được ghim
// DỪNG (commissioning.status.pinnedStopTagsUnreadable), thay vì trông như "không có ghim". Render THẬT
// PinnedStopTagsPanel với bundle i18n THẬT (đọc thẳng 3 file locale — khuôn DeviceAdapterManagement.stopPin.dom).
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const localeJson = (rel: string) => JSON.parse(readFileSync(join(HERE, rel), "utf8"));

vi.mock("@/lib/trpc", () => ({ trpc: {} }));

import "../i18n";
import i18n from "i18next";
import { PinnedStopTagsPanel } from "./SystemHealth";

beforeAll(async () => {
  for (const lg of ["vi", "en", "zh"]) {
    i18n.addResourceBundle(lg, "translation", localeJson(`../i18n/locales/${lg}.json`), true, true);
  }
  await i18n.changeLanguage("vi");
});
afterEach(() => cleanup());

describe("M8 — PinnedStopTagsPanel", () => {
  it("★ không đọc được ⇒ cảnh báo 'không đọc được' (role=alert), không có danh sách", () => {
    render(<PinnedStopTagsPanel pinnedStopTags={[]} unreadable />);
    expect(screen.getByRole("alert")).toHaveTextContent("không đọc được");
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("đọc được ⇒ danh sách ghim, KHÔNG có cảnh báo", () => {
    render(<PinnedStopTagsPanel pinnedStopTags={[{ tagKey: "cmd_stop", value: true }]} unreadable={false} />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("cmd_stop = true")).toBeInTheDocument();
  });

  it("khoá systemHealth.comm.pin.unreadable có ở vi/en/zh, không lộ tên cờ .env", () => {
    for (const lg of ["vi", "en", "zh"]) {
      const v = i18n.getResource(lg, "translation", "systemHealth.comm.pin.unreadable");
      expect(v, lg).toBeTruthy();
      expect(String(v)).not.toMatch(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+){1,}\b/);
    }
  });
});
