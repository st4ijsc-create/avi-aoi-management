using Xunit;

namespace St4i.EngineApi.Tests.Licensing;

/// <summary>
/// 🔴 WS-E — <b>the scanner's own tests, because a scanner nobody has attacked is a scanner nobody should
/// trust.</b> <see cref="CSharpSourceScan"/> is what makes <see cref="PolicyRuleArrayPinTests"/>'s source
/// leg an instrument rather than a substring search, and this programme's most repeated tooling defect is
/// reading source text without parsing it — three times in one session, most recently a <c>//</c> inside
/// a URL string hiding a declaration from its own census.
///
/// <para>Every case below is a deception a naive <c>Contains</c> would fall for, in both directions: text
/// that LOOKS like code but is not (must be ignored), and code that a careless stripper would swallow
/// along with the comment or string next to it (must survive).</para>
/// </summary>
public sealed class CSharpSourceScanTests
{
    /// <summary>An identifier inside a line comment is not code.</summary>
    [Fact]
    public void An_identifier_inside_a_line_comment_is_not_found()
    {
        Assert.Empty(CSharpSourceScan.FindIdentifierLines("// IPolicyRule here\nint x = 1;", "IPolicyRule"));
    }

    /// <summary>An identifier inside a block or doc comment is not code.</summary>
    [Fact]
    public void An_identifier_inside_a_block_or_doc_comment_is_not_found()
    {
        Assert.Empty(CSharpSourceScan.FindIdentifierLines("/* IPolicyRule */ int x = 1;", "IPolicyRule"));
        Assert.Empty(CSharpSourceScan.FindIdentifierLines("/// <see cref=\"IPolicyRule\"/>\nint x = 1;", "IPolicyRule"));
    }

    /// <summary>An identifier inside a string literal is not code — regular, verbatim, interpolated and
    /// raw alike.</summary>
    [Fact]
    public void An_identifier_inside_any_kind_of_string_literal_is_not_found()
    {
        Assert.Empty(CSharpSourceScan.FindIdentifierLines("var s = \"IPolicyRule\";", "IPolicyRule"));
        Assert.Empty(CSharpSourceScan.FindIdentifierLines("var s = @\"IPolicyRule\";", "IPolicyRule"));
        Assert.Empty(CSharpSourceScan.FindIdentifierLines("var s = $\"x {1} IPolicyRule\";", "IPolicyRule"));
        Assert.Empty(CSharpSourceScan.FindIdentifierLines("var s = \"\"\"\nIPolicyRule\n\"\"\";", "IPolicyRule"));
    }

    /// <summary>
    /// 🔴 <b>THE EXACT DEFECT THAT BURNED THIS PROGRAMME:</b> a <c>//</c> inside a string literal must not
    /// be mistaken for the start of a comment, or everything after it on the line — including a real
    /// declaration — becomes invisible to the census.
    /// </summary>
    [Fact]
    public void A_double_slash_inside_a_string_does_not_swallow_the_rest_of_the_line()
    {
        const string source = "var url = \"https://example.test/x\"; class IPolicyRule { }";
        Assert.NotEmpty(CSharpSourceScan.FindIdentifierLines(source, "IPolicyRule"));
    }

    /// <summary>A quote inside a line comment must not open a string that then swallows real code.</summary>
    [Fact]
    public void An_unbalanced_quote_inside_a_comment_does_not_swallow_the_next_line()
    {
        const string source = "// it's a comment with one quote \"\nclass IPolicyRule { }";
        Assert.NotEmpty(CSharpSourceScan.FindIdentifierLines(source, "IPolicyRule"));
    }

    /// <summary>An escaped quote must not terminate a string early, leaving its tail scanned as code.</summary>
    [Fact]
    public void An_escaped_quote_does_not_end_a_string_early()
    {
        Assert.Empty(CSharpSourceScan.FindIdentifierLines("var s = \"a\\\" IPolicyRule\";", "IPolicyRule"));
    }

    /// <summary>A doubled quote inside a verbatim string is an escape, not a terminator.</summary>
    [Fact]
    public void A_doubled_quote_inside_a_verbatim_string_is_an_escape()
    {
        Assert.Empty(CSharpSourceScan.FindIdentifierLines("var s = @\"a\"\" IPolicyRule\";", "IPolicyRule"));
    }

    /// <summary>🔴 The POSITIVE control. Everything above asserts something is NOT found, which is the
    /// shape that passes when the scanner returns nothing at all. This proves it finds real code.</summary>
    [Fact]
    public void Real_code_is_found_and_reports_its_line()
    {
        const string source = "using X;\n\nclass Foo : IPolicyRule\n{\n}\n";
        Assert.Equal([3], CSharpSourceScan.FindIdentifierLines(source, "IPolicyRule"));
    }

    /// <summary>🔴 The complementary control: the match is a whole TOKEN, so a longer identifier
    /// containing the name is not a hit and a census cannot be fooled by a near-miss.</summary>
    [Fact]
    public void A_longer_identifier_containing_the_name_is_not_a_match()
    {
        Assert.Empty(CSharpSourceScan.FindIdentifierLines("class X : IPolicyRuleFactory { }", "IPolicyRule"));
        Assert.Empty(CSharpSourceScan.FindIdentifierLines("class X : MyIPolicyRule { }", "IPolicyRule"));
    }

    /// <summary>Stripping preserves offsets and newlines, so reported line numbers are the file's own.</summary>
    [Fact]
    public void Stripping_preserves_length_and_line_structure()
    {
        const string source = "// comment\nvar s = \"abc\";\n/* block */ int x;\n";
        var stripped = CSharpSourceScan.StripCommentsAndStrings(source);

        Assert.Equal(source.Length, stripped.Length);
        Assert.Equal(source.Count(c => c == '\n'), stripped.Count(c => c == '\n'));
        Assert.Contains("int x;", stripped, StringComparison.Ordinal);
        Assert.DoesNotContain("abc", stripped, StringComparison.Ordinal);
        Assert.DoesNotContain("comment", stripped, StringComparison.Ordinal);
    }
}
