using System.Text.Json;

namespace St4i.EdgeCore.Config;

/// <summary>
/// Edge-local, JSON-file-backed CRUD store for product-config aggregates (System B: AOI/AVI
/// points+spec+fiducials+variants) and recipes (System A: automation/IoT payloads) — the foundation
/// later config-sync tasks (C2 Demo ecosystem, C3 Live REST, C4-C7 web authoring) build on. Two files
/// under <see cref="RootDirectory"/>: <c>products.json</c> (a JSON array of <see cref="ProductModel"/>)
/// and <c>recipes.json</c> (a JSON array of <see cref="Recipe"/>) — kept separate because they're two
/// independently-versioned server subsystems (System B is always-live 2-way; System A is pull-only
/// and flag-gated), mirroring <c>fleet.json</c>'s own "one plain JSON file an operator can hand-edit"
/// convention (see <see cref="Infrastructure.FleetConfig"/>).
///
/// Thread-safe: every public member locks a single gate (same pattern as
/// <see cref="Infrastructure.EventBus"/>/<see cref="Infrastructure.CredentialStore"/>'s file-per-call
/// approach) and every read/write hands out or accepts a deep clone (round-tripped through
/// <see cref="JsonSerializer"/>) rather than the live in-memory instance — so a caller mutating a
/// <see cref="ProductModel"/> it got back from <see cref="GetProduct"/> can never silently corrupt
/// this store's state without going through <see cref="UpsertProduct"/>/<see cref="UpsertPoint"/>.
/// The store is small in practice (a handful of products, at most a few hundred points) so a single
/// coarse lock plus whole-file rewrites on every mutation is simpler and safer than fine-grained
/// per-product locking or incremental persistence — there's no meaningful parallelism to preserve.
///
/// First run (no <c>products.json</c>/<c>recipes.json</c> found in <see cref="RootDirectory"/>) seeds
/// two realistic demo products and one automation recipe — see <see cref="SeedProducts"/> /
/// <see cref="SeedRecipes"/> — and persists them immediately, so a fresh exhibition kiosk boots with
/// real content instead of an empty store. Once either file exists (even as an empty array — an
/// operator, or an earlier run, may have deliberately cleared it), it is loaded as-is and never
/// reseeded.
/// </summary>
public sealed class ProductConfigStore
{
    private const string ProductsFileName = "products.json";
    private const string RecipesFileName = "recipes.json";

    private static readonly JsonSerializerOptions PersistenceOptions = new()
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = true,
    };

    private readonly object _gate = new();
    private readonly Dictionary<string, ProductModel> _products = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, Recipe> _recipes = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Directory holding <c>products.json</c>/<c>recipes.json</c>.</summary>
    public string RootDirectory { get; }

    /// <param name="directory">Where products.json/recipes.json live. Defaults to
    /// <see cref="AppContext.BaseDirectory"/> — the same "beside fleet.json" location
    /// <c>FleetHost</c>/<c>FleetService</c> resolve <c>fleet.json</c> from (see their
    /// <c>ResolveFleetPath</c>), so a hand-edit session finds every simulator config file in one
    /// folder. Tests pass a temp directory so runs don't share (or clobber) each other's state.</param>
    public ProductConfigStore(string? directory = null)
    {
        RootDirectory = string.IsNullOrWhiteSpace(directory) ? AppContext.BaseDirectory : directory;
        System.IO.Directory.CreateDirectory(RootDirectory);
        Load();
    }

    // ─────────────────────────────────────────────────────────────────────
    // Products
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>All products, ordered by code. Deep clones — safe for a caller to mutate freely.</summary>
    public IReadOnlyList<ProductModel> ListProducts()
    {
        lock (_gate)
        {
            return _products.Values
                .OrderBy(p => p.Code, StringComparer.OrdinalIgnoreCase)
                .Select(DeepClone)
                .ToList();
        }
    }

    /// <summary>The product for <paramref name="code"/>, or null if none exists. A deep clone.</summary>
    public ProductModel? GetProduct(string code)
    {
        ArgumentException.ThrowIfNullOrEmpty(code);
        lock (_gate)
        {
            return _products.TryGetValue(code, out var p) ? DeepClone(p) : null;
        }
    }

    /// <summary>Creates <paramref name="product"/> if <see cref="ProductModel.Code"/> is new, else
    /// replaces the whole stored product with it as-is (this does NOT bump
    /// <see cref="ProductModel.PointsConfigVersion"/> — the caller controls the version, since this
    /// is also how a pull-apply or a bulk import lands an ecosystem-authoritative version locally;
    /// see <see cref="UpsertPoint"/>/<see cref="SoftDeletePoint"/> for the auto-bumping,
    /// locally-authored-edit path). Persists immediately. Returns a deep clone of what was stored.</summary>
    public ProductModel UpsertProduct(ProductModel product)
    {
        ArgumentNullException.ThrowIfNull(product);
        ArgumentException.ThrowIfNullOrEmpty(product.Code);
        lock (_gate)
        {
            var stored = DeepClone(product);
            _products[stored.Code] = stored;
            Save();
            return DeepClone(stored);
        }
    }

    /// <summary>Removes the whole product (and every point/fiducial/variant it carries). Returns
    /// false if <paramref name="code"/> didn't exist. Persists immediately when it did.</summary>
    public bool DeleteProduct(string code)
    {
        ArgumentException.ThrowIfNullOrEmpty(code);
        lock (_gate)
        {
            if (!_products.Remove(code)) return false;
            Save();
            return true;
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Points (scoped to one product) — locally-authored edits, so these DO bump the product's
    // PointsConfigVersion (see UpsertProduct's doc comment for the contrast with a whole-product
    // replace).
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Active (non-tombstoned) points for <paramref name="productCode"/>, in
    /// <see cref="MeasurementPoint.OrderIndex"/> order.</summary>
    public IReadOnlyList<MeasurementPoint> GetActivePoints(string productCode) =>
        RequireProduct(productCode).ActivePoints.ToList();

    /// <summary>Every point for <paramref name="productCode"/>, including soft-deleted tombstones,
    /// in <see cref="MeasurementPoint.OrderIndex"/> order.</summary>
    public IReadOnlyList<MeasurementPoint> GetAllPoints(string productCode) =>
        RequireProduct(productCode).Points.OrderBy(p => p.OrderIndex).ToList();

    /// <summary>Creates or replaces (matched by <see cref="MeasurementPoint.Code"/>, case-insensitive)
    /// one point under <paramref name="productCode"/>, stamps <see cref="MeasurementPoint.LastModifiedAt"/>
    /// to now, bumps the product's <see cref="ProductModel.PointsConfigVersion"/>, and persists.
    /// Throws <see cref="KeyNotFoundException"/> if the product doesn't exist. Returns a deep clone
    /// of the stored point.</summary>
    public MeasurementPoint UpsertPoint(string productCode, MeasurementPoint point)
    {
        ArgumentException.ThrowIfNullOrEmpty(productCode);
        ArgumentNullException.ThrowIfNull(point);
        ArgumentException.ThrowIfNullOrEmpty(point.Code);

        lock (_gate)
        {
            var product = RequireProductLocked(productCode);
            var stored = DeepClone(point);
            stored.LastModifiedAt = DateTimeOffset.UtcNow;

            var existingIndex = product.Points.FindIndex(
                p => string.Equals(p.Code, stored.Code, StringComparison.OrdinalIgnoreCase));
            if (existingIndex >= 0) product.Points[existingIndex] = stored;
            else product.Points.Add(stored);

            product.BumpVersion();
            Save();
            return DeepClone(stored);
        }
    }

    /// <summary>Tombstones the point (sets <see cref="MeasurementPoint.DeletedAt"/> to now and
    /// <see cref="MeasurementPoint.DeletedAtVersion"/> to the product's version AFTER the bump this
    /// causes) rather than removing the row — so a delta-sync consumer can still learn "this code is
    /// gone". Bumps the product's <see cref="ProductModel.PointsConfigVersion"/> and persists.
    /// Returns false (no-op, no bump) if the point doesn't exist or is already tombstoned. Throws
    /// <see cref="KeyNotFoundException"/> if the product doesn't exist.</summary>
    public bool SoftDeletePoint(string productCode, string pointCode)
    {
        ArgumentException.ThrowIfNullOrEmpty(productCode);
        ArgumentException.ThrowIfNullOrEmpty(pointCode);

        lock (_gate)
        {
            var product = RequireProductLocked(productCode);
            var point = product.Points.FirstOrDefault(
                p => string.Equals(p.Code, pointCode, StringComparison.OrdinalIgnoreCase));
            if (point is null || point.IsDeleted) return false;

            product.BumpVersion();
            point.DeletedAt = DateTimeOffset.UtcNow;
            point.DeletedAtVersion = product.PointsConfigVersion;
            point.LastModifiedAt = point.DeletedAt;

            Save();
            return true;
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Recipes
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>All recipes, ordered by code. Deep clones.</summary>
    public IReadOnlyList<Recipe> ListRecipes()
    {
        lock (_gate)
        {
            return _recipes.Values
                .OrderBy(r => r.Code, StringComparer.OrdinalIgnoreCase)
                .Select(DeepClone)
                .ToList();
        }
    }

    /// <summary>The recipe for <paramref name="code"/>, or null if none exists. A deep clone.</summary>
    public Recipe? GetRecipe(string code)
    {
        ArgumentException.ThrowIfNullOrEmpty(code);
        lock (_gate)
        {
            return _recipes.TryGetValue(code, out var r) ? DeepClone(r) : null;
        }
    }

    /// <summary>Creates or replaces the recipe for <see cref="Recipe.Code"/>. Always recomputes
    /// <see cref="Recipe.Checksum"/> from <see cref="Recipe.Payload"/> before storing (via
    /// <see cref="Recipe.RecomputeChecksum"/>) — a stored recipe's checksum is always authoritative
    /// for its payload, never independently settable. Does NOT auto-bump <see cref="Recipe.Version"/>
    /// (call <see cref="Recipe.BumpVersion"/> yourself first when authoring an actual new version —
    /// this mirrors <see cref="UpsertProduct"/>'s "caller controls the version" contract, since this
    /// is also the path a pulled/imported recipe lands through). Persists immediately. Returns a deep
    /// clone of what was stored.</summary>
    public Recipe UpsertRecipe(Recipe recipe)
    {
        ArgumentNullException.ThrowIfNull(recipe);
        ArgumentException.ThrowIfNullOrEmpty(recipe.Code);

        lock (_gate)
        {
            var stored = DeepClone(recipe);
            stored.RecomputeChecksum();
            _recipes[stored.Code] = stored;
            Save();
            return DeepClone(stored);
        }
    }

    /// <summary>Removes the recipe. Returns false if <paramref name="code"/> didn't exist. Persists
    /// immediately when it did.</summary>
    public bool DeleteRecipe(string code)
    {
        ArgumentException.ThrowIfNullOrEmpty(code);
        lock (_gate)
        {
            if (!_recipes.Remove(code)) return false;
            Save();
            return true;
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Persistence
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Discards all in-memory state and re-reads both files from <see cref="RootDirectory"/>
    /// (no reseed — reload only ever reads what's actually on disk).</summary>
    public void Reload()
    {
        lock (_gate)
        {
            _products.Clear();
            _recipes.Clear();
            Load();
        }
    }

    /// <summary>Called from the constructor (before this instance is published to any other thread —
    /// no lock needed there) and from <see cref="Reload"/> (which already holds <see cref="_gate"/>).</summary>
    private void Load()
    {
        var productsPath = Path.Combine(RootDirectory, ProductsFileName);
        var recipesPath = Path.Combine(RootDirectory, RecipesFileName);
        var productsExisted = File.Exists(productsPath);
        var recipesExisted = File.Exists(recipesPath);

        if (productsExisted)
        {
            var loaded = JsonSerializer.Deserialize<List<ProductModel>>(
                File.ReadAllText(productsPath), PersistenceOptions) ?? new();
            foreach (var p in loaded) _products[p.Code] = p;
        }
        else
        {
            foreach (var p in SeedProducts()) _products[p.Code] = p;
        }

        if (recipesExisted)
        {
            var loaded = JsonSerializer.Deserialize<List<Recipe>>(
                File.ReadAllText(recipesPath), PersistenceOptions) ?? new();
            foreach (var r in loaded) _recipes[r.Code] = r;
        }
        else
        {
            foreach (var r in SeedRecipes()) _recipes[r.Code] = r;
        }

        // Persist freshly-seeded state immediately so a fresh install has real files on disk the
        // moment it boots, not just an in-memory seed that vanishes if the process exits before any
        // explicit mutation calls Save().
        if (!productsExisted || !recipesExisted) Save();
    }

    /// <summary>Always called with <see cref="_gate"/> already held.</summary>
    private void Save()
    {
        var productsPath = Path.Combine(RootDirectory, ProductsFileName);
        var recipesPath = Path.Combine(RootDirectory, RecipesFileName);
        File.WriteAllText(productsPath, JsonSerializer.Serialize(
            _products.Values.OrderBy(p => p.Code, StringComparer.OrdinalIgnoreCase).ToList(), PersistenceOptions));
        File.WriteAllText(recipesPath, JsonSerializer.Serialize(
            _recipes.Values.OrderBy(r => r.Code, StringComparer.OrdinalIgnoreCase).ToList(), PersistenceOptions));
    }

    private static T DeepClone<T>(T value) =>
        JsonSerializer.Deserialize<T>(JsonSerializer.Serialize(value, PersistenceOptions), PersistenceOptions)!;

    /// <summary>Public read path: locks, clones out. Throws if missing.</summary>
    private ProductModel RequireProduct(string productCode)
    {
        ArgumentException.ThrowIfNullOrEmpty(productCode);
        return GetProduct(productCode)
            ?? throw new KeyNotFoundException($"Product '{productCode}' not found in the product-config store.");
    }

    /// <summary>Mutation path: caller already holds <see cref="_gate"/> — returns the LIVE dictionary
    /// entry (not a clone) so the caller can mutate it in place before <see cref="Save"/>.</summary>
    private ProductModel RequireProductLocked(string productCode)
    {
        if (!_products.TryGetValue(productCode, out var product))
            throw new KeyNotFoundException($"Product '{productCode}' not found in the product-config store.");
        return product;
    }

    private static JsonElement ParseJson(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    // ─────────────────────────────────────────────────────────────────────
    // Seed data — realistic enough for an exhibition demo: two AOI board products (one already
    // "active" in production with a revision variant, one still in "development") and one automation
    // recipe. Deliberately includes a couple of Vietnamese-diacritic strings (descriptions/notes) so
    // the checksum/persistence round trip actually exercises non-ASCII text, not just ASCII codes.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Public so C2's <c>SimulatedEcosystem</c> (a different assembly, <c>St4i.EngineApi</c>)
    /// can start from this SAME byte-identical seed and apply its own small, deliberate divergence on
    /// top — rather than duplicating ~300 lines of seed point data a second time. Every call returns a
    /// fresh set of instances (no shared mutable state with whatever <see cref="ProductConfigStore"/>
    /// itself seeded into its own <see cref="_products"/>).</summary>
    public static List<ProductModel> SeedProducts() => new() { SeedModelA(), SeedModelB() };

    private static ProductModel SeedModelA()
    {
        var now = DateTimeOffset.UtcNow;
        const int imgW = 1600;
        const int imgH = 1200;

        var points = new List<MeasurementPoint>
        {
            new()
            {
                Code = "P01", Name = "C1 Height", Description = "Chiều cao tụ điện C1",
                MeasurementType = MeasurementType.Dimension, MeasurementTypeCode = "HEIGHT_2D", Unit = "mm",
                LowerLimit = 0.35, UpperLimit = 0.55, NominalValue = 0.45, ToleranceMode = ToleranceMode.Range,
                PositionX = 0.15 * imgW, PositionY = 0.20 * imgH, Radius = 10,
                NormalizedX = 0.15, NormalizedY = 0.20, NormalizedRadius = 0.00625,
                CropWidth = 48, CropHeight = 48, OrderIndex = 0, IsActive = true,
                Shape = PointShape.Circle,
                Lighting = new() { new() { ShotIndex = 0, Name = "Bright-field coax", LightSource = "LED_RING", Color = "white", ColorHex = "#FFFFFF", IntensityPct = 80, AngleDeg = 90, ExposureUs = 1500, Gain = 1.0, FocusOffsetUm = 0, Purpose = "height" } },
                ReferenceImageUrl = "assets/products/model-a/points/p01-c1.png",
                LastModifiedAt = now,
            },
            new()
            {
                Code = "P02", Name = "Solder Joint J3 Volume", Description = "Thể tích + độ rỗng khí mối hàn J3",
                MeasurementType = MeasurementType.Dimension, MeasurementTypeCode = "SOLDER_3D", Unit = "mm3",
                PositionX = 0.55 * imgW, PositionY = 0.25 * imgH, Radius = 14,
                NormalizedX = 0.55, NormalizedY = 0.25, NormalizedRadius = 0.00875,
                CropWidth = 64, CropHeight = 64, OrderIndex = 1, IsActive = true,
                Shape = PointShape.Ring, Geometry = ParseJson("""{"innerRadius":6,"outerRadius":14}"""),
                PositionZ = 0.8,
                HeightMin = 0.05, HeightMax = 0.25, HeightNominal = 0.15, HeightUnit = "mm",
                VolumeMin = 0.08, VolumeMax = 0.22, VolumeNominal = 0.15, VolumeUnit = "mm3",
                CoplanarityMax = 0.10, VoidPctMax = 25.0, OffsetXMax = 0.15, OffsetYMax = 0.15, TiltMax = 5.0,
                Lighting = new()
                {
                    new() { ShotIndex = 0, Name = "Bright-field", LightSource = "LED_RING", Color = "white", ColorHex = "#FFFFFF", IntensityPct = 75, AngleDeg = 90, ExposureUs = 1800, Gain = 1.0, Purpose = "shape" },
                    new() { ShotIndex = 1, Name = "Dark-field", LightSource = "LED_RING", Color = "amber", ColorHex = "#FFBF00", IntensityPct = 90, AngleDeg = 25, ExposureUs = 3200, Gain = 1.4, Purpose = "void" },
                },
                ReferenceImageUrl = "assets/products/model-a/points/p02-j3.png",
                LastModifiedAt = now,
            },
            new()
            {
                Code = "P03", Name = "Connector CN2 Offset", Description = "Sai lệch vị trí đặt connector CN2",
                MeasurementType = MeasurementType.Position, MeasurementTypeCode = "PLACEMENT_OFFSET", Unit = "mm",
                UpperLimit = 0.20, NominalValue = 0.0, ToleranceMode = ToleranceMode.MaxOnly,
                PositionX = 0.72 * imgW, PositionY = 0.55 * imgH,
                NormalizedX = 0.72, NormalizedY = 0.55,
                CropWidth = 72, CropHeight = 36, OrderIndex = 2, IsActive = true,
                Shape = PointShape.Rect, Geometry = ParseJson("""{"width":36,"height":18,"rotationDeg":0}"""),
                OffsetXMax = 0.20, OffsetYMax = 0.20,
                Lighting = new() { new() { ShotIndex = 0, Name = "Bright-field", LightSource = "LED_BAR", Color = "white", ColorHex = "#FFFFFF", IntensityPct = 70, AngleDeg = 90, ExposureUs = 1200, Gain = 1.0, Purpose = "placement" } },
                ReferenceImageUrl = "assets/products/model-a/points/p03-cn2.png",
                LastModifiedAt = now,
            },
            new()
            {
                Code = "P04", Name = "Label QR Code Presence", Description = "Kiểm tra tem QR có mặt & đọc được",
                MeasurementType = MeasurementType.Visual, MeasurementTypeCode = "LABEL_OCR",
                PositionX = 0.85 * imgW, PositionY = 0.10 * imgH,
                NormalizedX = 0.85, NormalizedY = 0.10,
                CropWidth = 100, CropHeight = 60, OrderIndex = 3, IsActive = true,
                Shape = PointShape.Rect, Geometry = ParseJson("""{"width":80,"height":40}"""),
                Criteria = ParseJson("""{"expectedPattern":"^SN-[0-9]{6}$","ocrMinConfidence":0.9,"decodeSymbology":"QR"}"""),
                Lighting = new() { new() { ShotIndex = 0, Name = "Diffuse dome", LightSource = "DOME", Color = "white", ColorHex = "#FFFFFF", IntensityPct = 60, AngleDeg = 0, ExposureUs = 900, Gain = 1.0, Purpose = "ocr" } },
                ReferenceImageUrl = "assets/products/model-a/points/p04-label.png",
                LastModifiedAt = now,
            },
            new()
            {
                Code = "P05", Name = "Resistor R5 Value", Description = "Giá trị điện trở R5",
                MeasurementType = MeasurementType.Electrical, MeasurementTypeCode = "RESISTANCE", Unit = "Ω",
                LowerLimit = 4750, UpperLimit = 5250, NominalValue = 5000, ToleranceMode = ToleranceMode.Bilateral,
                TolPlus = 250, TolMinus = 250,
                PositionX = 0.30 * imgW, PositionY = 0.70 * imgH,
                NormalizedX = 0.30, NormalizedY = 0.70,
                CropWidth = 40, CropHeight = 24, OrderIndex = 4, IsActive = true,
                Shape = PointShape.Rect,
                Lighting = new() { new() { ShotIndex = 0, Name = "Bright-field", LightSource = "LED_RING", Color = "white", ColorHex = "#FFFFFF", IntensityPct = 65, AngleDeg = 90, ExposureUs = 1100, Gain = 1.0, Purpose = "ocr" } },
                ReferenceImageUrl = "assets/products/model-a/points/p05-r5.png",
                LastModifiedAt = now,
            },
            new()
            {
                Code = "P06", Name = "LED D1 Color", Description = "Màu sắc LED báo nguồn D1",
                MeasurementType = MeasurementType.Color, MeasurementTypeCode = "COLOR_DELTA_E", Unit = "ΔE",
                UpperLimit = 3.0, ToleranceMode = ToleranceMode.MaxOnly,
                PositionX = 0.60 * imgW, PositionY = 0.80 * imgH, Radius = 6,
                NormalizedX = 0.60, NormalizedY = 0.80, NormalizedRadius = 0.00375,
                CropWidth = 24, CropHeight = 24, OrderIndex = 5, IsActive = true,
                Shape = PointShape.Circle,
                Lighting = new() { new() { ShotIndex = 0, Name = "RGB reference", LightSource = "LED_RING", Color = "white", ColorHex = "#FFFFFF", IntensityPct = 60, AngleDeg = 45, ExposureUs = 2000, Gain = 1.2, Purpose = "color" } },
                ReferenceImageUrl = "assets/products/model-a/points/p06-d1.png",
                LastModifiedAt = now,
            },
            new()
            {
                Code = "P07", Name = "Housing Surface Scratch", Description = "Vết xước bề mặt vỏ nhựa",
                MeasurementType = MeasurementType.Surface, MeasurementTypeCode = "SCRATCH_LENGTH", Unit = "mm",
                UpperLimit = 0.5, ToleranceMode = ToleranceMode.MaxOnly,
                PositionX = 0.40 * imgW, PositionY = 0.90 * imgH,
                NormalizedX = 0.40, NormalizedY = 0.90,
                CropWidth = 140, CropHeight = 110, OrderIndex = 6, IsActive = true,
                Shape = PointShape.Polygon, Geometry = ParseJson("""{"points":[[0,0],[120,0],[120,90],[0,90]]}"""),
                Lighting = new() { new() { ShotIndex = 0, Name = "Dark-field grazing", LightSource = "LED_RING", Color = "amber", ColorHex = "#FFBF00", IntensityPct = 95, AngleDeg = 15, ExposureUs = 4000, Gain = 1.6, Purpose = "surface" } },
                ReferenceImageUrl = "assets/products/model-a/points/p07-housing.png",
                LastModifiedAt = now,
            },
            new()
            {
                Code = "P08", Name = "BGA U1 Coplanarity/Void (X-ray)",
                Description = "Kiểm tra đồng phẳng & rỗng khí mối hàn BGA U1 bằng X-ray",
                MeasurementType = MeasurementType.Dimension, MeasurementTypeCode = "BGA_XRAY", Unit = "mm",
                PositionX = 0.68 * imgW, PositionY = 0.35 * imgH,
                NormalizedX = 0.68, NormalizedY = 0.35,
                CropWidth = 96, CropHeight = 96, OrderIndex = 7, IsActive = true,
                Shape = PointShape.Array,
                Cells = ParseJson("""[{"row":0,"col":0,"dx":0.00,"dy":0.00},{"row":0,"col":1,"dx":0.01,"dy":-0.01},{"row":1,"col":0,"dx":-0.01,"dy":0.02},{"row":1,"col":1,"dx":0.00,"dy":0.01}]"""),
                PositionZ = 1.2,
                HeightMin = 0.30, HeightMax = 0.55, HeightNominal = 0.42, HeightUnit = "mm",
                AreaMin = 0.15, AreaMax = 0.35, AreaNominal = 0.25, AreaUnit = "mm2",
                VolumeMin = 0.05, VolumeMax = 0.18, VolumeNominal = 0.11, VolumeUnit = "mm3",
                CoplanarityMax = 0.08, WarpageMax = 0.05, VoidPctMax = 15.0,
                OffsetXMax = 0.10, OffsetYMax = 0.10, TiltMax = 3.0,
                ThicknessMin = 0.02, ThicknessMax = 0.10,
                Criteria = ParseJson("""{"xrayRequired":true,"minBallCountDetected":9}"""),
                Lighting = new() { new() { ShotIndex = 0, Name = "X-ray oblique", LightSource = "XRAY", IntensityPct = 100, AngleDeg = 30, ExposureUs = 8000, Gain = 2.0, Purpose = "void_detection" } },
                ReferenceImageUrl = "assets/products/model-a/points/p08-u1-xray.png",
                LastModifiedAt = now,
            },
        };

        return new ProductModel
        {
            Code = "MODEL-A",
            Name = "Bo mạch điều khiển chính (Main Control Board)",
            LifecycleStatus = ProductLifecycleStatus.Active,
            ReferenceImageUrl = "assets/products/model-a-board.png",
            ImageWidth = imgW,
            ImageHeight = imgH,
            CoordinateMode = CoordinateMode.Pixel,
            PointsConfigVersion = 3,
            Fiducials = new()
            {
                new() { Code = "FID1", Name = "Top-left corner", Type = "cross", PositionX = 40, PositionY = 40, NormalizedX = 0.025, NormalizedY = 0.033, SearchWindowW = 24, SearchWindowH = 24, TemplateImageUrl = "assets/products/model-a/fid1.png", OrderIndex = 0 },
                new() { Code = "FID2", Name = "Bottom-right corner", Type = "cross", PositionX = 1560, PositionY = 1160, NormalizedX = 0.975, NormalizedY = 0.967, SearchWindowW = 24, SearchWindowH = 24, TemplateImageUrl = "assets/products/model-a/fid2.png", OrderIndex = 1 },
            },
            Variants = new()
            {
                new() { Code = "BASE", Name = "Base", IsBase = true, PointsConfigVersion = 3 },
                new()
                {
                    Code = "REV-B", Name = "Revision B - tightened resistor tolerance", IsBase = false,
                    PointsConfigVersion = 3,
                    Overrides = new()
                    {
                        new() { BasePointCode = "P05", Action = VariantOverrideAction.Override, PatchJson = ParseJson("""{"lowerLimit":4800,"upperLimit":5200}""") },
                    },
                },
            },
            Points = points,
        };
    }

    private static ProductModel SeedModelB()
    {
        var now = DateTimeOffset.UtcNow;
        const int imgW = 1200;
        const int imgH = 900;

        var points = new List<MeasurementPoint>
        {
            new()
            {
                Code = "Q01", Name = "J1 Pin Pitch", Description = "Khoảng cách chân connector J1",
                MeasurementType = MeasurementType.Dimension, MeasurementTypeCode = "PITCH_2D", Unit = "mm",
                LowerLimit = 1.95, UpperLimit = 2.05, NominalValue = 2.0, ToleranceMode = ToleranceMode.Bilateral,
                TolPlus = 0.05, TolMinus = 0.05,
                PositionX = 0.20 * imgW, PositionY = 0.15 * imgH, Radius = 8,
                NormalizedX = 0.20, NormalizedY = 0.15, NormalizedRadius = 0.00667,
                CropWidth = 40, CropHeight = 40, OrderIndex = 0, IsActive = true,
                Shape = PointShape.Circle,
                Lighting = new() { new() { ShotIndex = 0, Name = "Bright-field", LightSource = "LED_RING", Color = "white", ColorHex = "#FFFFFF", IntensityPct = 75, AngleDeg = 90, ExposureUs = 1400, Gain = 1.0, Purpose = "pitch" } },
                ReferenceImageUrl = "assets/products/model-b/points/q01-j1.png",
                LastModifiedAt = now,
            },
            new()
            {
                Code = "Q02", Name = "Fuse F1 Presence", Description = "Kiểm tra cầu chì F1 có được lắp",
                MeasurementType = MeasurementType.Visual, MeasurementTypeCode = "PRESENCE",
                PositionX = 0.55 * imgW, PositionY = 0.40 * imgH,
                NormalizedX = 0.55, NormalizedY = 0.40,
                CropWidth = 60, CropHeight = 30, OrderIndex = 1, IsActive = true,
                Shape = PointShape.Rect, Geometry = ParseJson("""{"width":50,"height":22}"""),
                Criteria = ParseJson("""{"expectPresence":true}"""),
                Lighting = new() { new() { ShotIndex = 0, Name = "Diffuse", LightSource = "DOME", Color = "white", ColorHex = "#FFFFFF", IntensityPct = 55, AngleDeg = 0, ExposureUs = 1000, Gain = 1.0, Purpose = "presence" } },
                ReferenceImageUrl = "assets/products/model-b/points/q02-f1.png",
                LastModifiedAt = now,
            },
            new()
            {
                Code = "Q03", Name = "Power Trace Width", Description = "Bề rộng đường mạch nguồn",
                MeasurementType = MeasurementType.Dimension, MeasurementTypeCode = "TRACE_WIDTH", Unit = "mm",
                LowerLimit = 0.28, UpperLimit = 0.35, NominalValue = 0.30, ToleranceMode = ToleranceMode.Range,
                PositionX = 0.35 * imgW, PositionY = 0.65 * imgH,
                NormalizedX = 0.35, NormalizedY = 0.65,
                CropWidth = 80, CropHeight = 20, OrderIndex = 2, IsActive = true,
                Shape = PointShape.Line, Geometry = ParseJson("""{"x1":380,"y1":560,"x2":460,"y2":560}"""),
                Lighting = new() { new() { ShotIndex = 0, Name = "Bright-field", LightSource = "LED_BAR", Color = "white", ColorHex = "#FFFFFF", IntensityPct = 70, AngleDeg = 90, ExposureUs = 1300, Gain = 1.0, Purpose = "width" } },
                ReferenceImageUrl = "assets/products/model-b/points/q03-trace.png",
                LastModifiedAt = now,
            },
            new()
            {
                Code = "Q04", Name = "Diode D2 Orientation", Description = "Sai lệch góc xoay diode D2",
                MeasurementType = MeasurementType.Position, MeasurementTypeCode = "ROTATION_OFFSET", Unit = "deg",
                UpperLimit = 5.0, ToleranceMode = ToleranceMode.MaxOnly,
                PositionX = 0.68 * imgW, PositionY = 0.30 * imgH,
                NormalizedX = 0.68, NormalizedY = 0.30,
                CropWidth = 36, CropHeight = 24, OrderIndex = 3, IsActive = true,
                Shape = PointShape.Rect, Geometry = ParseJson("""{"width":30,"height":18,"rotationDeg":0}"""),
                TiltMax = 5.0,
                Lighting = new() { new() { ShotIndex = 0, Name = "Bright-field", LightSource = "LED_RING", Color = "white", ColorHex = "#FFFFFF", IntensityPct = 65, AngleDeg = 90, ExposureUs = 1200, Gain = 1.0, Purpose = "orientation" } },
                ReferenceImageUrl = "assets/products/model-b/points/q04-d2.png",
                LastModifiedAt = now,
            },
            new()
            {
                Code = "Q05", Name = "Capacitor C7 Value", Description = "Giá trị tụ điện C7",
                MeasurementType = MeasurementType.Electrical, MeasurementTypeCode = "CAPACITANCE", Unit = "µF",
                LowerLimit = 9.5, UpperLimit = 10.5, NominalValue = 10.0, ToleranceMode = ToleranceMode.Bilateral,
                TolPlus = 0.5, TolMinus = 0.5,
                PositionX = 0.42 * imgW, PositionY = 0.80 * imgH,
                NormalizedX = 0.42, NormalizedY = 0.80,
                CropWidth = 44, CropHeight = 28, OrderIndex = 4, IsActive = true,
                Shape = PointShape.Rect,
                Lighting = new() { new() { ShotIndex = 0, Name = "Bright-field", LightSource = "LED_RING", Color = "white", ColorHex = "#FFFFFF", IntensityPct = 65, AngleDeg = 90, ExposureUs = 1100, Gain = 1.0, Purpose = "ocr" } },
                ReferenceImageUrl = "assets/products/model-b/points/q05-c7.png",
                LastModifiedAt = now,
            },
            new()
            {
                Code = "Q06", Name = "PCB Edge Coating", Description = "Lớp phủ bảo vệ cạnh board",
                MeasurementType = MeasurementType.Surface, MeasurementTypeCode = "COATING_GAP", Unit = "mm",
                UpperLimit = 0.3, ToleranceMode = ToleranceMode.MaxOnly,
                PositionX = 0.90 * imgW, PositionY = 0.90 * imgH,
                NormalizedX = 0.90, NormalizedY = 0.90,
                CropWidth = 100, CropHeight = 60, OrderIndex = 5, IsActive = true,
                Shape = PointShape.Polygon, Geometry = ParseJson("""{"points":[[0,0],[90,0],[90,50],[0,50]]}"""),
                Lighting = new() { new() { ShotIndex = 0, Name = "Dark-field grazing", LightSource = "LED_RING", Color = "amber", ColorHex = "#FFBF00", IntensityPct = 90, AngleDeg = 15, ExposureUs = 3600, Gain = 1.5, Purpose = "surface" } },
                ReferenceImageUrl = "assets/products/model-b/points/q06-edge.png",
                LastModifiedAt = now,
            },
        };

        return new ProductModel
        {
            Code = "MODEL-B",
            Name = "Bo mạch nguồn phụ (Power Supply Module)",
            LifecycleStatus = ProductLifecycleStatus.Development,
            ReferenceImageUrl = "assets/products/model-b-board.png",
            ImageWidth = imgW,
            ImageHeight = imgH,
            CoordinateMode = CoordinateMode.Pixel,
            PointsConfigVersion = 1,
            Fiducials = new()
            {
                new() { Code = "FID1", Name = "Top-left corner", Type = "cross", PositionX = 30, PositionY = 30, NormalizedX = 0.025, NormalizedY = 0.033, SearchWindowW = 20, SearchWindowH = 20, TemplateImageUrl = "assets/products/model-b/fid1.png", OrderIndex = 0 },
                new() { Code = "FID2", Name = "Bottom-right corner", Type = "cross", PositionX = 1170, PositionY = 870, NormalizedX = 0.975, NormalizedY = 0.967, SearchWindowW = 20, SearchWindowH = 20, TemplateImageUrl = "assets/products/model-b/fid2.png", OrderIndex = 1 },
            },
            Variants = new() { new() { Code = "BASE", Name = "Base", IsBase = true, PointsConfigVersion = 1 } },
            Points = points,
        };
    }

    /// <summary>Public for the same reason as <see cref="SeedProducts"/> — C2's <c>SimulatedEcosystem</c>
    /// starts from this exact baseline and diverges a copy of it.</summary>
    public static List<Recipe> SeedRecipes()
    {
        var recipe = new Recipe
        {
            Code = "SCREWDRIVE-M4",
            Name = "M4 screw - standard torque profile",
            MachineType = "SCREWDRIVE",
            Version = 2,
            Status = RecipeStatus.Active,
            Payload = new Dictionary<string, object?>
            {
                ["speedRpm"] = 450,
                ["angleTarget"] = 90,
                ["torqueTarget"] = 1.35,
                ["torqueTolerance"] = 0.15,
                ["torqueUnit"] = "Nm",
                ["screwCount"] = 4,
                ["clampTimeMs"] = 250,
                ["notes"] = "Chuẩn xiết vít M4 cho khung máy - kiểm tra lại nếu đổi loại vít.",
            },
        };
        recipe.RecomputeChecksum();
        return new List<Recipe> { recipe };
    }
}
