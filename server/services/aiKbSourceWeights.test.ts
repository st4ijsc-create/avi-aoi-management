/**
 * G4-B — canh BẢNG TRỌNG SỐ HẠNG NGUỒN.
 *
 * ⚠ Ca quan trọng nhất ở đây không phải "1,15 có bằng 1,15 không" (tầm thường, xanh dưới mọi đột
 * biến) mà là các bất đẳng thức **THỨ HẠNG GIỮA CÁC HẠNG**: đó là thứ G4-B sửa, và là thứ sẽ hỏng
 * nếu ai đó thêm một hạng mới rồi quên xếp chỗ cho nó.
 */
import { describe, it, expect } from "vitest";
import {
  SOURCE_TYPE_WEIGHTS,
  DEFAULT_TYPE_WEIGHT,
  DEV_JOURNAL_WEIGHT,
  DEV_JOURNAL_PATH_RE,
  sourceTypeWeight,
  sourceLanguageWeight,
  devJournalWeight,
  sourceWeight,
} from "./aiKbSourceWeights";

describe("aiKbSourceWeights — thứ hạng giữa các hạng nguồn", () => {
  it("nội dung do NGƯỜI viết (playbook/feature/operational/domain) đều đứng TRÊN mặc định", () => {
    for (const t of ["playbook", "feature", "operational", "domain"]) {
      expect(sourceTypeWeight(t)).toBeGreaterThan(DEFAULT_TYPE_WEIGHT);
    }
  });

  it("★ hồi quy G4-B: `operational` KHÔNG còn rơi về mặc định 1,00", () => {
    // Lỗi gốc: "operational" vắng mặt khỏi bảng ⇒ 162 thẻ vận hành bị xếp NGANG
    // 2.428 chunk mã nguồn, và THẤP HƠN cả `domain` lẫn `feature`.
    expect(SOURCE_TYPE_WEIGHTS.operational).toBeDefined();
    expect(sourceTypeWeight("operational")).toBeGreaterThan(sourceTypeWeight("domain"));
    expect(sourceTypeWeight("operational")).not.toBe(DEFAULT_TYPE_WEIGHT);
  });

  it("★ hồi quy G4-B: `playbook` có mặt trong bảng và đứng trên mặc định", () => {
    // ⚠ CỐ Ý KHÔNG khẳng định "playbook là cao nhất". Bản nháp đầu của file này đặt playbook=1,30
    // (cao nhất) vì nó "đáng lẽ" phải thế; lượt quét ba-bộ-ca BÁC BỎ: ở 1,30 bộ playbook chỉ thêm
    // +0,05 P@5 trên 8 ca còn bộ vận hành mất −0,015 P@5 / −0,048 MRR trên 54 ca. Ca này canh cái
    // ĐÃ ĐO (có mặt + trên mặc định), không canh thứ bậc do tôi mong muốn.
    expect(SOURCE_TYPE_WEIGHTS.playbook).toBeDefined();
    expect(sourceTypeWeight("playbook")).toBeGreaterThan(DEFAULT_TYPE_WEIGHT);
    expect(sourceTypeWeight("playbook")).toBeGreaterThan(sourceTypeWeight("doc"));
  });

  it("tài liệu dev thô (`doc`) đứng DƯỚI mặc định và dưới mọi hạng do người viết", () => {
    expect(sourceTypeWeight("doc")).toBeLessThan(DEFAULT_TYPE_WEIGHT);
    for (const t of ["playbook", "feature", "operational", "domain"]) {
      expect(sourceTypeWeight("doc")).toBeLessThan(sourceTypeWeight(t));
    }
  });

  it("hạng lạ (mã nguồn, schema…) rơi về mặc định — không ném", () => {
    expect(sourceTypeWeight("service")).toBe(DEFAULT_TYPE_WEIGHT);
    expect(sourceTypeWeight("hang-chua-ton-tai")).toBe(DEFAULT_TYPE_WEIGHT);
  });
});

describe("aiKbSourceWeights — nhật ký phiên agent / thiết kế nội bộ", () => {
  it("★★ ĐO XONG RỒI BÁC BỎ: hệ số ở mức KHÔNG HẠ (1,0)", () => {
    // Đây là ca ghi lại một kết luận ĐO ĐƯỢC, không phải một sở thích: hạ nhật ký dev đổi được
    // +0,004 P@5 trên bộ vận hành (mức nhiễu) nhưng ở 0,55 thì bộ kiến trúc về 0,000 — 0/10 ca
    // còn tìm được tài liệu đúng. Ai muốn bật lại phải chạy `--sweep` trên CẢ BA bộ ca trước,
    // và ca này sẽ đỏ để bắt họ đọc đoạn chú thích trong aiKbSourceWeights.ts.
    expect(DEV_JOURNAL_WEIGHT).toBe(1.0);
  });

  it("chỉ `docs/superpowers/**` và `docs/ECOSYSTEM/**` đi qua nhánh nhật ký dev", () => {
    expect(devJournalWeight("docs/superpowers/reports/x.md")).toBe(DEV_JOURNAL_WEIGHT);
    expect(devJournalWeight("docs/ECOSYSTEM/52_P0_MACHINE_AUTH_ROTATION_RUNBOOK.md")).toBe(
      DEV_JOURNAL_WEIGHT,
    );
    // KHÔNG được chạm tới tài liệu người dùng / API / kho tri thức.
    expect(devJournalWeight("docs/USER_GUIDE.md")).toBe(1);
    expect(devJournalWeight("apidocs/MACHINE_API.md")).toBe(1);
    expect(devJournalWeight("knowledge/operational/andon.md")).toBe(1);
    expect(devJournalWeight("knowledge/workflows/ng-handling.playbook.yaml")).toBe(1);
  });

  it("khớp cả khi đường dẫn mang dấu ngược của Windows", () => {
    expect(devJournalWeight("docs\\superpowers\\reports\\x.md")).toBe(DEV_JOURNAL_WEIGHT);
  });

  it("neo: chỉ khớp ở ĐẦU đường dẫn — không phải chuỗi con ở giữa", () => {
    // Một file tên `.../my-docs/ECOSYSTEM-notes.md` KHÔNG phải nhật ký nội bộ.
    expect(DEV_JOURNAL_PATH_RE.test("vendor/docs/ECOSYSTEM/x.md")).toBe(false);
    expect(devJournalWeight("vendor/docs/ECOSYSTEM/x.md")).toBe(1);
  });

  it("nếu có ngày bật lại: hạ — KHÔNG phải xoá (phải còn dương)", () => {
    expect(DEV_JOURNAL_WEIGHT).toBeGreaterThan(0);
    expect(DEV_JOURNAL_WEIGHT).toBeLessThanOrEqual(1);
  });
});

describe("aiKbSourceWeights — trọng số ngôn ngữ (giữ nguyên hành vi Cycle-3/4)", () => {
  it("báo cáo audit ồn bị hạ mạnh bất kể ngôn ngữ", () => {
    expect(sourceLanguageWeight("docs/I18N_AUDIT_REPORT.md", "vi")).toBe(0.55);
    expect(sourceLanguageWeight("docs/I18N_AUDIT_REPORT.md", "en")).toBe(0.55);
  });

  it("câu hỏi tiếng Việt nâng nguồn VN, hạ nguồn nặng tiếng Anh", () => {
    expect(sourceLanguageWeight("docs/HUONG_DAN_SU_DUNG.md", "vi")).toBe(1.08);
    expect(sourceLanguageWeight("docs/CSHARP_CLIENT_UPLOAD_GUIDE.md", "vi")).toBe(0.92);
  });

  it("zh đi theo nhánh EN (kho không có tiếng Trung riêng)", () => {
    expect(sourceLanguageWeight("docs/CSHARP_CLIENT_UPLOAD_GUIDE.md", "zh")).toBe(
      sourceLanguageWeight("docs/CSHARP_CLIENT_UPLOAD_GUIDE.md", "en"),
    );
  });
});

describe("aiKbSourceWeights — sourceWeight tổng hợp", () => {
  it("★ thẻ vận hành xếp TRÊN nhật ký phiên agent cho cùng một điểm cosine", () => {
    const ops = sourceWeight("knowledge/operational/andon.md", "operational", "vi");
    const journal = sourceWeight("docs/superpowers/reports/2026-08-11-x.md", "doc", "vi");
    expect(ops).toBeGreaterThan(journal);
    // và khoảng cách phải ĐÁNG KỂ, không phải chênh ở chữ số thứ tư.
    expect(ops / journal).toBeGreaterThan(1.25);
  });

  it("★ playbook + thẻ vận hành đều xếp trên tài liệu dev và trên mã nguồn", () => {
    const pb = sourceWeight("knowledge/workflows/ng-burst-response.playbook.yaml", "playbook", "vi");
    const ops = sourceWeight("knowledge/operational/andon.md", "operational", "vi");
    for (const w of [pb, ops]) {
      expect(w).toBeGreaterThan(sourceWeight("docs/ECOSYSTEM/52_P0.md", "doc", "vi"));
      expect(w).toBeGreaterThan(sourceWeight("server/services/x.ts", "service", "vi"));
    }
  });

  it("bộ ghi đè chỉ tác động khi được truyền — sản phẩm gọi không tham số", () => {
    const base = sourceWeight("knowledge/operational/andon.md", "operational", "vi");
    const swept = sourceWeight("knowledge/operational/andon.md", "operational", "vi", {
      types: { operational: 2 },
    });
    expect(swept).toBeCloseTo(2, 10);
    expect(base).not.toBeCloseTo(2, 10);
  });
});
