/**
 * Pilot "Thợ Cả nhận việc" — DỰNG NGƯỜI DÙNG RIÊNG cho driver `host` trên `_test` (engineer1 không có ở đó; các engineer sót của test khác không dùng).
 *
 *   DATABASE_URL=<aoi_management_test> npx tsx scripts/tho-ca-pilot/dungNguoiPilot.ts [--chi-doc]
 *
 * IDEMPOTENT: user openId `pilot-tho-ca` (username cùng tên, name "Thợ Cả pilot", role engineer, isActive true) + đúng các hàng `permissions` mà driver cần:
 *   • ai_repo_read  canView + canEdit   (đọc repo = quanLyLuotChay/thuTuc*; canEdit = apply_diff qua confirmAction)
 *   • ai_repo_exec  canCreate           (run_command — pilot chỉ cho đúng LỆNH KIỂM, bộ chạy tự lọc phần còn lại)
 *   Không cấp gì khác. (MOD_AI là GIẤY PHÉP module của tRPC; driver chạy trong tiến trình, không đi qua moduleGate nên không có hàng quyền cho nó.)
 * TRƯỚC KHI GHI: khẳng định current_database() = aoi_management_test và current_user ≠ aoi (owner). Không DELETE. In MỘT dòng JSON có `id`
 * (dùng cho `chayMotViec.ts --nguoi-id`). `--chi-doc`: chỉ kiểm + báo user đã có hay chưa, không ghi.
 */
import postgres from "postgres";

export const CSDL_DUOC_GHI = "aoi_management_test";
export const OPEN_ID = "pilot-tho-ca";
export const QUYEN_PILOT: ReadonlyArray<{ moduleName: string; category: string; canView: boolean; canCreate: boolean; canEdit: boolean }> = [
  { moduleName: "ai_repo_read", category: "settings", canView: true, canCreate: false, canEdit: true },
  { moduleName: "ai_repo_exec", category: "settings", canView: false, canCreate: true, canEdit: false },
];

/** Hình tối thiểu của postgres.js mà hàm này dùng (để test bằng bản giả). */
export type Sql = (s: TemplateStringsArray, ...v: unknown[]) => Promise<Array<Record<string, unknown>>>;

export type KetQuaDung = { ok: true; id: number; daCo: boolean; chiDoc: boolean; quyen: string[] } | { ok: false; loi: string };

export async function dungNguoiPilot(sql: Sql, chiDoc: boolean): Promise<KetQuaDung> {
  const [t] = await sql`SELECT current_database() AS db, current_user AS nguoi`;
  if (t?.db !== CSDL_DUOC_GHI) return { ok: false, loi: `current_database() = ${String(t?.db)}; chỉ cho phép ${CSDL_DUOC_GHI}` };
  if (String(t?.nguoi).toLowerCase() === "aoi") return { ok: false, loi: "đang kết nối bằng owner `aoi` — không được ghi bằng owner (dùng vai ứng dụng)" };

  const [cu] = await sql`SELECT id FROM users WHERE "openId" = ${OPEN_ID}`;
  if (chiDoc) return { ok: true, id: cu ? Number(cu.id) : 0, daCo: !!cu, chiDoc: true, quyen: [] };

  const [u] = await sql`
    INSERT INTO users ("openId", username, name, role, "isActive")
    VALUES (${OPEN_ID}, ${OPEN_ID}, ${"Thợ Cả pilot"}, 'engineer', true)
    ON CONFLICT ("openId") DO UPDATE SET username = EXCLUDED.username, name = EXCLUDED.name, role = 'engineer', "isActive" = true
    RETURNING id`;
  const id = Number(u.id);
  const quyen: string[] = [];
  for (const q of QUYEN_PILOT) {
    await sql`
      INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete", "canExport", "expiresAt")
      VALUES (${id}, ${q.category}::permissioncategoryenum, ${q.moduleName}, ${q.canView}, ${q.canCreate}, ${q.canEdit}, false, false, NULL)
      ON CONFLICT ("userId", "moduleName") DO UPDATE SET
        category = EXCLUDED.category, "canView" = EXCLUDED."canView", "canCreate" = EXCLUDED."canCreate", "canEdit" = EXCLUDED."canEdit",
        "canDelete" = false, "canExport" = false, "expiresAt" = NULL, "updatedAt" = now()`;
    quyen.push(q.moduleName);
  }
  return { ok: true, id, daCo: !!cu, chiDoc: false, quyen };
}

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write("thiếu DATABASE_URL (phải trỏ aoi_management_test)\n");
    return 2;
  }
  const sql = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    const kq = await dungNguoiPilot(sql as unknown as Sql, process.argv.includes("--chi-doc"));
    process.stdout.write(`${JSON.stringify(kq)}\n`);
    return kq.ok ? 0 : 1;
  } finally {
    await sql.end({ timeout: 2 });
  }
}

if (process.argv[1] && /dungNguoiPilot\.(ts|js)$/.test(process.argv[1])) {
  main().then(
    (ma) => process.exit(ma),
    (e) => {
      process.stderr.write(`✖ ${e instanceof Error ? e.message : String(e)}\n`);
      process.exit(3);
    },
  );
}
