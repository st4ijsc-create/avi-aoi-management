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

    /// <summary>
    /// 🔴 The document with every RETIRED claim removed, leaving only what it still asserts in its own
    /// voice. Every "this must no longer be claimed" check below runs over this rather than over the raw
    /// text.
    ///
    /// <para>This repository retires a claim in place rather than deleting it — somebody who bookmarked a
    /// paragraph must see the correction, not a gap — and it does so in <b>two different notations</b>:
    /// the README quotes the old wording (<c>used to say "…"</c>), while the batch blueprints strike it
    /// through (<c>~~…~~</c>). Review round 1 (M-1) found the consequence of modelling only one of them:
    /// my first guard used a negative lookbehind for an opening quote, which the README satisfies and the
    /// blueprints do not — so un-striking the dotA blueprint's own retired line would have passed. The
    /// test named three files and effectively guarded one.</para>
    ///
    /// <para>Removing both notations is also simpler than either lookbehind, and it is why the bans below
    /// can now be plain "does this text still say X" checks.</para>
    /// </summary>
    private static string LiveProse(string text)
    {
        // Flattened FIRST: markdown re-wraps, and the README's own retirement quotes span a line break
        // mid-sentence, so a line-bounded match would miss them and this helper would under-remove.
        var flat = Flatten(text);

        // 🔴 Both removals are LENGTH-BOUNDED. An unbalanced marker — a stray `~~`, an unclosed quote —
        // would otherwise let one match run to the next marker anywhere in the document, silently
        // deleting real assertions along the way. That direction is the dangerous one: over-removal here
        // is a FALSE PASS on a claim the document still makes. 600 characters is several times the
        // longest genuine retirement in this repository (~130) and far short of a section.
        var withoutStruck = Regex.Replace(flat, @"~~[^~]{1,600}?~~", " ");
        return Regex.Replace(withoutStruck, "[\"“][^\"”]{0,600}[\"”]", " ");
    }

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

        // The claim, in whatever form. Run over LiveProse, so a quotation or a struck-through line — the
        // two notations this repository uses to RETIRE a claim in place — does not count as asserting it.
        var assertedEn = new Regex(
            @"Alarms\s+cannot\s+reach\s+anyone", RegexOptions.IgnoreCase);
        var assertedVi = new Regex(
            @"Cảnh\s+báo\s+KHÔNG\s+thể\s+tới\s+ai", RegexOptions.IgnoreCase);

        // 🔴 The "no integration exists" family.
        //
        // Review round 1 (M-1): the VI pattern was tuned to the README's exact wording
        // ("…/syslog/relay/tín hiệu âm thanh…") and therefore did not match the dotA blueprint's own VI
        // wording of the same claim ("…/Slack/relay/còi/đèn"). Both are now matched on the prefix they
        // genuinely share, which is wider than either phrasing and still narrower than the claim.
        var noIntegrationEn = new Regex(
            @"There\s+is\s+no\s+email,\s*SMS,\s*webhook", RegexOptions.IgnoreCase);
        var noIntegrationVi = new Regex(
            @"KHÔNG\s+có\s+email/SMS/webhook", RegexOptions.IgnoreCase);

        foreach (var (name, text) in files)
        {
            var live = LiveProse(text);
            Assert.False(assertedEn.IsMatch(live), $"{name} still ASSERTS the retired EN claim.");
            Assert.False(assertedVi.IsMatch(live), $"{name} still ASSERTS the retired VI claim.");
            Assert.False(noIntegrationEn.IsMatch(live), $"{name} still asserts no EN integration exists.");
            Assert.False(noIntegrationVi.IsMatch(live), $"{name} still asserts no VI integration exists.");
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

        var readmeText = ReadRepoFile("README.md");
        var readme = Flatten(readmeText);
        var live = LiveProse(readmeText);

        // The count claim is banned outright in the document's own voice. The corrections quote it, and
        // LiveProse removes quoted spans, so this needs no present-tense hedging: if the phrase survives
        // OUTSIDE a quotation, somebody has re-asserted it.
        Assert.DoesNotMatch(new Regex(@"exactly\s+seven\s+files", RegexOptions.IgnoreCase), live);
        Assert.DoesNotMatch(new Regex(@"chỉ\s+có\s+đúng\s+7\s+file", RegexOptions.IgnoreCase), live);

        // And the correction states the real number, in both languages.
        //
        // Review round 1 (M-4): these two are the assertions that will actually fire when somebody adds a
        // file to Alarms/, so they carry the explanation. Previously it sat on the `count > 7` assert
        // above — which is the one that essentially never fires — and a developer who added a file got a
        // bare "pattern not found" with no hint that the README carries a number needing an update.
        Assert.True(Regex.IsMatch(readme, $@"\*\*{count}\s+files\*\*", RegexOptions.IgnoreCase),
            $"St4i.EngineApi/Alarms/ now has {count} .cs files, but README §20.5's ENGLISH correction does " +
            $"not state \"**{count} files**\". That paragraph replaced the retired \"exactly seven files\" " +
            "claim with a real count — update the number rather than removing the sentence.");
        Assert.True(Regex.IsMatch(readme, $@"\*\*{count}\s+file\*\*", RegexOptions.IgnoreCase),
            $"St4i.EngineApi/Alarms/ now has {count} .cs files, but README §20.5's VIETNAMESE mirror does " +
            $"not state \"**{count} file**\". The VI mirror is corrected separately and with equal weight — " +
            "Đợt B shipped a Critical because a VI mirror was left behind while the EN copy was fixed.");
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
        var readmeText = ReadRepoFile("README.md");
        var readme = Flatten(readmeText);
        var live = LiveProse(readmeText);

        // The claim, banned in the document's own voice. §22.2 retires it by QUOTING it, and LiveProse
        // removes quoted spans — so these fire only if somebody states it as fact again. Note the other
        // legitimate uses of "default-off" in this README (the Site link, the Modbus/OPC-UA seeders, mDNS
        // advertise) are about features that genuinely ARE, and none of them says it of this batch.
        Assert.DoesNotMatch(
            new Regex(@"additive\s+and\s+default-off", RegexOptions.IgnoreCase), live);
        Assert.DoesNotMatch(
            new Regex(@"bit-for-bit\s+identical\s+when\s+nothing\s+is\s+configured", RegexOptions.IgnoreCase),
            live);

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
    }

    /// <summary>
    /// 🔴🔴 Review round 1 (I-1) — <b>the decommissioning wipe must purge EVERY directory the engine
    /// creates, and this test derives that list from the source rather than restating it.</b>
    ///
    /// <para><b>Why this replaced a hard-coded list.</b> The first version of the test above asserted the
    /// five names the script happened to purge. That is the failure mode the whole census exists to
    /// prevent, committed in a test: the engine creates <b>thirteen</b> directories under
    /// <c>%ProgramData%\ST4I\sim</c>, the script purged five, and pinning those five <i>froze the
    /// incompleteness as if it were complete</i> — a future reader would have taken a green test as proof
    /// the credential story was closed. Two of the eight missing ones hold credentials: <c>identity</c>
    /// (the device's PFX private key, sealed at <b>LocalMachine</b> scope, so any local administrator can
    /// unseal it) and <c>connector-config</c> (the node-map JSON verbatim, and an OPC-UA map carries its
    /// password in plaintext).</para>
    ///
    /// <para><b>How it cannot rot:</b> the expected list is discovered by scanning <c>src/</c> for the
    /// <c>"ST4I", "sim", "&lt;name&gt;"</c> default-path constant every store declares. Adding a
    /// fourteenth store therefore fails this test until the script purges it too, which is the only
    /// arrangement that survives somebody who has not read this comment.</para>
    /// </summary>
    [Fact]
    public void EveryDirectoryTheEngineCreatesUnderProgramData_IsPurgedByTheDecommissioningScript()
    {
        var root = MachineSimulatorRoot();
        var script = Flatten(ReadRepoFile("packaging", "remove-data.ps1"));

        // Every `"ST4I", "sim", "<name>"` default-path constant in src/ — the one place a store declares
        // where it lives. Ordinal, because these are C# string literals, not prose.
        var declared = new SortedSet<string>(StringComparer.Ordinal);
        var constant = new Regex(
            "\"ST4I\"\\s*,\\s*\"sim\"\\s*,\\s*\"(?<name>[A-Za-z0-9._-]+)\"", RegexOptions.None);

        foreach (var file in Directory.EnumerateFiles(
                     Path.Combine(root, "src"), "*.cs", SearchOption.AllDirectories))
        {
            // bin/obj carry generated copies of the same literals; they are not sources of truth.
            if (file.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}", StringComparison.Ordinal) ||
                file.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
            {
                continue;
            }

            foreach (Match m in constant.Matches(File.ReadAllText(file)))
            {
                declared.Add(m.Groups["name"].Value);
            }
        }

        // Non-vacuity: if the scan finds nothing (a refactor moved the constants), this test must fail
        // loudly rather than pass by asserting over an empty set — the exact shape of a vacuous test.
        Assert.True(declared.Count >= 13,
            $"Only {declared.Count} data directory constant(s) were found in src/ ({string.Join(", ", declared)}). " +
            "The scan, not the script, is what broke — fix the scan rather than deleting this assertion.");

        // The controls, named explicitly so a scan that silently stopped matching the security-bearing
        // stores cannot leave this test green.
        foreach (var mustFind in new[] { "identity", "connector-config", "notifications", "creds", "security" })
        {
            Assert.Contains(mustFind, declared);
        }

        var missing = declared
            .Where(name => !Regex.IsMatch(script, $@"Name\s*=\s*'{Regex.Escape(name)}'", RegexOptions.IgnoreCase))
            .ToList();

        Assert.True(missing.Count == 0,
            "packaging/remove-data.ps1 does not purge every directory the engine creates under " +
            $"%ProgramData%\\ST4I\\sim. Missing: {string.Join(", ", missing)}. A decommissioning wipe that " +
            "skips one of these leaves it on a machine being handed on, scrapped or returned — and " +
            "`identity` and `connector-config` hold a private key and a plaintext password respectively. " +
            "Add it to $subdirs (with its ST4I_*_DIR relocation), or state in the script's .NOTES AND " +
            "README §15.4 (EN and VI) that it is deliberately kept and why.");
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
        //
        // Review round 1 (M-5): asserting the bare word "replay" was near-vacuous — it appears throughout
        // the document. What must survive is the MECHANISM: that a captured request can be replayed with
        // the convenience headers rewritten and the signature still verifies.
        Assert.Matches(
            new Regex(@"replay[^.]{0,200}?(X-ST4I-Delivery|X-ST4I-Event|header)", RegexOptions.IgnoreCase),
            flat);
        Assert.Matches(
            new Regex(@"signature\s+still\s+verifies", RegexOptions.IgnoreCase), flat);
        Assert.Matches(
            new Regex(@"body\.deliveryId\s+and\s+body\.edge\.kind", RegexOptions.IgnoreCase), flat);
    }

    /// <summary>
    /// 🔴🔴 Review round 1 (I-2) — <b>the half of the contract my first guard left open, and it is the
    /// half C-3's defect actually lived in.</b>
    ///
    /// <para>The reviewer attacked the guard by changing §3's numbered recipe, step 6, from
    /// <c>"Drop the message if body.deliveryId has been seen before"</c> to
    /// <c>"…if the X-ST4I-Delivery header has been seen before"</c> — and <b>all six tests passed.</b>
    /// That is C-3's defect reproduced exactly: the code correct, the boundary blockquote correct, the
    /// inline annotations correct, and <b>the instruction a reader actually implements</b> pointing at an
    /// unsigned, attacker-rewritable header — making every receiver that followed the document
    /// replayable.</para>
    ///
    /// <para>My guard covered the annotations and the blockquote: the half that was <i>wrong</i> last
    /// time. It left unprotected the half that was <i>right</i> last time, which is precisely where the
    /// next well-meaning simplification lands. §3 is the section somebody copies into a receiver.</para>
    ///
    /// <para><b>The assertion:</b> the verification recipe must name <c>body.deliveryId</c> and must not
    /// mention <c>X-ST4I-Delivery</c> <i>at all</i> — that header plays no part in verifying a signature,
    /// so its appearance anywhere inside the recipe is either the defect or a step towards it.</para>
    /// </summary>
    [Fact]
    public void TheWebhookContract_DedupRecipe_NamesTheSignedBodyField_NeverTheUnsignedHeader()
    {
        var contract = ReadRepoFile("docs", "ALARM_WEBHOOK_CONTRACT.md");

        // §3's first fenced block — the numbered recipe a receiver author implements.
        var section = Regex.Match(
            contract,
            @"^##\s*3\..*?^```(?<recipe>.*?)^```",
            RegexOptions.Singleline | RegexOptions.Multiline);
        Assert.True(section.Success,
            "Could not find the numbered verification recipe under section 3 of " +
            "docs/ALARM_WEBHOOK_CONTRACT.md. If that section was restructured, re-point this test — do " +
            "NOT delete it: it guards the instruction receiver authors actually implement.");

        var recipe = section.Groups["recipe"].Value;

        // 🔴 The dedup step must key on the SIGNED body field.
        Assert.Matches(new Regex(@"body\.deliveryId", RegexOptions.None), recipe);
        Assert.Matches(new Regex(@"seen\s+before", RegexOptions.IgnoreCase), recipe);

        // 🔴 And the unsigned convenience header must not appear in the recipe at all. It is not part of
        // verification, so there is no legitimate reason for it to be here — while a replay with a
        // rewritten header is the exact attack the whole boundary paragraph exists to prevent.
        Assert.DoesNotMatch(new Regex(@"X-ST4I-Delivery", RegexOptions.IgnoreCase), recipe);
        Assert.DoesNotMatch(new Regex(@"X-ST4I-Event", RegexOptions.IgnoreCase), recipe);

        // The reinforcing note beneath the recipe, which is what tells a reader the choice was deliberate
        // rather than incidental. Guarded in both directions: it must still say the header is the wrong
        // key, and must still name the right one.
        var flat = FlattenProse(contract);
        Assert.Matches(
            new Regex(@"dedup\s+on\s+the\s+header[^.]*sails\s+through", RegexOptions.IgnoreCase), flat);
        Assert.Matches(
            new Regex(@"Step\s*6\s*(is\s*not\s*optional|says)", RegexOptions.IgnoreCase), flat);
    }
}
