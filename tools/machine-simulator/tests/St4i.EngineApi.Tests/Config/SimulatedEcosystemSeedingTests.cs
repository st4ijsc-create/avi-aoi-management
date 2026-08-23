using St4i.EngineApi.Config;
using Xunit;

namespace St4i.EngineApi.Tests.Config;

/// <summary>
/// 🔴 <b>OWNER'S RULING 2026-08-23 — docs/owner-decisions.md item 45: <see cref="SimulatedEcosystem"/>'s
/// constructor must seed only the file that is actually missing.</b>
///
/// <para><b>THE THREE LAWS THIS FILE OWES.</b>
/// <list type="number">
/// <item><b>IT CAN GO RED.</b> The TWO <c>Item45_Witness_…</c> tests — the missing-one case, read once from
/// each side — redden by restoring <c>Load()</c>'s single closing line to
/// <c>if (!productsExisted || !recipesExisted) Save();</c>. That edit was made and reverted; the control
/// pair is in <c>.superpowers/sdd/items-43-44-45-47/task-1-report.md</c>. The two <c>Item45_Guard_…</c>
/// tests are GUARDS: they were green BEFORE the fix and are green after it, and they are labelled that way
/// in their own summaries rather than left to look like evidence.</item>
/// <item><b>FALSE POSITIVES.</b> Each test gets its own freshly created directory, passed EXPLICITLY to the
/// constructor, so nothing here reads or writes <c>%ProgramData%</c>, consults
/// <c>ST4I_ECOSYSTEM_DIR</c>, or shares state with another test or another suite.</item>
/// <item><b>🔴 WHAT IT DOES NOT MEASURE.</b> (a) <i>Retracted in place, 2026-08-24 (BP-1, item 64) —
/// original kept verbatim:</i> "It does NOT check cross-file integrity, because after this fix there is
/// none to check: item 45 states plainly that seeding one file alone can leave a surviving
/// operator-authored <c>ecosystem-products.json</c> naming a recipe the freshly seeded
/// <c>ecosystem-recipes.json</c> does not contain, and NOTHING in that class validates it. That new state is
/// the price the ruling accepted and this file does not pretend it is absent." 🔴 <b>The state that sentence
/// names cannot be constructed.</b> A product does not reference a recipe in either direction —
/// <c>ProductModel</c>, <c>ProductVariant</c> and <c>Recipe</c> share no field that could carry the
/// reference, which <c>Item64_NeitherHalf_CanReferenceTheOther</c> below now measures rather than asserts.
/// The state item 45 really opened is a HALF-APPLIED
/// DIVERGENCE PAIR, and this file measures that instead — see the item 64 block at the bottom. (b) It does not exercise
/// <c>remove-data.ps1</c> or any packaging path — the connection to the 2026-08-23(b) wipe exemption is why
/// the defect matters, not something asserted here. (c) It says nothing about the MUTATION paths: every
/// method that changes state still writes BOTH files through <c>Save()</c>, which is correct and untouched,
/// and is not covered here.</item>
/// </list></para>
/// </summary>
public sealed class SimulatedEcosystemSeedingTests
{
    private const string ProductsFile = "ecosystem-products.json";
    private const string RecipesFile = "ecosystem-recipes.json";

    /// <summary>🔴 Operator-authored file contents, and their SHAPE is load-bearing rather than incidental.
    /// They are COMPACT one-line JSON carrying one entry, so a re-serialize by this store — which writes
    /// <c>WriteIndented = true</c> and emits every property — produces visibly different bytes. Measured
    /// while writing this file: the obvious fixture, a bare <c>"[]"</c>, is a ROUND-TRIP FIXED POINT (an
    /// empty list serializes back to exactly <c>"[]"</c>), so both witnesses below were GREEN against the
    /// pre-fix tree and proved nothing at all. A fixture that cannot survive being rewritten is what makes
    /// the assertion an assertion.</summary>
    private const string OperatorAuthoredRecipes = """[{"code":"OP-KEEP","name":"operator authored"}]""";

    /// <summary>The products-side twin of <see cref="OperatorAuthoredRecipes"/>, compact for the same
    /// reason.</summary>
    private const string OperatorAuthoredProducts = """[{"code":"OP-KEEP","name":"operator authored"}]""";

    private static string FreshDir() => Directory.CreateTempSubdirectory("st4i-ecosystem-seed-").FullName;

    /// <summary>🔴 <b>THE WITNESS — and it covers the MISSING-ONE case, which is the case that was broken.</b>
    /// An operator deletes <c>ecosystem-products.json</c> and keeps the <c>ecosystem-recipes.json</c> they
    /// authored. Before the ruling, <c>Load()</c> answered that by calling <c>Save()</c>, which writes BOTH
    /// files — so the constructor silently destroyed the file the operator kept. It must now write only the
    /// one that was absent.</summary>
    [Fact]
    public void Item45_Witness_ProductsMissing_SeedsProductsOnly_AndLeavesTheOperatorsRecipesFileByteIdentical()
    {
        var dir = FreshDir();
        var recipesPath = Path.Combine(dir, RecipesFile);
        File.WriteAllText(recipesPath, OperatorAuthoredRecipes);

        _ = new SimulatedEcosystem(dir);

        Assert.Equal(OperatorAuthoredRecipes, File.ReadAllText(recipesPath));
        Assert.True(File.Exists(Path.Combine(dir, ProductsFile)));
    }

    /// <summary>🔴 <b>THE WITNESS, mirrored.</b> The same defect with the two files swapped — an operator who
    /// deletes the recipes file must not lose the products file they authored. Reddens on the same single
    /// edit. It is a second reading of one measurement, not a second measurement, and is written out because
    /// <c>Load()</c> reads the two flags independently and a half-fix would leave exactly one of these two
    /// green.</summary>
    [Fact]
    public void Item45_Witness_RecipesMissing_SeedsRecipesOnly_AndLeavesTheOperatorsProductsFileByteIdentical()
    {
        var dir = FreshDir();
        var productsPath = Path.Combine(dir, ProductsFile);
        File.WriteAllText(productsPath, OperatorAuthoredProducts);

        _ = new SimulatedEcosystem(dir);

        Assert.Equal(OperatorAuthoredProducts, File.ReadAllText(productsPath));
        Assert.True(File.Exists(Path.Combine(dir, RecipesFile)));
    }

    /// <summary>🔴 <b>GUARD, self-labelled — green before the fix and after it.</b> A genuinely fresh install
    /// (neither file present) must still get a complete, matched seed pair. This is what stops the fix from
    /// being "write nothing", which would pass both witnesses above.</summary>
    [Fact]
    public void Item45_Guard_NeitherFilePresent_StillSeedsBoth()
    {
        var dir = FreshDir();

        _ = new SimulatedEcosystem(dir);

        Assert.True(File.Exists(Path.Combine(dir, ProductsFile)));
        Assert.True(File.Exists(Path.Combine(dir, RecipesFile)));
    }

    /// <summary>🔴 <b>GUARD, self-labelled — green before the fix and after it.</b> With BOTH files present,
    /// the constructor was already a pure read and must stay one: an ordinary restart must not rewrite an
    /// operator's configuration at all. Asserted on the bytes of both files.</summary>
    [Fact]
    public void Item45_Guard_BothFilesPresent_TouchesNeither()
    {
        var dir = FreshDir();
        var productsPath = Path.Combine(dir, ProductsFile);
        var recipesPath = Path.Combine(dir, RecipesFile);
        File.WriteAllText(productsPath, OperatorAuthoredProducts);
        File.WriteAllText(recipesPath, OperatorAuthoredRecipes);

        _ = new SimulatedEcosystem(dir);

        Assert.Equal(OperatorAuthoredProducts, File.ReadAllText(productsPath));
        Assert.Equal(OperatorAuthoredRecipes, File.ReadAllText(recipesPath));
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    // 🔴 Task BP-1, 2026-08-24 — docs/owner-decisions.md item 64.
    //
    // Item 45's own comment justified its hole with a state that CANNOT EXIST, and this file repeated the
    // claim (retracted verbatim in the class summary above). The measurement below replaces it.
    //
    // WHAT THE NEW INSTRUMENT MEASURES: PROVENANCE, not version arithmetic. Item 64 §64.3 is right that
    // asserting the seed's deltas would freeze a constant no artifact in this tree publishes as a
    // contract, and that constant is the owner's to publish. "Exactly one of the two halves was seeded by
    // this Load, the other was read off disk" is a fact about what Load DID, needs no published constant,
    // and is precisely the state in which the demo divergence can be half-applied.
    //
    // WHAT IT DOES NOT MEASURE, said where the result appears: (1) it does NOT say the surviving half is
    // wrong — an operator file at the very version the seed would have produced is indistinguishable here,
    // and correctly so; (2) it does NOT read Recipe.Payload, an untyped Dictionary<string,object?> bag
    // that reflection cannot see into — the census below is a TYPE-level statement and says so; (3) it
    // does not surface the warning anywhere an operator can read it. The property is observable and is
    // wired to no endpoint or UI in this task.
    // ═══════════════════════════════════════════════════════════════════════════════════════════════

    /// <summary>🔴 <b>Item 64's WITNESS, half one.</b> Red before the fix: a half-seeded ecosystem reported
    /// nothing at all, so the demo could start with only one side of the divergence pair applied and the
    /// first mutation would <c>Save()</c> both halves and freeze it.</summary>
    [Fact]
    public void Item64_Witness_OnlyRecipesSurvived_TheHalfSeededStateIsReported()
    {
        var dir = FreshDir();
        File.WriteAllText(Path.Combine(dir, RecipesFile), OperatorAuthoredRecipes);

        var eco = new SimulatedEcosystem(dir);

        Assert.NotNull(eco.SeedIntegrityWarning);
        Assert.Contains(ProductsFile, eco.SeedIntegrityWarning, StringComparison.Ordinal);
        Assert.Contains(RecipesFile, eco.SeedIntegrityWarning, StringComparison.Ordinal);
    }

    /// <summary>🔴 <b>Item 64's WITNESS, half two — read from the OTHER side, because a one-directional
    /// witness is half a witness.</b></summary>
    [Fact]
    public void Item64_Witness_OnlyProductsSurvived_TheHalfSeededStateIsReported()
    {
        var dir = FreshDir();
        File.WriteAllText(Path.Combine(dir, ProductsFile), OperatorAuthoredProducts);

        var eco = new SimulatedEcosystem(dir);

        Assert.NotNull(eco.SeedIntegrityWarning);
        Assert.Contains(ProductsFile, eco.SeedIntegrityWarning, StringComparison.Ordinal);
        Assert.Contains(RecipesFile, eco.SeedIntegrityWarning, StringComparison.Ordinal);
    }

    /// <summary>🔴 <b>False-positive floor, both ends.</b> A fresh install (neither file) and an ordinary
    /// restart (both files) are the two states that must stay silent — a warning that fires on a normal
    /// start is a warning nobody reads, which is law (2) about any check.</summary>
    [Fact]
    public void Item64_BothHalvesFromTheSameSource_ReportNothing()
    {
        var fresh = FreshDir();
        Assert.Null(new SimulatedEcosystem(fresh).SeedIntegrityWarning);

        var restarted = FreshDir();
        File.WriteAllText(Path.Combine(restarted, ProductsFile), OperatorAuthoredProducts);
        File.WriteAllText(Path.Combine(restarted, RecipesFile), OperatorAuthoredRecipes);
        Assert.Null(new SimulatedEcosystem(restarted).SeedIntegrityWarning);
    }

    /// <summary>🔴 <b>The refutation, made mechanical.</b> Item 45's comment — and the retracted sentence in
    /// this file's own summary — named a dangling product→recipe reference. No such reference has a field
    /// to live in, in EITHER direction. Listed before counted, and read off the compiled types rather than
    /// restated as prose, so a field added tomorrow reddens this instead of quietly making the retraction
    /// wrong again.
    ///
    /// <para><b>Ceiling, stated where the result appears:</b> this is a TYPE-level census.
    /// <c>Recipe.Payload</c> is an untyped <c>Dictionary&lt;string, object?&gt;</c> and a caller may put any
    /// string in it; reflection cannot see inside a bag. The second half of this test therefore reads the
    /// SEEDED payload keys directly, which is a statement about the data this product ships, not about
    /// every payload that could ever exist.</para></summary>
    [Fact]
    public void Item64_NeitherHalf_CanReferenceTheOther()
    {
        static string[] PropertyNames(Type t) =>
            t.GetProperties().Select(p => p.Name).OrderBy(n => n, StringComparer.Ordinal).ToArray();

        var productProps = PropertyNames(typeof(St4i.EdgeCore.Config.ProductModel))
            .Concat(PropertyNames(typeof(St4i.EdgeCore.Config.ProductVariant)))
            .ToArray();
        var recipeProps = PropertyNames(typeof(St4i.EdgeCore.Config.Recipe));

        Assert.DoesNotContain(productProps, n => n.Contains("Recipe", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(recipeProps, n => n.Contains("Product", StringComparison.OrdinalIgnoreCase));

        // Non-vacuity: the census really read both type families, so an empty reflection result cannot
        // pass this by finding nothing.
        Assert.Contains("PointsConfigVersion", productProps);
        Assert.Contains("MachineType", recipeProps);
    }
}
