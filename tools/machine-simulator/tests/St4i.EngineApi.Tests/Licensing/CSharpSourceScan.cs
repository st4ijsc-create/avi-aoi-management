using System.Text;

namespace St4i.EngineApi.Tests.Licensing;

/// <summary>
/// 🔴 WS-E — a small C# LEXER for the source-scanning tests in this namespace, written because
/// <b>reading source text without parsing it is this programme's most repeated tooling defect</b>: three
/// times in one session, most recently a <c>//</c> inside a URL string literal hiding a declaration from
/// its own census.
///
/// <para><b>What it does and what it deliberately does not.</b> It removes exactly the two things that
/// make a naive text scan lie — COMMENTS (line, block and doc) and STRING LITERALS (regular, verbatim,
/// interpolated and raw) — replacing each with whitespace so every surviving token keeps its original
/// offset and line. It is not a full C# parser and does not pretend to be: it produces a text in which
/// the only remaining occurrences of an identifier are occurrences in CODE, which is precisely the
/// question these tests ask.</para>
///
/// <para><b>Why not Roslyn.</b> A full syntax tree would be the better instrument, and adding
/// <c>Microsoft.CodeAnalysis.CSharp</c> would give one. It is not worth a new package dependency in a
/// test project that is asserting about the trust root of the revenue mechanism, and this lexer is small
/// enough to be read in full and is itself tested — <c>CSharpSourceScanTests</c> feeds it the exact
/// deceptions that have burned this programme before (a keyword inside a comment, a <c>//</c> inside a
/// string, a declaration inside a verbatim string) and requires it to see through each one. A scanner
/// nobody has attacked is a scanner nobody should trust.</para>
/// </summary>
internal static class CSharpSourceScan
{
    /// <summary>
    /// Returns <paramref name="source"/> with every comment and string literal replaced by spaces (and
    /// newlines preserved), so a subsequent search finds only occurrences in real code.
    /// </summary>
    /// <param name="source">C# source text.</param>
    /// <returns>The blanked text, the same length as the input.</returns>
    public static string StripCommentsAndStrings(string source)
    {
        ArgumentNullException.ThrowIfNull(source);

        var output = new StringBuilder(source.Length);
        var i = 0;

        void Blank(int from, int to)
        {
            for (var k = from; k < to; k++) output.Append(source[k] == '\n' ? '\n' : ' ');
        }

        while (i < source.Length)
        {
            var c = source[i];

            // ── Line comment ──
            if (c == '/' && i + 1 < source.Length && source[i + 1] == '/')
            {
                var start = i;
                while (i < source.Length && source[i] != '\n') i++;
                Blank(start, i);
                continue;
            }

            // ── Block comment ──
            if (c == '/' && i + 1 < source.Length && source[i + 1] == '*')
            {
                var start = i;
                i += 2;
                while (i + 1 < source.Length && !(source[i] == '*' && source[i + 1] == '/')) i++;
                i = Math.Min(source.Length, i + 2);
                Blank(start, i);
                continue;
            }

            // ── Raw string literal (""" ... """), including interpolated ($"""), any fence length ──
            if (c == '"' && i + 2 < source.Length && source[i + 1] == '"' && source[i + 2] == '"')
            {
                var start = i;
                var fence = 0;
                while (i < source.Length && source[i] == '"') { fence++; i++; }

                while (i < source.Length)
                {
                    if (source[i] == '"')
                    {
                        var run = 0;
                        var runStart = i;
                        while (i < source.Length && source[i] == '"') { run++; i++; }
                        if (run >= fence) break;
                        _ = runStart;
                        continue;
                    }

                    i++;
                }

                Blank(start, i);
                continue;
            }

            // ── Verbatim string (@"..."), where "" is an escaped quote ──
            if (c == '@' && i + 1 < source.Length && source[i + 1] == '"')
            {
                var start = i;
                i += 2;
                while (i < source.Length)
                {
                    if (source[i] == '"')
                    {
                        if (i + 1 < source.Length && source[i + 1] == '"') { i += 2; continue; }
                        i++;
                        break;
                    }

                    i++;
                }

                Blank(start, i);
                continue;
            }

            // ── Regular string ("..."), backslash-escaped ──
            if (c == '"')
            {
                var start = i;
                i++;
                while (i < source.Length)
                {
                    if (source[i] == '\\') { i += 2; continue; }
                    if (source[i] == '"') { i++; break; }
                    if (source[i] == '\n') break; // unterminated; do not run away
                    i++;
                }

                Blank(start, i);
                continue;
            }

            // ── Character literal ('x', '\n', '\'') ──
            if (c == '\'')
            {
                var start = i;
                i++;
                while (i < source.Length)
                {
                    if (source[i] == '\\') { i += 2; continue; }
                    if (source[i] == '\'') { i++; break; }
                    if (source[i] == '\n') break;
                    i++;
                }

                Blank(start, i);
                continue;
            }

            output.Append(c);
            i++;
        }

        return output.ToString();
    }

    /// <summary>
    /// Finds occurrences of <paramref name="identifier"/> in CODE only, as a whole token — so
    /// <c>LicenseRule</c> does not match <c>MyLicenseRuleFactory</c>, and neither matches inside a comment
    /// or a string.
    /// </summary>
    /// <param name="source">C# source text.</param>
    /// <param name="identifier">The identifier to find.</param>
    /// <returns>The 1-based line numbers of each occurrence.</returns>
    public static IReadOnlyList<int> FindIdentifierLines(string source, string identifier)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(identifier);

        var code = StripCommentsAndStrings(source);
        var hits = new List<int>();
        var line = 1;

        for (var i = 0; i < code.Length; i++)
        {
            if (code[i] == '\n') { line++; continue; }
            if (code[i] != identifier[0]) continue;
            if (i + identifier.Length > code.Length) continue;
            if (string.CompareOrdinal(code, i, identifier, 0, identifier.Length) != 0) continue;

            var before = i == 0 ? ' ' : code[i - 1];
            var afterIndex = i + identifier.Length;
            var after = afterIndex >= code.Length ? ' ' : code[afterIndex];
            if (IsIdentifierChar(before) || IsIdentifierChar(after)) continue;

            hits.Add(line);
        }

        return hits;
    }

    private static bool IsIdentifierChar(char c) => char.IsLetterOrDigit(c) || c == '_';
}
