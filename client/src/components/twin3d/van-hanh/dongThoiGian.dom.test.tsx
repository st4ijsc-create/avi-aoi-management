// @vitest-environment jsdom
/**
 * dongThoiGian.dom.test.tsx — ★ ĐỢT 40 (QA Đợt 39 Pareto #3): NHÃN "ẢNH LỊCH SỬ LÀ XẤP XỈ".
 *
 * `LICH_SU_LA_XAP_XI` tồn tại từ Đợt 6 (`server/db/twinCanh.ts`) mà **0 UI đọc** — máy sống-nhưng-`stopped`
 * tua lại hiện `running` không một lời (`.qa-dot39/bon-nguon/hb-M14.json`). Nay gói `anhLichSu` mang
 * `laXapXi` và thanh thời gian NÓI RA khi đang tua. Ba ô:
 *   (+) đang tua + cờ bật  ⇒ nhãn hiện, chữ là khoá i18n `twin3d.tua.xapXi`;
 *   (−) trực tiếp + cờ bật ⇒ KHÔNG hiện (không cảnh báo về thứ đang không xem);
 *   (−) đang tua + cờ tắt  ⇒ KHÔNG hiện (server không khai thì UI không bịa).
 * Đo bằng DOM thật (`@testing-library/react`), chỉ mock `react-i18next` (G20).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { DongThoiGian } from "./DongThoiGian";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, ...rest: unknown[]) => {
      const o = rest.find((x) => x && typeof x === "object") as Record<string, unknown> | undefined;
      return o && "gio" in o ? `${k}:${String(o.gio)}` : k;
    },
  }),
}));

afterEach(() => cleanup());

const BAY_GIO = 1_757_000_000_000;
const khongLamGi = () => {};

function ve(moc: number | null, laXapXi: boolean | undefined) {
  return render(
    <DongThoiGian
      moc={moc}
      bayGio={BAY_GIO}
      dangPhat={false}
      tocDo={1}
      onDoiMoc={khongLamGi}
      onDoiPhat={khongLamGi}
      onDoiTocDo={khongLamGi}
      laXapXi={laXapXi}
    />,
  );
}

describe("★ Đợt 40 — nhãn `nhan-lich-su-xap-xi` trên thanh thời gian", () => {
  it("(+) đang tua + `laXapXi` ⇒ nhãn HIỆN với khoá `twin3d.tua.xapXi`", () => {
    ve(BAY_GIO - 3_600_000, true);
    const nhan = screen.getByTestId("nhan-lich-su-xap-xi");
    expect(nhan).toBeInTheDocument();
    expect(nhan).toHaveTextContent("twin3d.tua.xapXi");
    // Ô đối chứng của thiết bị đo: thanh vẫn ở chế độ tua (nhãn mốc là "Xem lại …").
    expect(screen.getByTestId("nhan-moc-tua")).toHaveTextContent("twin3d.tua.xemLai:");
  });

  it("(−) TRỰC TIẾP + `laXapXi` ⇒ KHÔNG hiện — không cảnh báo về ảnh không xem", () => {
    ve(null, true);
    expect(screen.queryByTestId("nhan-lich-su-xap-xi")).toBeNull();
    expect(screen.getByTestId("nhan-moc-tua")).toHaveTextContent("twin3d.tua.trucTiep");
  });

  it("(−) đang tua + cờ TẮT/bỏ trống ⇒ KHÔNG hiện — server không khai thì UI không bịa", () => {
    ve(BAY_GIO - 3_600_000, false);
    expect(screen.queryByTestId("nhan-lich-su-xap-xi")).toBeNull();
    cleanup();
    ve(BAY_GIO - 3_600_000, undefined);
    expect(screen.queryByTestId("nhan-lich-su-xap-xi")).toBeNull();
  });
});
