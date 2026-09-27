/**
 * doc 80 Đợt 1 Task 5 — fix round 1 (#1): DUYỆT PHIÊN BẢN KHÔNG CÒN ĐỌC-SỬA-GHI KHÔNG KHOÁ.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * CSDL THẬT (`_test`, ép bởi vitest.setup) — tranh chấp chỉ tái hiện được trên Postgres thật
 * (khoá hàng khi UPDATE, WHERE đánh giá lại sau khi lượt đầu commit). Khuôn: *.dot0.db.test.ts.
 *
 * Lỗ đo được ở bản đầu (edc93a581):
 *   • reviewArtifact đọc hàng rồi UPDATE VÔ ĐIỀU KIỆN ⇒ hai người duyệt song song đều "thắng",
 *     lượt sau lật quyết định four-eyes của lượt trước; một phiên bản ĐÃ TỪ CHỐI vẫn duyệt được.
 *   • requestVersionReview / validateArtifact ghi LẠI CẢ diagnosticsJson từ bản đọc cũ ⇒ một lượt
 *     validate (await adapter.validate giữa đọc và ghi) xoá mất lý do từ chối vừa ghi.
 * Sau vá: UPDATE … WHERE reviewStatus='pending_review' RETURNING (0 hàng ⇒ PRECONDITION_FAILED
 * versionReviewNotPending) + gộp khoá `review`/`diagnostics` TRONG SQL (`||` jsonb).
 * ══════════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { programProjects, programArtifacts } from "../../../drizzle/schema";
import {
  StubProgrammingAdapter,
  registerProgrammingAdapter,
  type Diagnostics,
  type ProgramSource,
} from "./programmingAdapter";
import { reviewArtifact, requestVersionReview, validateArtifact } from "./programmingService";
import { readAppErrorMeta } from "../../_core/appError";

const DB_URL = process.env.DATABASE_URL;
const DAU = `T5REV-${Date.now().toString(36)}`;

const AUTHOR = { id: 990_500_001, role: "engineer" };
const REV_A = { id: 990_500_002, role: "supervisor" };
const REV_B = { id: 990_500_003, role: "supervisor" };

/**
 * Adapter validate CHẶN được: validate() đợi một cổng do test mở ⇒ ép đúng khe "đọc hàng … await
 * adapter.validate … ghi hàng" để một lượt từ chối chen vào giữa.
 */
let cong: { mo: () => void; da: Promise<void> } | null = null;
let validateDaBatDau: (() => void) | null = null;
class ValidateChanAdapter extends StubProgrammingAdapter {
  override async validate(src: ProgramSource): Promise<Diagnostics> {
    validateDaBatDau?.();
    if (cong) await cong.da;
    return super.validate(src);
  }
}

const artIds: number[] = [];
let projectId = 0;

async function d() {
  const x = await getDb();
  if (!x) throw new Error("no db");
  return x;
}

async function taoPhienBan(kind: "stub" | "gcode" = "stub"): Promise<number> {
  const [a] = await (await d())
    .insert(programArtifacts)
    .values({ projectId, kind, language: "text", content: "A\nB", version: artIds.length + 1, createdBy: AUTHOR.id })
    .returning();
  artIds.push(a!.id);
  return a!.id;
}

async function hang(id: number) {
  const [r] = await (await d()).select().from(programArtifacts).where(eq(programArtifacts.id, id)).limit(1);
  return r!;
}

async function ketQua<T>(p: Promise<T>): Promise<{ ok: T | null; loi: unknown }> {
  try {
    return { ok: await p, loi: null };
  } catch (e) {
    return { ok: null, loi: e };
  }
}

const laChuaCho = (e: unknown) => {
  const m = readAppErrorMeta(e);
  return (e as { code?: string })?.code === "PRECONDITION_FAILED" && m?.appParams?.reason === "versionReviewNotPending";
};

describe.skipIf(!DB_URL)("fix round 1 #1 — duyệt phiên bản: ghi có điều kiện + gộp jsonb trong SQL (DB thật)", () => {
  beforeAll(async () => {
    registerProgrammingAdapter("gcode", () => new ValidateChanAdapter());
    const [p] = await (await d())
      .insert(programProjects)
      .values({ code: `${DAU}-P`, name: DAU, kind: "stub" })
      .returning();
    projectId = p!.id;
  }, 60_000);

  afterAll(async () => {
    const x = await d();
    if (artIds.length) await x.delete(programArtifacts).where(inArray(programArtifacts.id, artIds));
    await x.delete(programProjects).where(like(programProjects.code, `${DAU}%`));
  }, 60_000);

  it("người KHÁC tác giả duyệt ⇒ approved + reviewedBy; từ chối lưu lý do ĐỌC LẠI ĐƯỢC từ CSDL", async () => {
    const a1 = await taoPhienBan();
    const r1 = await reviewArtifact(a1, "approved", REV_A);
    expect(r1.reviewStatus).toBe("approved");
    expect(r1.reviewedBy).toBe(REV_A.id);

    const a2 = await taoPhienBan();
    await reviewArtifact(a2, "rejected", REV_B, "Thiếu interlock cửa");
    const row = await hang(a2);
    expect(row.reviewStatus).toBe("rejected");
    expect((row.diagnosticsJson as any)?.review).toMatchObject({ decision: "rejected", reason: "Thiếu interlock cửa", reviewedBy: REV_B.id });
  });

  it("★★★ HAI người duyệt SONG SONG (duyệt ∥ từ chối) ⇒ ĐÚNG một thắng, một PRECONDITION_FAILED versionReviewNotPending; hàng khớp người thắng", async () => {
    for (let lap = 0; lap < 5; lap++) {
      const id = await taoPhienBan();
      const [x, y] = await Promise.all([
        ketQua(reviewArtifact(id, "approved", REV_A)),
        ketQua(reviewArtifact(id, "rejected", REV_B, "Sai tốc độ trục")),
      ]);
      const thang = [x, y].filter((k) => k.ok);
      const thua = [x, y].filter((k) => k.loi);
      expect(thang.length).toBe(1);
      expect(thua.length).toBe(1);
      expect(laChuaCho(thua[0]!.loi)).toBe(true);
      const row = await hang(id);
      const winner = thang[0]!.ok as { reviewStatus: string; reviewedBy: number };
      // Quyết định trên CSDL là của người thắng — không bị lượt thua lật lại.
      expect(row.reviewStatus).toBe(winner.reviewStatus);
      expect(row.reviewedBy).toBe(winner.reviewedBy);
      expect((row.diagnosticsJson as any)?.review?.decision).toBe(winner.reviewStatus);
    }
  });

  it("★★ phiên bản ĐÃ TỪ CHỐI không duyệt lại được (và đã duyệt không từ chối lại được) — PRECONDITION_FAILED, hàng giữ nguyên", async () => {
    const id = await taoPhienBan();
    await reviewArtifact(id, "rejected", REV_A, "Thiếu kiểm vùng an toàn");
    const e = (await ketQua(reviewArtifact(id, "approved", REV_B))).loi;
    expect(laChuaCho(e)).toBe(true);
    const row = await hang(id);
    expect(row.reviewStatus).toBe("rejected");
    expect((row.diagnosticsJson as any)?.review?.reason).toBe("Thiếu kiểm vùng an toàn");

    const id2 = await taoPhienBan();
    await reviewArtifact(id2, "approved", REV_A);
    expect(laChuaCho((await ketQua(reviewArtifact(id2, "rejected", REV_B, "đổi ý"))).loi)).toBe(true);
    expect((await hang(id2)).reviewStatus).toBe("approved");
  });

  it("yêu cầu duyệt ghi người/lúc yêu cầu; sau đó từ chối vẫn GIỮ requestedBy (gộp, không ghi đè); yêu cầu lại ⇒ PRECONDITION_FAILED", async () => {
    const id = await taoPhienBan();
    await requestVersionReview(id, AUTHOR);
    expect((await hang(id)).diagnosticsJson).toMatchObject({ review: { requestedBy: AUTHOR.id } });
    await reviewArtifact(id, "rejected", REV_A, "Cần sửa");
    const row = await hang(id);
    expect((row.diagnosticsJson as any)?.review).toMatchObject({ requestedBy: AUTHOR.id, reason: "Cần sửa", decision: "rejected" });
    expect(laChuaCho((await ketQua(requestVersionReview(id, AUTHOR))).loi)).toBe(true);
  });

  it("★★★ validate CHẠY SONG SONG với một lượt từ chối (từ chối chen vào giữa đọc và ghi của validate) ⇒ lý do từ chối KHÔNG bị xoá", async () => {
    const id = await taoPhienBan("gcode");
    let moCong!: () => void;
    cong = { mo: () => moCong(), da: new Promise<void>((r) => { moCong = r; }) };
    const daBatDau = new Promise<void>((r) => { validateDaBatDau = r; });
    try {
      const pValidate = validateArtifact(id); // đọc hàng rồi kẹt trong adapter.validate
      await daBatDau;
      await reviewArtifact(id, "rejected", REV_A, "Lý do phải sống sót");
      cong.mo();
      const v = await pValidate;
      expect(v.ok).toBe(true);
    } finally {
      cong = null;
      validateDaBatDau = null;
    }
    const row = await hang(id);
    expect(row.reviewStatus).toBe("rejected");
    expect((row.diagnosticsJson as any)?.review?.reason).toBe("Lý do phải sống sót");
    // validate vẫn ghi phần của nó (khoá diagnostics), không đụng khoá review.
    expect(Array.isArray((row.diagnosticsJson as any)?.diagnostics)).toBe(true);
    expect(row.status).toBe("validated");
  });
});
