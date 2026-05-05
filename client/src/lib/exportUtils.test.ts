// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { exportChartToPNG, exportToCSV, exportToJSON } from "./exportUtils";

vi.mock("html2canvas", () => {
  return {
    default: vi.fn().mockResolvedValue({
      toDataURL: () => "data:image/png;base64,AAA",
    }),
  };
});

describe("exportUtils", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should export CSV and preserve content", async () => {
    let csvBlob: Blob | null = null;
    const createObjectUrlSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockImplementation((blob: Blob | MediaSource) => {
        csvBlob = blob as Blob;
        return "blob:csv";
      });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    exportToCSV(
      [
        { date: "2026-05-01", total: 10, defectRate: 1.2 },
        { date: "2026-05-02", total: 12, defectRate: 0.9 },
      ],
      "trend.csv"
    );

    expect(createObjectUrlSpy).toHaveBeenCalled();
    expect(csvBlob).not.toBeNull();
    const content = await csvBlob!.text();
    expect(content).toContain("date,total,defectRate");
    expect(content).toContain("2026-05-01,10,1.2");
  });

  it("should export JSON and preserve content", async () => {
    let jsonBlob: Blob | null = null;
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob: Blob | MediaSource) => {
      jsonBlob = blob as Blob;
      return "blob:json";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    exportToJSON({ rows: [{ id: 1, yieldRate: 98.5 }] }, "trend.json");

    expect(jsonBlob).not.toBeNull();
    const content = await jsonBlob!.text();
    expect(content).toContain("\"yieldRate\": 98.5");
  });

  it("should export chart card to PNG", async () => {
    const container = document.createElement("div");
    container.id = "chart-export-node";
    document.body.appendChild(container);

    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    await exportChartToPNG("chart-export-node", "trend.png");

    expect(clickSpy).toHaveBeenCalled();
  });
});
