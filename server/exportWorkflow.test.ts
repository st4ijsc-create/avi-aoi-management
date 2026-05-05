import { beforeEach, describe, expect, it, vi } from "vitest";
import { exportChartToPNG, exportToCSV, exportToJSON } from "../client/src/lib/exportUtils";

vi.mock("html2canvas", () => {
  return {
    default: vi.fn().mockResolvedValue({
      toDataURL: () => "data:image/png;base64,AAA",
    }),
  };
});

describe("Export workflow", () => {
  let clickSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.restoreAllMocks();

    clickSpy = vi.fn();
    const elementStore = new Map<string, any>();

    (globalThis as any).document = {
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      },
      getElementById: vi.fn((id: string) => elementStore.get(id) ?? null),
      createElement: vi.fn((tag: string) => {
        if (tag === "a") {
          return {
            href: "",
            download: "",
            click: clickSpy,
          };
        }
        return {};
      }),
    };

    elementStore.set("chart-export-node", { id: "chart-export-node" });

    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });

  it("should export CSV and preserve content", async () => {
    let csvBlob: Blob | null = null;
    const createObjectUrlSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockImplementation((blob: Blob | MediaSource) => {
        csvBlob = blob as Blob;
        return "blob:csv";
      });
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

    exportToJSON({ rows: [{ id: 1, yieldRate: 98.5 }] }, "trend.json");

    expect(jsonBlob).not.toBeNull();
    const content = await jsonBlob!.text();
    expect(content).toContain("\"yieldRate\": 98.5");
  });

  it("should export chart card to PNG", async () => {
    await exportChartToPNG("chart-export-node", "trend.png");

    expect(clickSpy).toHaveBeenCalled();
  });
});
