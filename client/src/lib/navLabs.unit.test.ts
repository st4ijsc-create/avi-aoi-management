/**
 * Doc 81 Đợt 3 Task 5 ([QĐ-3b]) — nhóm "Labs — thử nghiệm" của menu Kỹ thuật: mục `labs: true` ẨN khỏi điều hướng (thanh
 * bên, menu điện thoại) cho tới khi CHÍNH người dùng bật "Hiện Labs"; ⌘K (bộ tìm `getSearchNavGroups`) vẫn tìm thấy; cổng
 * route/quyền/giấy phép KHÔNG đổi (RouteGuard đọc `navGroups` tĩnh, không qua bộ lọc Labs).
 *
 * CENSUS (thiết bị đo): ô `labs` là một cách ẨN mục khỏi menu — một mục khai nhầm sẽ biến mất khỏi menu của MỌI người mà
 * không lỗi nào nổ. Vì thế danh sách mục dùng ô này được GHIM (allowlist); thêm mục Labs mới = sửa danh sách này có chủ đích.
 * Luật:
 *   1. tập mục `labs: true` == LABS_ALLOWLIST;
 *   2. mục Labs nằm ở section `labs` (nhãn "Labs — thử nghiệm") của nhóm có khai section đó, và href bắt đầu `/labs/`;
 *   3. mọi mục ở section `labs` đều khai `labs: true` (không có mục "trong Labs" mà vẫn hiện mặc định).
 */
import { describe, expect, it } from "vitest";
import {
  LABS_SECTION_KEY,
  buildModuleL2,
  filterLabsNavGroups,
  getSearchNavGroups,
  hasLabsContent,
  navGroups,
  type NavGroup,
  type NavItem,
} from "./navigation";

/** Mục được phép dùng ô `labs` (đổi = quyết định có chủ đích, kèm ngày/ghi chú). 2026-10-05 Đợt 3 Task 5: Fleet. */
const LABS_ALLOWLIST = ["/labs/fleet-orchestration"];

type It = Pick<NavItem, "href" | "labs" | "section">;

/** Vi phạm luật 2–3 của một mục trong nhóm `g` (rỗng = hợp lệ). */
function viPham(it: It, g: Pick<NavGroup, "id" | "sections">): string[] {
  const out: string[] = [];
  const groupHasLabs = (g.sections ?? []).some((s) => s.key === LABS_SECTION_KEY);
  if (it.labs === true) {
    if (it.section !== LABS_SECTION_KEY) out.push(`${it.href}: labs nhưng section="${it.section ?? ""}" ≠ "${LABS_SECTION_KEY}"`);
    if (!groupHasLabs) out.push(`${it.href}: labs trong nhóm ${g.id} không khai section "${LABS_SECTION_KEY}"`);
    if (!it.href.startsWith("/labs/")) out.push(`${it.href}: mục Labs phải có href /labs/…`);
  } else if (it.section === LABS_SECTION_KEY) {
    out.push(`${it.href}: nằm ở section Labs mà không khai labs:true (sẽ hiện mặc định)`);
  }
  return out;
}

const ALL = navGroups.flatMap((g) => g.items.map((i) => ({ i, g })));

describe("census — ô `labs` (Đợt 3 Task 5, QĐ-3b)", () => {
  it("tập mục `labs: true` == allowlist", () => {
    expect(ALL.filter(({ i }) => i.labs === true).map(({ i }) => i.href).sort()).toEqual([...LABS_ALLOWLIST].sort());
  });

  it("mục Labs nằm ở section Labs (href /labs/…); mọi mục ở section Labs đều khai labs", () => {
    expect(ALL.flatMap(({ i, g }) => viPham(i, g))).toEqual([]);
  });

  it("section Labs có nhãn i18n nav.section.labs trong nhóm Kỹ thuật", () => {
    const eng = navGroups.find((g) => g.id === "engineering")!;
    expect(eng.sections).toContainEqual({ key: LABS_SECTION_KEY, label: "nav.section.labs" });
  });

  it("cầu chì: vị từ bắt được section sai, nhóm thiếu section, href ngoài /labs/, mục trong Labs không khai; tha mục hợp lệ", () => {
    const eng = { id: "engineering", sections: [{ key: LABS_SECTION_KEY, label: "x" }] };
    expect(viPham({ href: "/labs/x", labs: true, section: "orchestration" }, eng)).toHaveLength(1);
    expect(viPham({ href: "/labs/x", labs: true, section: LABS_SECTION_KEY }, { id: "g", sections: [] })).toHaveLength(1);
    expect(viPham({ href: "/x", labs: true, section: LABS_SECTION_KEY }, eng)).toHaveLength(1);
    expect(viPham({ href: "/labs/x", section: LABS_SECTION_KEY }, eng)).toHaveLength(1);
    expect(viPham({ href: "/labs/x", labs: true, section: LABS_SECTION_KEY }, eng)).toEqual([]);
    expect(viPham({ href: "/x", section: "orchestration" }, eng)).toEqual([]);
  });
});

describe("filterLabsNavGroups — ẩn/hiện Labs (lớp sở thích, sau lọc vai/quyền/giấy phép)", () => {
  const hrefs = (gs: NavGroup[]) => gs.flatMap((g) => g.items.map((i) => i.href));

  it("tắt ⇒ không còn mục Labs nào; mọi mục khác giữ nguyên thứ tự", () => {
    const off = filterLabsNavGroups(navGroups, false);
    expect(hrefs(off).filter((h) => LABS_ALLOWLIST.includes(h))).toEqual([]);
    expect(hrefs(off)).toEqual(hrefs(navGroups).filter((h) => !LABS_ALLOWLIST.includes(h)));
  });

  it("bật ⇒ trả đúng tập vào (không thêm, không bớt)", () => {
    expect(hrefs(filterLabsNavGroups(navGroups, true))).toEqual(hrefs(navGroups));
  });

  it("nhóm chỉ còn mục Labs ⇒ bị bỏ khi tắt", () => {
    const only: NavGroup = { id: "g", label: "g", items: [{ href: "/labs/a", label: "a", icon: null, labs: true, section: LABS_SECTION_KEY }] };
    expect(filterLabsNavGroups([only], false)).toEqual([]);
    expect(filterLabsNavGroups([only], true)).toHaveLength(1);
  });

  it("hasLabsContent: có mục Labs trong tập ⇒ true; đã lọc ⇒ false", () => {
    expect(hasLabsContent(navGroups)).toBe(true);
    expect(hasLabsContent(filterLabsNavGroups(navGroups, false))).toBe(false);
  });

  it("⌘K (bộ tìm) VẪN tìm thấy Fleet: bộ tìm không qua bộ lọc Labs", () => {
    const engineerPerm = (m: string, a: string) => a === "canView" && ["machine_status", "machine_control"].includes(m);
    const search = getSearchNavGroups("engineer", engineerPerm, () => true);
    expect(hrefs(search)).toContain("/labs/fleet-orchestration");
  });
});

describe("nhãn 'Labs — thử nghiệm' luôn hiện trên menu (kể cả khi Labs chỉ có 1 mục)", () => {
  it("buildModuleL2: section Labs 1 mục vẫn là category có nhãn (không bị làm phẳng thành link như section 1 mục khác)", () => {
    const eng = navGroups.find((g) => g.id === "engineering")!;
    const labs = buildModuleL2(eng).find((e) => e.kind === "category" && e.key === LABS_SECTION_KEY);
    expect(labs).toEqual({ kind: "category", key: LABS_SECTION_KEY, label: "nav.section.labs", items: [expect.objectContaining({ href: "/labs/fleet-orchestration" })] });
    // đối chứng: section 1 mục KHÁC vẫn bị làm phẳng như cũ
    const one: NavGroup = { id: "g", label: "g", sections: [{ key: "s", label: "S" }], items: [{ href: "/a", label: "a", icon: null, section: "s" }] };
    expect(buildModuleL2(one)).toEqual([{ kind: "link", item: one.items[0] }]);
  });
});
