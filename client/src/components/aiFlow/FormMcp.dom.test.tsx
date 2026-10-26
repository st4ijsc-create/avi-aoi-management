// @vitest-environment jsdom
//
// Lô MCP client — form CÓ KIỂU của `tich-hop.mcp-goi` (thuần theo props): tên máy chủ / tool cố định kèm cảnh báo định dạng, đối số dạng cặp tên → biểu thức (≤ 20), chọn bí mật ⇒ kieuXacThuc mặc định bearer.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { NodeInstance } from "@shared/flow/model";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import { FormMcp, TRAN_DOI_SO_FORM_MCP } from "./FormMcp";

afterEach(cleanup);
const tid = (c: HTMLElement, id: string) => c.querySelector(`[data-testid="${id}"]`) as HTMLElement;
const nut = (p: Record<string, unknown>, extra: Partial<NodeInstance> = {}): NodeInstance => ({ id: "m", type: "tich-hop.mcp-goi", typeVersion: 1, name: "m", position: [0, 0], parameters: p, ...extra }) as NodeInstance;

describe("FormMcp", () => {
  it("ghi server / tool / truongRa; tên sai định dạng hiện cảnh báo (vai trò alert), tên đúng thì không", () => {
    const doi = vi.fn();
    const { container, rerender } = render(<FormMcp node={nut({})} p={{}} doi={doi} onDoi={vi.fn()} biMat={[]} />);
    fireEvent.change(tid(container, "mcp-server"), { target: { value: "may-do" } });
    expect(doi).toHaveBeenLastCalledWith("server", "may-do");
    fireEvent.change(tid(container, "mcp-tool"), { target: { value: "do-oee" } });
    expect(doi).toHaveBeenLastCalledWith("tool", "do-oee");
    fireEvent.change(tid(container, "mcp-truong-ra"), { target: { value: "kq" } });
    expect(doi).toHaveBeenLastCalledWith("truongRa", "kq");
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0);
    rerender(<FormMcp node={nut({ server: "Máy Chủ", tool: "{{ $json.t }}" })} p={{ server: "Máy Chủ", tool: "{{ $json.t }}" }} doi={doi} onDoi={vi.fn()} biMat={[]} />);
    expect(container.querySelectorAll('[role="alert"]').length).toBeGreaterThanOrEqual(2);
  });

  it("đối số: thêm ⇒ {doiSoN: ''}; sửa giá trị / tên; bỏ; đủ 20 ⇒ nút thêm vô hiệu", () => {
    const doi = vi.fn();
    const { container, rerender } = render(<FormMcp node={nut({})} p={{ thamSo: {} }} doi={doi} onDoi={vi.fn()} biMat={[]} />);
    fireEvent.click(tid(container, "mcp-them-doi-so"));
    expect(doi).toHaveBeenLastCalledWith("thamSo", { doiSo1: "" });
    rerender(<FormMcp node={nut({})} p={{ thamSo: { may: "{{ $json.x }}", gio: "8" } }} doi={doi} onDoi={vi.fn()} biMat={[]} />);
    fireEvent.change(tid(container, "mcp-doi-so-gia-tri-1"), { target: { value: "24" } });
    expect(doi).toHaveBeenLastCalledWith("thamSo", { may: "{{ $json.x }}", gio: "24" });
    fireEvent.change(tid(container, "mcp-doi-so-ten-0"), { target: { value: "idMay" } });
    expect(doi).toHaveBeenLastCalledWith("thamSo", { idMay: "{{ $json.x }}", gio: "8" });
    fireEvent.click(tid(container, "mcp-doi-so-bo-0"));
    expect(doi).toHaveBeenLastCalledWith("thamSo", { gio: "8" });
    const nhieu = Object.fromEntries(Array.from({ length: TRAN_DOI_SO_FORM_MCP }, (_, i) => [`k${i}`, "v"]));
    rerender(<FormMcp node={nut({})} p={{ thamSo: nhieu }} doi={doi} onDoi={vi.fn()} biMat={[]} />);
    expect((tid(container, "mcp-them-doi-so") as HTMLButtonElement).disabled).toBe(true);
  });

  it("chọn bí mật ⇒ onDoi đặt credentialRef + kieuXacThuc bearer; bỏ chọn ⇒ gỡ cả hai; ô kiểu chỉ hiện khi có bí mật", () => {
    const onDoi = vi.fn();
    const { container, rerender } = render(<FormMcp node={nut({ server: "a", tool: "b" })} p={{ server: "a", tool: "b" }} doi={vi.fn()} onDoi={onDoi} biMat={[{ id: "tok", ten: "Token MCP" }]} />);
    expect(tid(container, "mcp-kieu-xac-thuc")).toBeNull();
    fireEvent.change(tid(container, "mcp-bi-mat"), { target: { value: "tok" } });
    expect(onDoi).toHaveBeenLastCalledWith(expect.objectContaining({ credentialRef: "tok", parameters: { server: "a", tool: "b", kieuXacThuc: "bearer" } }));
    rerender(<FormMcp node={nut({ server: "a", tool: "b", kieuXacThuc: "bearer" }, { credentialRef: "tok" })} p={{ server: "a", tool: "b", kieuXacThuc: "bearer" }} doi={vi.fn()} onDoi={onDoi} biMat={[{ id: "tok", ten: "Token MCP" }]} />);
    expect(tid(container, "mcp-kieu-xac-thuc")).not.toBeNull();
    fireEvent.change(tid(container, "mcp-bi-mat"), { target: { value: "" } });
    expect(onDoi).toHaveBeenLastCalledWith(expect.objectContaining({ credentialRef: undefined, parameters: { server: "a", tool: "b" } }));
  });
});
