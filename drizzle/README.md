# Migrations — ordering, apply-state, and the vestigial `_journal.json`

_(Doc 27 §8 gap B10 verification — W4-D, 2026-07-04.)_

## TL;DR — what is authoritative

| Concern | Authoritative source |
|---|---|
| **Which migrations run, and in what order** | `scripts/migrate-standalone.mjs` (`npm run db:push`): every `drizzle/*.sql`, **sorted alphabetically by full filename** |
| **Which migrations are applied on a DB** | `__applied_migrations` table (written by migrate-standalone, keyed by full filename); verify with `node scripts/check-applied-migrations.mjs` |
| `drizzle/meta/_journal.json` | **VESTIGIAL** — frozen at idx 0–17 (18 entries) from the early drizzle-kit era. It is *not* the apply-state and *not* the ordering source. Do **not** "fix" it by renumbering: the files it names are applied on live DBs under their current names. |

## The duplicate-numbered series (gap B10)

Two pre-merge branches both generated `0000`–`0017`, so **every number 0000–0017
exists twice** (e.g. `0000_volatile_zaladane.sql` + `0000_workable_firelord.sql`).
Later hand-written files added four more duplicate numbers: `0077`, `0091`,
`0100`, `0111` (e.g. `0111_b7_segmentation.sql` + `0111_qw3_materialized_views.sql`).

This is **safe under the standalone runner** because:

1. It tracks by **full filename**, not by number — both twins of a pair run and
   are recorded independently; re-provisioning skips exactly what was applied.
2. Ordering within a duplicate number is alphabetical by the slug (e.g.
   `0000_volatile_zaladane` runs **after** `0000_workable_firelord`). That
   order has been the de-facto order on every environment provisioned to date,
   so it must not be changed.
3. `_journal.json` contains exactly one member of each 0000–0017 pair (the
   `volatile_zaladane … volatile_bug` series). The other series and everything
   ≥ 0018 were never journaled.

**Renumbering was evaluated and rejected** (doc 27 B10 "fix journal ONLY if
provably safe"): renaming any applied file would desynchronize
`__applied_migrations` on every existing DB (the runner would re-run applied
DDL under the new name), and appending ~180 entries to the journal would only
matter to tools we do not use for applying (see below).

## Rules going forward

- **New migration**: add `drizzle/<next-number>_<slug>.sql` where
  `<next-number>` = highest existing number + 1 (currently 0183+). Never reuse
  a number; the alphabetical sort is only stable when numbers are unique.
- **Do not** run `drizzle-kit generate` for schema changes without checking the
  numbering: it would continue from the journal's idx 17 and collide with the
  existing 0018+ files. Hand-write the SQL (the established practice here).
- **Do not** use `drizzle-orm`'s `migrate()` against `./drizzle`
  (`migrate-permissions.mjs` at the repo root still does — legacy, superseded
  by `npm run db:push`; it would only apply the 18 journaled files and tracks
  state in a different table, `drizzle.__drizzle_migrations`).
- **Apply**: `npm run db:push` (add `--strict` in CI to fail fast).
- **Verify**: `node scripts/check-applied-migrations.mjs [--from 0141]`.
