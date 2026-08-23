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
/// <item><b>🔴 WHAT IT DOES NOT MEASURE.</b> (a) It does NOT check cross-file integrity, because after this
/// fix there is none to check: item 45 states plainly that seeding one file alone can leave a surviving
/// operator-authored <c>ecosystem-products.json</c> naming a recipe the freshly seeded
/// <c>ecosystem-recipes.json</c> does not contain, and NOTHING in that class validates it. That new state is
/// the price the ruling accepted and this file does not pretend it is absent. (b) It does not exercise
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
}
