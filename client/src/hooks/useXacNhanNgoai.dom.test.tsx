// @vitest-environment jsdom
//
// Đợt 10.4b (L1) — hai hộp hỏi người dùng (đồng ý model ngoài / xác nhận dữ liệu vận hành), điều khiển bằng hook; máy chủ GIẢ qua `layThongTin`.
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (_k: string, d?: unknown) => (typeof d === "string" ? d : _k) }) }));

import { useXacNhanNgoai } from "./useXacNhanNgoai";
import type { ThongTinNgoai } from "@shared/ai/sinhChuNgoai";

const MA = "ngoai:anthropic:claude-x";
const TT = (o: Partial<ThongTinNgoai> = {}): ThongTinNgoai => ({
  nhaCungCap: "anthropic",
  model: "claude-x",
  duocPhep: true,
  mucDuLieu: "van-hanh",
  choDuLieuVanHanh: true,
  conLaiTranNgay: { nguoi: { token: null }, nhaMay: { duTranChoLuotNay: true } },
  dinhKemBiCam: true,
  ...o,
});

let api: ReturnType<typeof useXacNhanNgoai>;
function Boc({ lay }: { lay: (ma: string) => Promise<ThongTinNgoai> }) {
  api = useXacNhanNgoai({ beMat: "chat", layThongTin: lay });
  return <>{api.hopThoai}</>;
}
function BocGo({ lay }: { lay: (ma: string) => Promise<ThongTinNgoai> }) {
  const [on, setOn] = useState(true);
  return (
    <>
      <button data-testid="go" onClick={() => setOn(false)} />
      {on ? <Boc lay={lay} /> : null}
    </>
  );
}

beforeEach(() => sessionStorage.clear());
afterEach(cleanup);

describe("useXacNhanNgoai — đồng ý model ngoài", () => {
  it("mở hộp với thông tin máy chủ; Đồng ý ⇒ true và hộp đóng", async () => {
    const lay = vi.fn(async () => TT());
    render(<Boc lay={lay} />);
    let kq: Promise<boolean>;
    act(() => {
      kq = api.xacNhanNgoai(MA);
    });
    expect(await screen.findByTestId("hop-dong-y-ngoai")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("hdy-dong-y")).not.toBeDisabled());
    expect(lay).toHaveBeenCalledWith(MA);
    fireEvent.click(screen.getByTestId("hdy-dong-y"));
    await expect(kq!).resolves.toBe(true);
    await waitFor(() => expect(screen.queryByTestId("hop-dong-y-ngoai")).toBeNull());
  });
  it("Từ chối ⇒ false; chưa tải xong ⇒ nút đồng ý KHOÁ; duocPhep=false ⇒ khoá", async () => {
    let xong!: (t: ThongTinNgoai) => void;
    const lay = vi.fn(() => new Promise<ThongTinNgoai>((r) => (xong = r)));
    render(<Boc lay={lay} />);
    let kq: Promise<boolean>;
    act(() => {
      kq = api.xacNhanNgoai(MA);
    });
    expect(await screen.findByTestId("hdy-dong-y")).toBeDisabled();
    await act(async () => xong(TT({ duocPhep: false, lyDo: "NGOAI_DU_LIEU_VAN_HANH", choDuLieuVanHanh: false })));
    expect(screen.getByTestId("hdy-dong-y")).toBeDisabled();
    fireEvent.click(screen.getByTestId("hdy-tu-choi"));
    await expect(kq!).resolves.toBe(false);
  });
  it("máy chủ lỗi ⇒ thông điệp + khoá (đóng mặc định)", async () => {
    render(<Boc lay={async () => Promise.reject(new Error("x"))} />);
    act(() => void api.xacNhanNgoai(MA));
    expect((await screen.findByTestId("hdy-loi")).textContent).toContain("Không tải được");
    expect(screen.getByTestId("hdy-dong-y")).toBeDisabled();
  });
  it("hộp mới mở khi hộp cũ còn mở ⇒ hộp cũ coi như TỪ CHỐI", async () => {
    render(<Boc lay={async () => TT()} />);
    let a: Promise<boolean>;
    let b: Promise<boolean>;
    act(() => {
      a = api.xacNhanNgoai(MA);
    });
    act(() => {
      b = api.xacNhanNgoai("ngoai:openai:gpt-y");
    });
    await expect(a!).resolves.toBe(false);
    await waitFor(() => expect(screen.getByTestId("hdy-nha-cung-cap")).toBeInTheDocument());
    fireEvent.click(await screen.findByTestId("hdy-tu-choi"));
    await expect(b!).resolves.toBe(false);
  });
  it("gỡ bề mặt khi hộp còn mở ⇒ Promise KHÔNG treo (false)", async () => {
    render(<BocGo lay={async () => TT()} />);
    let kq: Promise<boolean>;
    act(() => {
      kq = api.xacNhanNgoai(MA);
    });
    await screen.findByTestId("hop-dong-y-ngoai");
    fireEvent.click(screen.getByTestId("go"));
    await expect(kq!).resolves.toBe(false);
  });
});

describe("useXacNhanNgoai — xác nhận dữ liệu vận hành (428)", () => {
  it("Đồng ý ⇒ true và NHỚ theo hội thoại (lần sau không hỏi); hội thoại khác / model khác ⇒ hỏi lại", async () => {
    render(<Boc lay={async () => TT()} />);
    let a: Promise<boolean>;
    act(() => {
      a = api.hoiVanHanh("c1", MA);
    });
    expect(await screen.findByTestId("hop-xac-nhan-van-hanh")).toBeInTheDocument();
    expect(screen.getByTestId("xnvh-mo-ta").textContent).toContain("DỮ LIỆU VẬN HÀNH");
    fireEvent.click(screen.getByTestId("xnvh-dong-y"));
    await expect(a!).resolves.toBe(true);
    await expect(api.hoiVanHanh("c1", MA)).resolves.toBe(true);
    expect(screen.queryByTestId("hop-xac-nhan-van-hanh")).toBeNull();
    let b: Promise<boolean>;
    act(() => {
      b = api.hoiVanHanh("c2", MA);
    });
    expect(await screen.findByTestId("hop-xac-nhan-van-hanh")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("xnvh-tu-choi"));
    await expect(b!).resolves.toBe(false);
    let c: Promise<boolean>;
    act(() => {
      c = api.hoiVanHanh("c1", "ngoai:openai:gpt-y");
    });
    expect(await screen.findByTestId("hop-xac-nhan-van-hanh")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("xnvh-tu-choi"));
    await expect(c!).resolves.toBe(false);
  });
  it("từ chối KHÔNG được nhớ (lần sau hỏi lại)", async () => {
    render(<Boc lay={async () => TT()} />);
    let a: Promise<boolean>;
    act(() => {
      a = api.hoiVanHanh("c1", MA);
    });
    fireEvent.click(await screen.findByTestId("xnvh-tu-choi"));
    await expect(a!).resolves.toBe(false);
    act(() => void api.hoiVanHanh("c1", MA));
    expect(await screen.findByTestId("hop-xac-nhan-van-hanh")).toBeInTheDocument();
  });
});
