// @vitest-environment jsdom
//
// Pha 0 · C0-5 — CỔNG mô-đun robot/AGV: cờ tắt / chưa đọc được / lỗi ⇒ KHÔNG mount trang (không truy vấn, không mutation); cờ bật ⇒ như cũ; ngoài Provider ⇒ như cũ.
// i18n THẬT (vi). Đột biến (chạy tay, ghi ở báo cáo): lỗi ⇒ "bat" (fail-open) · "dang-tai" ⇒ mount trang · bỏ kiểm `=== true` · Provider luôn "bat".
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import i18next from "i18next";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";
import vi_ from "@/i18n/locales/vi.json";
import en_ from "@/i18n/locales/en.json";
import zh_ from "@/i18n/locales/zh.json";

const H = vi.hoisted(() => ({
  user: { id: 1 } as { id: number } | null,
  q: { isLoading: false, isError: false, data: { robotControlEnabled: true } } as { isLoading: boolean; isError: boolean; data?: { robotControlEnabled?: boolean } },
  hoi: vi.fn(),
  trangMount: vi.fn(),
}));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: H.user }) }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    oversight: {
      posture: {
        useQuery: (_i: unknown, o: { enabled?: boolean }) => {
          H.hoi(o);
          return H.q;
        },
      },
    },
  },
}));
vi.mock("wouter", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import { RobotModuleProvider, trangTuPosture } from "@/hooks/useRobotModuleTamDung";
import { CongMoDunRobot, DaiRobotTamDung } from "./CongMoDunRobot";

function Trang() {
  H.trangMount();
  return (
    <button type="button" data-testid="lenh-robot">
      Gửi lệnh robot
    </button>
  );
}
const dung = () =>
  render(
    <RobotModuleProvider>
      <CongMoDunRobot>
        <Trang />
      </CongMoDunRobot>
    </RobotModuleProvider>,
  );

beforeAll(async () => {
  await initLayoutKitTestI18n();
  i18next.addResourceBundle("vi", "translation", vi_ as Record<string, unknown>, true, true);
  i18next.addResourceBundle("en", "translation", en_ as Record<string, unknown>, true, true);
  i18next.addResourceBundle("zh", "translation", zh_ as Record<string, unknown>, true, true);
  await i18next.changeLanguage("vi");
});
beforeEach(() => {
  H.user = { id: 1 };
  H.q = { isLoading: false, isError: false, data: { robotControlEnabled: true } };
  H.hoi.mockClear();
  H.trangMount.mockClear();
});
afterEach(() => cleanup());

describe("trangTuPosture — hàm thuần", () => {
  it("đóng mặc định: chỉ `true` tường minh mới là bật", () => {
    expect(trangTuPosture({ dangTai: false, loi: false, robotControlEnabled: true })).toBe("bat");
    expect(trangTuPosture({ dangTai: false, loi: false, robotControlEnabled: false })).toBe("tam-dung");
    expect(trangTuPosture({ dangTai: false, loi: false, robotControlEnabled: undefined })).toBe("tam-dung");
    expect(trangTuPosture({ dangTai: false, loi: true, robotControlEnabled: true })).toBe("tam-dung"); // lỗi thắng dữ liệu cũ còn sót
    expect(trangTuPosture({ dangTai: true, loi: false, robotControlEnabled: true })).toBe("dang-tai");
  });
});

describe("CongMoDunRobot", () => {
  it("cờ bật ⇒ trang chạy như cũ, không dải", () => {
    dung();
    expect(screen.getByTestId("lenh-robot")).toBeInTheDocument();
    expect(screen.queryByTestId("dai-robot-tam-dung")).not.toBeInTheDocument();
  });

  it("cờ TẮT ⇒ dải 'sẽ phát triển sau' (vi thật), trang KHÔNG mount, 0 nút lệnh", () => {
    H.q = { isLoading: false, isError: false, data: { robotControlEnabled: false } };
    dung();
    expect(screen.getByTestId("dai-robot-tam-dung")).toHaveTextContent("Mô-đun robot/AGV sẽ phát triển sau");
    expect(screen.queryByTestId("lenh-robot")).not.toBeInTheDocument();
    expect(H.trangMount).not.toHaveBeenCalled();
  });

  it("đang tải ⇒ KHÔNG mount trang (không chớp 'bật' rồi tắt)", () => {
    H.q = { isLoading: true, isError: false };
    dung();
    expect(screen.getByTestId("cong-robot-dang-tai")).toBeInTheDocument();
    expect(H.trangMount).not.toHaveBeenCalled();
  });

  it("LỖI đọc cờ ⇒ coi như tạm dừng (fail-closed), kể cả khi data cũ còn `true`", () => {
    H.q = { isLoading: false, isError: true, data: { robotControlEnabled: true } };
    dung();
    expect(screen.getByTestId("dai-robot-tam-dung")).toBeInTheDocument();
    expect(H.trangMount).not.toHaveBeenCalled();
  });

  it("cờ vắng (data rỗng) ⇒ tạm dừng", () => {
    H.q = { isLoading: false, isError: false, data: {} };
    dung();
    expect(screen.getByTestId("dai-robot-tam-dung")).toBeInTheDocument();
  });

  it("chưa đăng nhập ⇒ Provider không hỏi máy chủ (enabled=false) và không chặn", () => {
    H.user = null;
    dung();
    expect(H.hoi).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    expect(screen.getByTestId("lenh-robot")).toBeInTheDocument();
  });

  it("ngoài Provider (test, màn khác) ⇒ như cũ: trang chạy", () => {
    render(
      <CongMoDunRobot>
        <Trang />
      </CongMoDunRobot>,
    );
    expect(screen.getByTestId("lenh-robot")).toBeInTheDocument();
  });

  it("dải nhỏ dùng mô tả ngắn; en/zh có đủ khoá", () => {
    render(<DaiRobotTamDung nho />);
    expect(screen.getByTestId("dai-robot-tam-dung")).toHaveTextContent("Chỉ xem");
    for (const l of ["en", "zh"]) {
      const d = (l === "en" ? en_ : zh_) as unknown as { robotTamDung: Record<string, string> };
      for (const k of ["tieuDe", "moTa", "moTaNgan", "dangKiemTra", "veTrangChu"]) expect(d.robotTamDung[k], `${l}.${k}`).toBeTruthy();
    }
  });
});
