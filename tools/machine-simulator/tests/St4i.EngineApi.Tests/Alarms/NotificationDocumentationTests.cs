using System.Text.RegularExpressions;
using Xunit;

namespace St4i.EngineApi.Tests.Alarms;

/// <summary>
/// 🔴 Task C-8 (.superpowers/sdd/2026-07-30-dotC-alarm-notification-blueprint/task-8-brief.md) — the
/// census, as a test rather than as a claim in a report.
///
/// <para><b>Why this file exists.</b> Đợt C's closing task had to correct, in one pass, every surface that
/// still said "alarms cannot reach anyone who is not looking at the screen". Two earlier censuses in this
/// project were wrong — one said "six places" when there were fifteen, and missed every operator-facing
/// one — and a census verified by reading is a census that rots on the next edit. These tests re-run the
/// load-bearing part of the sweep on every build.</para>
///
/// <para><b>🔴 The assertion discipline, which took some care here.</b> The corrected README deliberately
/// QUOTES each false claim in order to retire it in place ("this line used to say …"), which is the
/// house style — a claim somebody bookmarked must show the correction, not silently vanish. So a naive
/// substring ban on the false wording would fail against this task's own corrections, and the obvious
/// "fix" — deleting the quotations — would make the document worse. The rule applied instead, per the
/// brief: <b>guard in both directions — narrower than the false claim being forbidden, wider than the
/// exact phrasing that happens to exist today.</b> Concretely, what is banned is the claim in its
/// ASSERTED form (a bolded heading/bullet lead), not its appearance inside a past-tense correction; and
/// what is required is matched by regex, so a future editor may reword these paragraphs freely and only
/// fails here if they remove the FACT.</para>
///
/// <para><b>These tests read files from the repository by walking up from the test binary's own output
/// directory</b> — the technique <c>PackagingFleetJsonTests.MachineSimulatorRoot</c> already established
/// for exactly this reason. It does not depend on the working directory, which is what made C-7 decline
/// to add a doc-drift test of this kind (its §11.2 note 14); the walk-up idiom answers that objection.</para>
/// </summary>
public sealed class NotificationDocumentationTests
{
    private static string MachineSimulatorRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "README.md")) &&
                File.Exists(Path.Combine(dir.FullName, "fleet.json")) &&
                Directory.Exists(Path.Combine(dir.FullName, "docs")))
            {
                return dir.FullName;
            }

            dir = dir.Parent;
        }

        throw new InvalidOperationException(
            "Could not locate tools/machine-simulator (README.md + fleet.json + docs/) by walking up from " +
            $"\"{AppContext.BaseDirectory}\". If the output layout changed, fix this walk — do NOT weaken " +
            "the assertions below to make the file findable.");
    }

    private static string ReadRepoFile(params string[] relative) =>
        File.ReadAllText(Path.Combine(new[] { MachineSimulatorRoot() }.Concat(relative).ToArray()));

    /// <summary>Markdown reflows, so every "is this fact still stated?" match runs against a
    /// single-spaced, newline-free copy. Without this, an editor re-wrapping a paragraph would break a
    /// test about its MEANING, which is exactly the kind of brittleness that gets a guard deleted.</summary>
    private static string Flatten(string text) => Regex.Replace(text, @"\s+", " ");

    /// <summary>As <see cref="Flatten"/>, but also strips the two pieces of markdown punctuation that
    /// break a sentence in the middle without changing what it says: a blockquote's leading <c>&gt;</c>
    /// on every wrapped line, and inline-code backticks. The webhook contract's load-bearing paragraph is
    /// a blockquote containing code spans, so without this a test about its MEANING would be a test about
    /// where its lines happen to wrap.</summary>
    private static string FlattenProse(string text) =>
        Flatten(Regex.Replace(text, @"^\s*>", " ", RegexOptions.Multiline).Replace("`", ""));

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 1. The claim this whole batch exists to retire.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 The product's own README called "alarms cannot reach anyone who is not looking at the screen" an
    /// honest limitation for two batches. Every clause of that entry is now false. This asserts it is not
    /// stated ANYWHERE as a claim, in either language — Đợt B shipped a Critical because a Vietnamese
    /// mirror was left uncorrected while the English copy was fixed, so the VI form is checked separately
    /// and with equal weight rather than being assumed to follow.
    /// </summary>
    [Fact]
    public void NoDocumentStillAssertsThatAlarmsCannotReachAnyoneOffScreen()
    {
        var files = new[]
        {
            ("README.md", ReadRepoFile("README.md")),
            ("docs/plans/2026-07-29-dotA-single-machine-sellable-blueprint.md",
                ReadRepoFile("docs", "plans", "2026-07-29-dotA-single-machine-sellable-blueprint.md")),
            ("docs/plans/2026-07-29-dotB-machine-control-blueprint.md",
                ReadRepoFile("docs", "plans", "2026-07-29-dotB-machine-control-blueprint.md")),
        };

        // The claim in ASSERTED form: a bolded lead, which is how every honest-limitation entry in these
        // documents is written. A past-tense quotation inside a correction ("used to say \"…\"") is not
        // bolded and is deliberately still allowed — see this class's doc comment.
        var assertedEn = new Regex(
            @"\*\*\s*Alarms\s+cannot\s+reach\s+anyone[^*]*\*\*", RegexOptions.IgnoreCase);
        var assertedVi = new Regex(
            @"\*\*\s*Cảnh\s+báo\s+KHÔNG\s+thể\s+tới\s+ai[^*]*\*\*", RegexOptions.IgnoreCase);

        // 🔴 The "no integration exists" family. Banned when ASSERTED — i.e. as a bare sentence — and
        // still permitted inside the quotation marks the corrections use to retire it in place. The
        // negative lookbehind is what draws that line: the original entries stated this as running prose
        // (preceded by whitespace), and every surviving occurrence is a quotation (preceded by an opening
        // quote character). Anyone re-asserting it as prose fails here.
        var noIntegrationEn = new Regex(
            @"(?<![""“])There\s+is\s+no\s+email,\s*SMS,\s*webhook", RegexOptions.IgnoreCase);
        var noIntegrationVi = new Regex(
            @"(?<![""“])KHÔNG\s+có\s+email/SMS/webhook/Slack/\s*syslog/relay/tín\s+hiệu\s+âm\s+thanh",
            RegexOptions.IgnoreCase);

        foreach (var (name, text) in files)
        {
            var flat = Flatten(text);
            Assert.False(assertedEn.IsMatch(flat), $"{name} still ASSERTS the retired EN claim.");
            Assert.False(assertedVi.IsMatch(flat), $"{name} still ASSERTS the retired VI claim.");
            Assert.False(noIntegrationEn.IsMatch(flat), $"{name} still asserts no EN integration exists.");
            Assert.False(noIntegrationVi.IsMatch(flat), $"{name} still asserts no VI integration exists.");
        }

        // 🔴 The other direction, and it is what stops this test from passing on a README somebody simply
        // deleted the section from. The correction must be PRESENT, in both languages, and it must name
        // the capability rather than merely removing the denial.
        var readme = Flatten(files[0].Item2);
        Assert.Matches(new Regex(@"Alarms\s+CAN\s+now\s+reach", RegexOptions.IgnoreCase), readme);
        Assert.Matches(new Regex(@"Cảnh\s+báo\s+ĐÃ\s+có\s+thể\s+tới", RegexOptions.IgnoreCase), readme);
    }

    /// <summary>
    /// 🔴 The file-count clause, which is the one an editor is most likely to leave behind because it
    /// reads as a detail rather than as a claim. <c>St4i.EngineApi/Alarms/</c> was "exactly seven files";
    /// it is not, and this asserts the README does not say so in the present tense — while allowing the
    /// past-tense quotation the correction is built on.
    /// </summary>
    [Fact]
    public void TheAlarmsFolderFileCountClaim_IsNotStatedInThePresentTense_AndTheFolderIsNotSevenFiles()
    {
        // First: the fact itself, measured rather than assumed. If this ever drops back to seven, the
        // assertion below is the wrong guard and somebody should find out here.
        var alarmsDir = Path.Combine(MachineSimulatorRoot(), "src", "St4i.EngineApi", "Alarms");
        var count = Directory.GetFiles(alarmsDir, "*.cs", SearchOption.TopDirectoryOnly).Length;
        Assert.True(count > 7,
            $"St4i.EngineApi/Alarms/ has {count} file(s). The README's retired claim said seven; if this " +
            "is genuinely seven again, the census entry needs rewriting rather than this test relaxing.");

        var readme = Flatten(ReadRepoFile("README.md"));

        // Present-tense assertions of the count are banned; "used to say … was \"exactly seven files\"" is
        // not, because that sentence is the correction.
        Assert.DoesNotMatch(new Regex(@"is\s+exactly\s+seven\s+files", RegexOptions.IgnoreCase), readme);
        Assert.DoesNotMatch(new Regex(@"chỉ\s+có\s+đúng\s+7\s+file\s+—", RegexOptions.IgnoreCase), readme);

        // And the correction states the real number, in both languages.
        Assert.Matches(new Regex($@"\*\*{count}\s+files\*\*", RegexOptions.IgnoreCase), readme);
        Assert.Matches(new Regex($@"\*\*{count}\s+file\*\*", RegexOptions.IgnoreCase), readme);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 2. The claim that was RETIRED BY DECISION, which must not be restated.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 Đợt C's earlier tasks described the batch as "additive and default-off, bit-for-bit identical
    /// when nothing is configured". C-2's review deliberately overturned that: the notification seam is
    /// registered unconditionally, so a fresh install starts one bounded channel, one drain loop and one
    /// hosted service it did not start before. Restating the old claim would be the most damaging kind of
    /// documentation error — one that tells an operator a behaviour change did not happen.
    ///
    /// <para>Guarded in both directions: the claim must not be ASSERTED, and the README must state what
    /// actually happens instead — including the part that IS still true, since a correction that only
    /// denies leaves a reader with nothing.</para>
    /// </summary>
    [Fact]
    public void TheRetiredDefaultOffClaim_IsNotRestated_AndWhatActuallyHappensIsStated()
    {
        var readme = Flatten(ReadRepoFile("README.md"));

        // The claim asserted about the BATCH or the PRODUCT. The §22.2 sentence that retires it reads
        // `This batch is NOT "additive and default-off"`, so the ban is on the affirmative form.
        Assert.DoesNotMatch(
            new Regex(@"(batch|Đợt\s*C)\s+is\s+additive\s+and\s+default-off", RegexOptions.IgnoreCase),
            readme);
        Assert.DoesNotMatch(
            new Regex(@"bit-for-bit\s+identical\s+when\s+nothing\s+is\s+configured", RegexOptions.IgnoreCase),
            readme);

        // 🔴 The other direction. The behaviour change must be stated as a change, in both languages.
        Assert.Matches(new Regex(@"NOT\s+""additive\s+and\s+default-off""", RegexOptions.IgnoreCase), readme);
        Assert.Matches(new Regex(@"registered\s+\*\*unconditionally\*\*", RegexOptions.IgnoreCase), readme);
        Assert.Matches(new Regex(@"đăng\s+ký\s+\*\*vô\s+điều\s+kiện\*\*", RegexOptions.IgnoreCase), readme);

        // And the part that IS still true, so the correction does not read as "everything now fires".
        Assert.Matches(
            new Regex(@"nothing\s+is\s+delivered\s+to\s+anybody", RegexOptions.IgnoreCase), readme);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 3. The honest limitations, which are the deliverable rather than a footnote.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 Each of these was verified against a source file by C-8, and each is the kind of statement that
    /// gets softened by a well-meaning editor into something reassuring and false. They are asserted by
    /// regex — wide enough that the paragraphs can be rewritten, narrow enough that removing the fact
    /// fails.
    /// </summary>
    [Fact]
    public void TheHonestLimitations_AreStatedInBothLanguages()
    {
        var readme = Flatten(ReadRepoFile("README.md"));

        // 🔴 The relay is not a safety device, and does not light while HALT is latched. This is the one
        // with a physical consequence, so both halves are required, in both languages.
        Assert.Matches(new Regex(@"not\s+a\s+safety\s+device", RegexOptions.IgnoreCase), readme);
        Assert.Matches(new Regex(@"không\s+phải\s+thiết\s+bị\s+an\s+toàn", RegexOptions.IgnoreCase), readme);
        Assert.Matches(new Regex(@"does\s+not\s+light\s+while\s+HALT\s+is\s+latched", RegexOptions.IgnoreCase), readme);
        Assert.Matches(new Regex(@"không\s+sáng\s+khi\s+HALT", RegexOptions.IgnoreCase), readme);
        Assert.Matches(new Regex(@"ISO\s*13849", RegexOptions.IgnoreCase), readme);

        // 🔴 A green SMTP test does not prove the password works.
        Assert.Matches(
            new Regex(@"green\s+e-mail\s+send\s+test\s+does\s+NOT\s+prove", RegexOptions.IgnoreCase), readme);
        Assert.Matches(
            new Regex(@"KHÔNG\s+chứng\s+minh\s+mật\s+khẩu", RegexOptions.IgnoreCase), readme);

        // Implicit TLS on 465 is unreachable; no desktop toast; no SMS; no relay send test.
        Assert.Matches(new Regex(@"port\s*465", RegexOptions.IgnoreCase), readme);
        Assert.Matches(new Regex(@"no\s+Windows\s+desktop\s+toast", RegexOptions.IgnoreCase), readme);
        Assert.Matches(new Regex(@"NO\s+SMS", RegexOptions.IgnoreCase), readme);
        Assert.Matches(new Regex(@"no\s+relay\s+send\s+test", RegexOptions.IgnoreCase), readme);

        // /hmi/:code is not annunciated, and the shipped deployment is said to be covered rather than the
        // limitation being left to imply that it is not.
        Assert.Matches(new Regex(@"/hmi/:code[^.]*NOT\s+annunciated", RegexOptions.IgnoreCase), readme);
        Assert.Matches(new Regex(@"shipped\s+desktop\s+deployment\s+is\s+covered", RegexOptions.IgnoreCase), readme);
    }

    /// <summary>
    /// 🔴 The environment-variable and data-directory documentation, which was INCOMPLETE rather than
    /// wrong — the failure mode that is hardest to notice. <c>ST4I_NOTIFICATIONS_DIR</c> names the
    /// directory holding webhook URLs, signing secrets, auth tokens and SMTP passwords, so its absence
    /// from the env-var tables meant an operator could not find, relocate, secure or purge them.
    /// </summary>
    [Fact]
    public void TheNotificationsDirectory_IsDocumented_AndIsPurgedByTheDecommissioningScript()
    {
        var readme = Flatten(ReadRepoFile("README.md"));

        Assert.Matches(new Regex(@"ST4I_NOTIFICATIONS_DIR", RegexOptions.None), readme);
        // 🔴 Not merely listed: the reason it is not like the other directory variables must be stated,
        // because that directory's ACL is the confidentiality boundary for stored credentials.
        Assert.Matches(new Regex(@"ACL\s+is\s+the\s+confidentiality\s+boundary", RegexOptions.IgnoreCase), readme);
        Assert.Matches(new Regex(@"ACL\s+của\s+(chính\s+)?thư\s+mục\s+đó", RegexOptions.IgnoreCase), readme);

        // 🔴 And the real defect behind the documentation gap: a decommissioning wipe that left live
        // third-party credentials on the machine. This asserts the SCRIPT, not the prose about it.
        var script = ReadRepoFile("packaging", "remove-data.ps1");
        Assert.Contains("ST4I_NOTIFICATIONS_DIR", script, StringComparison.Ordinal);
        Assert.Contains("$NotificationsDir", script, StringComparison.Ordinal);
        Assert.Matches(
            new Regex(@"Name\s*=\s*'notifications'", RegexOptions.IgnoreCase), Flatten(script));

        // Non-vacuity: the four directories that were always purged are still purged, so this test cannot
        // pass on a script somebody rewrote into something that deletes only the new one.
        foreach (var existing in new[] { "historian", "wal", "security", "creds" })
        {
            Assert.Matches(new Regex($@"Name\s*=\s*'{existing}'", RegexOptions.IgnoreCase), Flatten(script));
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 4. The webhook contract's load-bearing text.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴🔴 <c>docs/ALARM_WEBHOOK_CONTRACT.md</c> is <b>executable specification, not prose</b>, and C-3
    /// shipped a documentation defect with a security consequence against exactly this text: the code was
    /// correct and the normative recipe was correct, but the inline annotation a reader sees first pointed
    /// at an unsigned header — making every receiver that followed the document's own advice replayable.
    /// It was found only because a reviewer implemented the document as written and then attacked what it
    /// had built.
    ///
    /// <para>This asserts the two things a receiver author cannot afford to lose: that the headers are
    /// marked UNSIGNED at the point they are introduced, and that the boundary paragraph still says the
    /// signature covers only the timestamp and the raw body and that trustworthy decisions must read the
    /// BODY. C-8 had editorial licence over every document in this repository; this is the guard that
    /// makes the one paragraph it must not touch impossible to touch silently.</para>
    /// </summary>
    [Fact]
    public void TheWebhookContract_StillMarksTheConvenienceHeadersUnsigned_AndStillSaysToReadTheBody()
    {
        var contract = ReadRepoFile("docs", "ALARM_WEBHOOK_CONTRACT.md");
        var flat = FlattenProse(contract);

        // The inline annotations — the thing a reader sees FIRST, and the thing that was wrong in C-3.
        Assert.Matches(
            new Regex(@"X-ST4I-Delivery:[^\n]*UNSIGNED[^\n]*pre-filter\s+only", RegexOptions.IgnoreCase),
            contract);
        Assert.Matches(
            new Regex(@"X-ST4I-Event:[^\n]*UNSIGNED[^\n]*pre-filter\s+only", RegexOptions.IgnoreCase),
            contract);

        // The boundary paragraph: what the signature covers, and the instruction that follows from it.
        Assert.Matches(
            new Regex(@"Only\s+\*\*X-ST4I-Timestamp\s+and\s+the\s+raw\s+body\*\*\s+are\s+covered\s+by\s+the\s+signature",
                RegexOptions.IgnoreCase),
            flat);
        Assert.Matches(
            new Regex(@"All\s+other\s+headers\s+are\s+unauthenticated", RegexOptions.IgnoreCase), flat);
        Assert.Matches(
            new Regex(@"MUST\s+read\s+the\s+body", RegexOptions.IgnoreCase), flat);

        // 🔴 The concrete attack, which is what makes the paragraph persuasive rather than a caveat. A
        // future editor who trims this to "headers are not signed" loses the reason anybody acts on it.
        Assert.Matches(new Regex(@"replay", RegexOptions.IgnoreCase), flat);
        Assert.Matches(
            new Regex(@"body\.deliveryId\s+and\s+body\.edge\.kind", RegexOptions.IgnoreCase), flat);
    }
}
