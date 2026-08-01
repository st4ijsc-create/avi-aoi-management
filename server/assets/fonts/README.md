# Server PDF fonts

Fonts embedded into server-rendered PDFs (jsPDF via `universalExportService`,
PDFKit via `pdfTemplateService`). The PDF cores (Helvetica/WinAnsi) drop
Vietnamese diacritics and have no CJK glyphs, so without embedded fonts the PDF
renders VN as mojibake and Chinese as tofu (□).

## Fonts

| File | Weight | Covers | Used by |
|---|---|---|---|
| `BeVietnamPro-Regular.ttf` | 400 | Latin + full Vietnamese | body / PDFKit default |
| `BeVietnamPro-Bold.ttf` | 700 | Latin + full Vietnamese | table headers / bold |
| `NotoSansSC-Regular.ttf` | 400 | CJK ideographs (+ Latin) | Chinese runs (doc 48 R4) |
| `NotoSansSC-Bold.ttf` | 700 | CJK ideographs (+ Latin) | Chinese bold runs |

**Be Vietnam Pro** — SIL OFL 1.1 (`OFL.txt`). Vietnamese foundry, complete VN
coverage.

**Noto Sans SC** — SIL OFL 1.1 (`NotoSansSC-OFL.txt`). Added in doc 48 R4 because
Be Vietnam Pro has no CJK glyphs, so Chinese (zh) exports were all tofu. These
are the **static, Regular/Bold, glyf-outline** builds (from the
`@expo-google-fonts/noto-sans-sc` package). We need static glyf TTFs because:

- the Google Fonts `NotoSansSC[wght].ttf` is a **variable** font whose default
  master is Thin (wght 100) — jsPDF embeds the default outlines, so text would be
  hairline-faint at report sizes;
- the OTF/CFF Noto CJK builds use CFF outlines that **jsPDF cannot embed** (its
  TTF embedder only understands `glyf`).

The font family names are `BeVietnamPro` and `NotoSansSC`
(`server/services/fontAssets.ts`). Chinese is detected per text run
(`containsCjk`) and the CJK font is swapped in only where CJK codepoints appear —
so vi/en PDFs are byte-for-byte unchanged (no CJK-font bloat), and jsPDF/PDFKit
subset the embedded CJK glyphs (a typical zh PDF carries ~0.5 MB, not 10 MB).

The VN loader **fails loudly** if Be Vietnam Pro is absent. The zh render path
fails loudly if Noto Sans SC is absent — it will not silently fall back to a font
that would mojibake / tofu.

## Size note (Noto Sans SC is large: ~10 MB/weight, ~20 MB total)

The two `NotoSansSC-*.ttf` files are large. `scripts/fetch-fonts.mjs` downloads
them on demand rather than assuming raw git blobs. If you want them in-repo,
prefer **Git LFS**. Deployments must ship `server/assets/fonts/**` alongside the
esbuild bundle (which does not copy it), or point `FONT_ASSETS_DIR` at it.

## If the fonts are missing

```
node scripts/fetch-fonts.mjs
```

Downloads Be Vietnam Pro (Regular/Bold) + Noto Sans SC (Regular/Bold) + both OFL
licenses, and validates the TrueType signature. Idempotent.
