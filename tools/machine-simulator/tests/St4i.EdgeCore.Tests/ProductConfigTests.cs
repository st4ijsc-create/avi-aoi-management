using System.Text.Json;
using St4i.EdgeCore.Config;
using Xunit;

/// <summary>Task C1 — EdgeCore product-config domain model + local store + versioning. Covers: a
/// maximally-populated <see cref="ProductModel"/>/<see cref="MeasurementPoint"/> round-tripping
/// through <see cref="JsonSerializer"/> without losing any field (incl. 3D/solder/x-ray/geometry/
/// criteria/lighting/tombstone); <see cref="ConfigChecksum"/> stability + key-order independence;
/// <see cref="ProductModel.BumpVersion"/>; <see cref="ProductConfigStore"/> soft-delete, CRUD, JSON
/// persistence round-trip, and seed content.</summary>
public class ProductConfigTests
{
    // ─────────────────────────────────────────────────────────────────────
    // Full-product round-trip — nothing lost.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void ProductModel_full_spec_round_trips_through_json_without_loss()
    {
        var original = BuildFullySpeccedProduct();

        var json1 = JsonSerializer.Serialize(original);
        var restored = JsonSerializer.Deserialize<ProductModel>(json1)!;
        var json2 = JsonSerializer.Serialize(restored);

        // Strongest check: re-serializing the round-tripped object produces byte-identical JSON to
        // the original serialization — if anything had been silently dropped or reshaped, this fails.
        Assert.Equal(json1, json2);

        // Targeted field checks so a future regression here fails with a readable assertion instead
        // of just a big string diff.
        Assert.Equal("MODEL-FULL", restored.Code);
        Assert.Equal(ProductLifecycleStatus.Active, restored.LifecycleStatus);
        Assert.Equal(CoordinateMode.Mm, restored.CoordinateMode);
        Assert.Equal("sha256-fake-image-hash", restored.ImageHash);
        Assert.Equal(5, restored.PointsConfigVersion);
        Assert.Single(restored.Fiducials);
        Assert.Single(restored.Variants);
        Assert.Single(restored.Variants[0].Overrides);
        Assert.Equal(VariantOverrideAction.Override, restored.Variants[0].Overrides[0].Action);
        Assert.Equal("4800", restored.Variants[0].Overrides[0].PatchJson!.Value.GetProperty("lowerLimit").GetRawText());

        var point = Assert.Single(restored.Points);
        Assert.Equal("PFULL", point.Code);
        Assert.Equal(MeasurementType.Dimension, point.MeasurementType);
        Assert.Equal("BGA_XRAY", point.MeasurementTypeCode);
        Assert.Equal("mm", point.Unit);
        Assert.Equal(0.1, point.LowerLimit);
        Assert.Equal(0.9, point.UpperLimit);
        Assert.Equal(0.5, point.NominalValue);
        Assert.Equal(ToleranceMode.Bilateral, point.ToleranceMode);
        Assert.Equal(0.05, point.TolPlus);
        Assert.Equal(0.05, point.TolMinus);
        Assert.Equal(123.4, point.PositionX);
        Assert.Equal(567.8, point.PositionY);
        Assert.Equal(12.0, point.Radius);
        Assert.Equal(0.25, point.NormalizedX);
        Assert.Equal(0.35, point.NormalizedY);
        Assert.Equal(0.01, point.NormalizedRadius);
        Assert.Equal(64, point.CropWidth);
        Assert.Equal(64, point.CropHeight);
        Assert.Equal(7, point.OrderIndex);
        Assert.False(point.IsActive);
        Assert.Equal(PointShape.Array, point.Shape);
        Assert.Equal(2, point.Geometry!.Value.GetProperty("innerRadius").GetInt32());
        Assert.Equal(4, point.Cells!.Value.GetArrayLength());

        // 3D / solder / x-ray
        Assert.Equal(1.5, point.PositionZ);
        Assert.Equal(0.1, point.HeightMin);
        Assert.Equal(0.5, point.HeightMax);
        Assert.Equal(0.3, point.HeightNominal);
        Assert.Equal("mm", point.HeightUnit);
        Assert.Equal(0.05, point.AreaMin);
        Assert.Equal(0.25, point.AreaMax);
        Assert.Equal(0.15, point.AreaNominal);
        Assert.Equal("mm2", point.AreaUnit);
        Assert.Equal(0.02, point.VolumeMin);
        Assert.Equal(0.12, point.VolumeMax);
        Assert.Equal(0.07, point.VolumeNominal);
        Assert.Equal("mm3", point.VolumeUnit);
        Assert.Equal(0.08, point.CoplanarityMax);
        Assert.Equal(0.06, point.WarpageMax);
        Assert.Equal(20.0, point.VoidPctMax);
        Assert.Equal(0.11, point.OffsetXMax);
        Assert.Equal(0.12, point.OffsetYMax);
        Assert.Equal(4.0, point.TiltMax);
        Assert.Equal(0.01, point.ThicknessMin);
        Assert.Equal(0.09, point.ThicknessMax);

        Assert.True(point.Criteria!.Value.GetProperty("xrayRequired").GetBoolean());
        Assert.Equal(2, point.Lighting.Count);
        Assert.Equal("Bright-field", point.Lighting[0].Name);
        Assert.Equal("#FFBF00", point.Lighting[1].ColorHex);
        Assert.NotNull(point.LastModifiedAt);
        Assert.Equal("assets/products/full/pfull.png", point.ReferenceImageUrl);

        // Soft-delete tombstone must round-trip too.
        Assert.NotNull(point.DeletedAt);
        Assert.Equal(6, point.DeletedAtVersion);
        Assert.True(point.IsDeleted);

        // Vietnamese diacritics in Description must survive byte-for-byte.
        Assert.Equal("Kiểm tra đồng phẳng & rỗng khí mối hàn BGA bằng X-ray", point.Description);
    }

    private static ProductModel BuildFullySpeccedProduct()
    {
        var point = new MeasurementPoint
        {
            Code = "PFULL",
            Name = "Fully specced point",
            Description = "Kiểm tra đồng phẳng & rỗng khí mối hàn BGA bằng X-ray",
            MeasurementType = MeasurementType.Dimension,
            MeasurementTypeCode = "BGA_XRAY",
            Unit = "mm",
            LowerLimit = 0.1,
            UpperLimit = 0.9,
            NominalValue = 0.5,
            ToleranceMode = ToleranceMode.Bilateral,
            TolPlus = 0.05,
            TolMinus = 0.05,
            PositionX = 123.4,
            PositionY = 567.8,
            Radius = 12.0,
            NormalizedX = 0.25,
            NormalizedY = 0.35,
            NormalizedRadius = 0.01,
            CropWidth = 64,
            CropHeight = 64,
            OrderIndex = 7,
            IsActive = false,
            Shape = PointShape.Array,
            Geometry = JsonDocument.Parse("""{"innerRadius":2,"outerRadius":9}""").RootElement.Clone(),
            Cells = JsonDocument.Parse("""[{"row":0,"col":0},{"row":0,"col":1},{"row":1,"col":0},{"row":1,"col":1}]""").RootElement.Clone(),
            PositionZ = 1.5,
            HeightMin = 0.1,
            HeightMax = 0.5,
            HeightNominal = 0.3,
            HeightUnit = "mm",
            AreaMin = 0.05,
            AreaMax = 0.25,
            AreaNominal = 0.15,
            AreaUnit = "mm2",
            VolumeMin = 0.02,
            VolumeMax = 0.12,
            VolumeNominal = 0.07,
            VolumeUnit = "mm3",
            CoplanarityMax = 0.08,
            WarpageMax = 0.06,
            VoidPctMax = 20.0,
            OffsetXMax = 0.11,
            OffsetYMax = 0.12,
            TiltMax = 4.0,
            ThicknessMin = 0.01,
            ThicknessMax = 0.09,
            Criteria = JsonDocument.Parse("""{"xrayRequired":true,"minBallCountDetected":4}""").RootElement.Clone(),
            Lighting = new()
            {
                new() { ShotIndex = 0, Name = "Bright-field", LightSource = "LED_RING", Color = "white", ColorHex = "#FFFFFF", IntensityPct = 80, AngleDeg = 90, ExposureUs = 1500, Gain = 1.0, FocusOffsetUm = 0, OpticalFilter = "polarizer", Purpose = "shape" },
                new() { ShotIndex = 1, Name = "Dark-field", LightSource = "LED_RING", Color = "amber", ColorHex = "#FFBF00", IntensityPct = 95, AngleDeg = 20, ExposureUs = 3500, Gain = 1.5, FocusOffsetUm = 10, OpticalFilter = null, Purpose = "void" },
            },
            LastModifiedAt = new DateTimeOffset(2026, 7, 1, 8, 30, 0, TimeSpan.Zero),
            ReferenceImageUrl = "assets/products/full/pfull.png",
            DeletedAt = new DateTimeOffset(2026, 7, 15, 9, 0, 0, TimeSpan.Zero),
            DeletedAtVersion = 6,
        };

        return new ProductModel
        {
            Code = "MODEL-FULL",
            Name = "Fully specced product",
            LifecycleStatus = ProductLifecycleStatus.Active,
            ReferenceImageUrl = "assets/products/full-board.png",
            ImageWidth = 2000,
            ImageHeight = 1500,
            ImageHash = "sha256-fake-image-hash",
            CoordinateMode = CoordinateMode.Mm,
            PointsConfigVersion = 5,
            Fiducials = new()
            {
                new() { Code = "FID1", Name = "Top-left", Type = "cross", PositionX = 10, PositionY = 10, NormalizedX = 0.01, NormalizedY = 0.01, SearchWindowW = 20, SearchWindowH = 20, TemplateImageUrl = "assets/full/fid1.png", OrderIndex = 0 },
            },
            Variants = new()
            {
                new()
                {
                    Code = "REV-X", Name = "Revision X", IsBase = false, PointsConfigVersion = 5,
                    ReferenceImageUrl = "assets/full/rev-x.png", CoordinateMode = CoordinateMode.Pixel,
                    Overrides = new()
                    {
                        new() { BasePointCode = "PFULL", Action = VariantOverrideAction.Override, PatchJson = JsonDocument.Parse("""{"lowerLimit":4800}""").RootElement.Clone() },
                    },
                },
            },
            Points = new() { point },
        };
    }

    // ─────────────────────────────────────────────────────────────────────
    // ConfigChecksum — stable + key-order independent.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void ConfigChecksum_is_order_independent_for_the_same_payload()
    {
        var a = new Dictionary<string, object?>
        {
            ["speedRpm"] = 450,
            ["torqueTarget"] = 1.35,
            ["notes"] = "Chuẩn xiết vít",
            ["nested"] = new Dictionary<string, object?> { ["x"] = 1, ["y"] = 2 },
        };
        var b = new Dictionary<string, object?>
        {
            ["nested"] = new Dictionary<string, object?> { ["y"] = 2, ["x"] = 1 },
            ["notes"] = "Chuẩn xiết vít",
            ["torqueTarget"] = 1.35,
            ["speedRpm"] = 450,
        };

        Assert.Equal(ConfigChecksum.Compute(a), ConfigChecksum.Compute(b));
    }

    [Fact]
    public void ConfigChecksum_changes_when_a_value_changes()
    {
        var a = new Dictionary<string, object?> { ["torqueTarget"] = 1.35 };
        var b = new Dictionary<string, object?> { ["torqueTarget"] = 1.40 };

        Assert.NotEqual(ConfigChecksum.Compute(a), ConfigChecksum.Compute(b));
    }

    [Fact]
    public void ConfigChecksum_is_deterministic_across_repeated_calls()
    {
        var payload = new Dictionary<string, object?> { ["a"] = 1, ["b"] = new[] { 1, 2, 3 } };

        var first = ConfigChecksum.Compute(payload);
        var second = ConfigChecksum.Compute(payload);

        Assert.Equal(first, second);
        Assert.Equal(64, first.Length); // sha256 hex
        Assert.Equal(first, first.ToLowerInvariant()); // lowercase hex, matches node's digest('hex')
    }

    [Fact]
    public void ConfigChecksum_accepts_a_JsonElement_directly()
    {
        var el = JsonDocument.Parse("""{"b":2,"a":1}""").RootElement;
        var elReordered = JsonDocument.Parse("""{"a":1,"b":2}""").RootElement;

        Assert.Equal(ConfigChecksum.Compute(el), ConfigChecksum.Compute(elReordered));
    }

    // ─────────────────────────────────────────────────────────────────────
    // ConfigChecksum.ComputePointsChecksum (Task C8) — the content-checksum drift key.
    // ─────────────────────────────────────────────────────────────────────

    private static MeasurementPoint MakePoint(string code, double lowerLimit, DateTimeOffset? lastModifiedAt = null) => new()
    {
        Code = code,
        Name = $"Point {code}",
        MeasurementType = MeasurementType.Dimension,
        Unit = "mm",
        LowerLimit = lowerLimit,
        UpperLimit = lowerLimit + 1,
        PositionX = 10,
        PositionY = 20,
        OrderIndex = 0,
        IsActive = true,
        LastModifiedAt = lastModifiedAt ?? DateTimeOffset.UtcNow,
    };

    [Fact]
    public void ComputePointsChecksum_is_order_independent()
    {
        var a = new List<MeasurementPoint> { MakePoint("P01", 1), MakePoint("P02", 2) };
        var b = new List<MeasurementPoint> { MakePoint("P02", 2), MakePoint("P01", 1) };

        Assert.Equal(ConfigChecksum.ComputePointsChecksum(a), ConfigChecksum.ComputePointsChecksum(b));
    }

    [Fact]
    public void ComputePointsChecksum_ignores_LastModifiedAt()
    {
        var a = new List<MeasurementPoint> { MakePoint("P01", 1, DateTimeOffset.UtcNow) };
        var b = new List<MeasurementPoint> { MakePoint("P01", 1, DateTimeOffset.UtcNow.AddDays(-30)) };

        // Same spec content, different edit timestamps — a no-op re-save or a resurrect-by-repush must
        // NOT look like drift.
        Assert.Equal(ConfigChecksum.ComputePointsChecksum(a), ConfigChecksum.ComputePointsChecksum(b));
    }

    [Fact]
    public void ComputePointsChecksum_changes_when_a_spec_field_changes()
    {
        var a = new List<MeasurementPoint> { MakePoint("P01", 1) };
        var b = new List<MeasurementPoint> { MakePoint("P01", 1.5) }; // different lowerLimit

        Assert.NotEqual(ConfigChecksum.ComputePointsChecksum(a), ConfigChecksum.ComputePointsChecksum(b));
    }

    [Fact]
    public void ComputePointsChecksum_excludes_tombstoned_points()
    {
        var active = MakePoint("P01", 1);
        var tombstoned = MakePoint("P02", 2);
        tombstoned.DeletedAt = DateTimeOffset.UtcNow;
        tombstoned.DeletedAtVersion = 7;

        var withTombstone = new List<MeasurementPoint> { active, tombstoned };
        var withoutTombstone = new List<MeasurementPoint> { active };

        // A tombstoned point contributes nothing — the checksum is over ACTIVE points only, matching
        // ProductModel.ActivePoints.
        Assert.Equal(ConfigChecksum.ComputePointsChecksum(withTombstone), ConfigChecksum.ComputePointsChecksum(withoutTombstone));
    }

    [Fact]
    public void ComputePointsChecksum_is_deterministic_and_looks_like_a_sha256_hex_digest()
    {
        var points = new List<MeasurementPoint> { MakePoint("P01", 1), MakePoint("P02", 2) };

        var first = ConfigChecksum.ComputePointsChecksum(points);
        var second = ConfigChecksum.ComputePointsChecksum(points);

        Assert.Equal(first, second);
        Assert.Equal(64, first.Length);
        Assert.Equal(first, first.ToLowerInvariant());
    }

    [Fact]
    public void ComputePointsChecksum_of_an_empty_set_is_stable()
    {
        Assert.Equal(ConfigChecksum.ComputePointsChecksum(new List<MeasurementPoint>()), ConfigChecksum.ComputePointsChecksum(new List<MeasurementPoint>()));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Task review #1/#2 — ConfigChecksum.CanonicalizePoint / PointContentEquals, the shared
    // canonicalization the field-level diff (ConfigSyncEngine.DiffFields) and the no-op-push detection
    // (SimulatedEcosystem.SyncPointsAsync) both build on.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void CanonicalizePoint_includes_full_spec_fields_the_old_hand_written_diff_list_omitted()
    {
        var point = BuildFullySpeccedProduct().Points[0]; // PFULL — every 3D/solder/x-ray/tolerance field set
        var canonical = ConfigChecksum.CanonicalizePoint(point);

        // A representative sample of fields the PRE-fix DiffFields (~13 hand-picked Cmp calls) did NOT
        // compare at all — these must be part of the canonical field set now, or the diff/checksum could
        // disagree again.
        foreach (var field in new[]
        {
            "Unit", "MeasurementType", "MeasurementTypeCode", "ToleranceMode", "TolPlus", "TolMinus",
            "Radius", "NormalizedRadius", "CropWidth", "CropHeight", "OrderIndex", "PositionZ",
            "HeightMin", "HeightMax", "HeightNominal", "HeightUnit",
            "AreaMin", "AreaMax", "AreaNominal", "AreaUnit",
            "VolumeMin", "VolumeMax", "VolumeNominal", "VolumeUnit",
            "CoplanarityMax", "WarpageMax", "VoidPctMax", "OffsetXMax", "OffsetYMax", "TiltMax",
            "ThicknessMin", "ThicknessMax", "Criteria", "Lighting", "Cells",
        })
        {
            Assert.True(canonical.ContainsKey(field), $"expected canonical field set to include '{field}'");
        }
    }

    [Fact]
    public void CanonicalizePoint_strips_the_audit_fields_ComputePointsChecksum_also_strips()
    {
        var point = BuildFullySpeccedProduct().Points[0];
        var canonical = ConfigChecksum.CanonicalizePoint(point);

        Assert.False(canonical.ContainsKey("LastModifiedAt"));
        Assert.False(canonical.ContainsKey("DeletedAt"));
        Assert.False(canonical.ContainsKey("DeletedAtVersion"));
    }

    [Fact]
    public void PointContentEquals_is_true_for_identical_spec_content_with_only_LastModifiedAt_differing()
    {
        var a = MakePoint("P01", 1, DateTimeOffset.UtcNow);
        var b = MakePoint("P01", 1, DateTimeOffset.UtcNow.AddDays(-30));

        // A push merge always refreshes LastModifiedAt to "now" even on a genuine no-op — that alone
        // must never make PointContentEquals report a change (else EVERY re-push would look like an
        // update, defeating the whole point of the review #2 fix).
        Assert.True(ConfigChecksum.PointContentEquals(a, b));
    }

    [Fact]
    public void PointContentEquals_is_false_when_a_spec_field_differs()
    {
        var a = MakePoint("P01", 1);
        var b = MakePoint("P01", 1.5); // different lowerLimit

        Assert.False(ConfigChecksum.PointContentEquals(a, b));
    }

    [Fact]
    public void PointContentEquals_is_false_across_a_tombstone_resurrection()
    {
        var stillTombstoned = MakePoint("P01", 1);
        stillTombstoned.DeletedAt = DateTimeOffset.UtcNow;
        stillTombstoned.DeletedAtVersion = 5;

        var resurrected = MakePoint("P01", 1); // same spec content, no tombstone

        // Unlike ComputePointsChecksum (which deliberately excludes DeletedAt/DeletedAtVersion as
        // "audit" — see ComputePointsChecksum_excludes_tombstoned_points above — so a resurrection never
        // looks like drift there), PointContentEquals treats resurrecting a tombstoned point as a REAL,
        // observable change: a push doing this should count toward PointsUpdated/BumpVersion, not be
        // silently treated as a no-op. The two comparisons deliberately use different audit-field
        // boundaries for exactly this reason (see ConfigChecksum.PointContentEquals's own doc comment).
        Assert.False(ConfigChecksum.PointContentEquals(stillTombstoned, resurrected));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Version bump.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void ProductModel_BumpVersion_increments_PointsConfigVersion()
    {
        var product = new ProductModel { Code = "X", Name = "X", PointsConfigVersion = 3 };
        product.BumpVersion();
        Assert.Equal(4, product.PointsConfigVersion);
    }

    [Fact]
    public void Recipe_BumpVersion_increments_Version()
    {
        var recipe = new Recipe { Code = "R1", Name = "R1", Version = 1 };
        recipe.BumpVersion();
        Assert.Equal(2, recipe.Version);
    }

    [Fact]
    public void Recipe_RecomputeChecksum_matches_ConfigChecksum_of_its_payload()
    {
        var recipe = new Recipe { Code = "R1", Name = "R1", Payload = new() { ["speedRpm"] = 300 } };
        var checksum = recipe.RecomputeChecksum();
        Assert.Equal(ConfigChecksum.Compute(recipe.Payload), checksum);
        Assert.Equal(checksum, recipe.Checksum);
    }

    // ─────────────────────────────────────────────────────────────────────
    // ProductConfigStore — soft-delete, CRUD, persistence round-trip, seed.
    // ─────────────────────────────────────────────────────────────────────

    private static string TempDir() => Directory.CreateTempSubdirectory("st4i-product-config-tests-").FullName;

    [Fact]
    public void Store_soft_delete_tombstones_a_point_and_excludes_it_from_active_points()
    {
        var store = new ProductConfigStore(TempDir());
        var before = store.GetActivePoints("MODEL-A").Count;

        var deleted = store.SoftDeletePoint("MODEL-A", "P04");

        Assert.True(deleted);
        var active = store.GetActivePoints("MODEL-A");
        var all = store.GetAllPoints("MODEL-A");
        Assert.Equal(before - 1, active.Count);
        Assert.DoesNotContain(active, p => p.Code == "P04");

        var tombstone = Assert.Single(all, p => p.Code == "P04");
        Assert.True(tombstone.IsDeleted);
        Assert.NotNull(tombstone.DeletedAt);
        Assert.NotNull(tombstone.DeletedAtVersion);
    }

    [Fact]
    public void Store_soft_delete_bumps_the_product_version_and_is_idempotent_on_repeat()
    {
        var store = new ProductConfigStore(TempDir());
        var versionBefore = store.GetProduct("MODEL-A")!.PointsConfigVersion;

        var firstDelete = store.SoftDeletePoint("MODEL-A", "P07");
        var versionAfter = store.GetProduct("MODEL-A")!.PointsConfigVersion;
        var secondDelete = store.SoftDeletePoint("MODEL-A", "P07"); // already deleted -> no-op

        Assert.True(firstDelete);
        Assert.Equal(versionBefore + 1, versionAfter);
        Assert.False(secondDelete);
        Assert.Equal(versionAfter, store.GetProduct("MODEL-A")!.PointsConfigVersion);
    }

    [Fact]
    public void Store_UpsertPoint_bumps_version_and_persists()
    {
        var store = new ProductConfigStore(TempDir());
        var versionBefore = store.GetProduct("MODEL-B")!.PointsConfigVersion;

        var newPoint = new MeasurementPoint
        {
            Code = "Q99", Name = "New Point", MeasurementType = MeasurementType.Visual,
            PositionX = 10, PositionY = 10, OrderIndex = 99,
        };
        store.UpsertPoint("MODEL-B", newPoint);

        var product = store.GetProduct("MODEL-B")!;
        Assert.Equal(versionBefore + 1, product.PointsConfigVersion);
        Assert.Contains(product.Points, p => p.Code == "Q99");
        Assert.NotNull(product.Points.First(p => p.Code == "Q99").LastModifiedAt);
    }

    [Fact]
    public void Store_CRUD_and_JSON_persistence_round_trips_through_a_fresh_instance()
    {
        var dir = TempDir();
        var store1 = new ProductConfigStore(dir);

        var product = new ProductModel
        {
            Code = "CUSTOM-1",
            Name = "Custom product",
            LifecycleStatus = ProductLifecycleStatus.Development,
            ImageWidth = 800,
            ImageHeight = 600,
            CoordinateMode = CoordinateMode.Mm,
            PointsConfigVersion = 1,
        };
        store1.UpsertProduct(product);
        store1.UpsertPoint("CUSTOM-1", new MeasurementPoint
        {
            Code = "CP1", Name = "Custom point", MeasurementType = MeasurementType.Electrical,
            LowerLimit = 1.0, UpperLimit = 2.0, ToleranceMode = ToleranceMode.Range,
            PositionX = 5, PositionY = 5, OrderIndex = 0,
            Lighting = new() { new() { ShotIndex = 0, Name = "Test shot" } },
        });

        var recipe = new Recipe
        {
            Code = "CUSTOM-RECIPE",
            Name = "Custom recipe",
            MachineType = "DISPENSING",
            Version = 1,
            Payload = new() { ["flowRateMlMin"] = 12.5 },
        };
        store1.UpsertRecipe(recipe);

        // Brand-new store instance pointed at the SAME directory — must load exactly what store1
        // persisted, not reseed (the files now exist).
        var store2 = new ProductConfigStore(dir);

        var reloadedProduct = store2.GetProduct("CUSTOM-1");
        Assert.NotNull(reloadedProduct);
        Assert.Equal("Custom product", reloadedProduct!.Name);
        Assert.Equal(CoordinateMode.Mm, reloadedProduct.CoordinateMode);
        var reloadedPoint = Assert.Single(reloadedProduct.Points, p => p.Code == "CP1");
        Assert.Equal(1.0, reloadedPoint.LowerLimit);
        Assert.Equal(ToleranceMode.Range, reloadedPoint.ToleranceMode);
        Assert.Single(reloadedPoint.Lighting);

        var reloadedRecipe = store2.GetRecipe("CUSTOM-RECIPE");
        Assert.NotNull(reloadedRecipe);
        Assert.Equal("DISPENSING", reloadedRecipe!.MachineType);
        Assert.Equal(ConfigChecksum.Compute(reloadedRecipe.Payload), reloadedRecipe.Checksum);

        // The seed products/recipe are still there too (store2 loaded the whole file, not just what
        // store1 explicitly upserted in this test).
        Assert.Contains(store2.ListProducts(), p => p.Code == "MODEL-A");
        Assert.Contains(store2.ListProducts(), p => p.Code == "MODEL-B");
        Assert.Contains(store2.ListRecipes(), r => r.Code == "SCREWDRIVE-M4");
    }

    // ─────────────────────────────────────────────────────────────────────
    // Task review #6 — atomic persistence (temp-write + rename, not File.WriteAllText in place).
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Store_Save_leaves_no_leftover_temp_file_and_a_fresh_instance_still_reloads_everything()
    {
        var dir = TempDir();
        var store1 = new ProductConfigStore(dir);

        // Several mutations -> several Save() calls, each going through the temp-write-then-rename path.
        store1.UpsertPoint("MODEL-A", new MeasurementPoint
        {
            Code = "ATOMIC-1", Name = "Atomic write check", MeasurementType = MeasurementType.Visual,
            PositionX = 1, PositionY = 1, OrderIndex = 50,
        });
        store1.SoftDeletePoint("MODEL-A", "ATOMIC-1");
        store1.UpsertRecipe(new Recipe { Code = "ATOMIC-RECIPE", Name = "Atomic recipe", Payload = new() { ["x"] = 1 } });

        // The atomic-write helper's temp file is named "<target>.tmp-<guid>" (never ends in ".json") and
        // is renamed away immediately — none should survive to be visible on disk after Save() returns.
        var leftoverTempFiles = Directory.GetFiles(dir, "*.tmp-*");
        Assert.Empty(leftoverTempFiles);
        Assert.True(File.Exists(Path.Combine(dir, "products.json")));
        Assert.True(File.Exists(Path.Combine(dir, "recipes.json")));

        // A crash-mid-write would have left a truncated file that fails THIS reload — round-tripping
        // cleanly through a fresh instance is the actual behavioral guarantee the atomic write protects.
        var store2 = new ProductConfigStore(dir);
        var reloadedPoint = store2.GetAllPoints("MODEL-A").Single(p => p.Code == "ATOMIC-1");
        Assert.True(reloadedPoint.IsDeleted);
        Assert.NotNull(store2.GetRecipe("ATOMIC-RECIPE"));
    }

    [Fact]
    public void Store_Save_reload_survives_many_rapid_sequential_writes()
    {
        // Not a concurrency stress test (the store's own coarse lock already guarantees no torn READS
        // in-process) — this is about the atomic-write MECHANISM itself surviving many temp-file
        // create/rename cycles in the same directory without ever leaving a stray/renamed-over file
        // behind, which would indicate a filename collision or an unhandled rename failure.
        var dir = TempDir();
        var store = new ProductConfigStore(dir);

        for (var i = 0; i < 25; i++)
        {
            store.UpsertPoint("MODEL-B", new MeasurementPoint
            {
                Code = $"RAPID-{i}", Name = $"Rapid {i}", MeasurementType = MeasurementType.Visual,
                PositionX = i, PositionY = i, OrderIndex = 100 + i,
            });
        }

        Assert.Empty(Directory.GetFiles(dir, "*.tmp-*"));
        var reloaded = new ProductConfigStore(dir);
        Assert.Equal(25, reloaded.GetAllPoints("MODEL-B").Count(p => p.Code.StartsWith("RAPID-")));
    }

    [Fact]
    public void Store_DeleteProduct_and_DeleteRecipe_remove_and_report_correctly()
    {
        var store = new ProductConfigStore(TempDir());

        Assert.True(store.DeleteProduct("MODEL-B"));
        Assert.False(store.DeleteProduct("MODEL-B")); // already gone
        Assert.Null(store.GetProduct("MODEL-B"));

        Assert.True(store.DeleteRecipe("SCREWDRIVE-M4"));
        Assert.False(store.DeleteRecipe("SCREWDRIVE-M4"));
        Assert.Null(store.GetRecipe("SCREWDRIVE-M4"));
    }

    [Fact]
    public void Store_returns_deep_clones_not_live_references()
    {
        var store = new ProductConfigStore(TempDir());

        var a = store.GetProduct("MODEL-A")!;
        a.Name = "MUTATED LOCALLY";
        a.Points.Clear();

        var b = store.GetProduct("MODEL-A")!;
        Assert.NotEqual("MUTATED LOCALLY", b.Name);
        Assert.NotEmpty(b.Points);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Seed content — believable exhibition demo data.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Seed_loads_the_expected_products_and_recipe()
    {
        var store = new ProductConfigStore(TempDir());

        var products = store.ListProducts();
        Assert.Equal(2, products.Count);

        var modelA = store.GetProduct("MODEL-A");
        Assert.NotNull(modelA);
        Assert.Equal(ProductLifecycleStatus.Active, modelA!.LifecycleStatus);
        Assert.Equal(8, modelA.Points.Count);
        Assert.Equal(2, modelA.Fiducials.Count);
        Assert.Equal(2, modelA.Variants.Count);
        Assert.Contains(modelA.Points, p => p.MeasurementType == MeasurementType.Dimension);
        Assert.Contains(modelA.Points, p => p.MeasurementType == MeasurementType.Electrical);
        Assert.Contains(modelA.Points, p => p.MeasurementType == MeasurementType.Visual);
        Assert.Contains(modelA.Points, p => p.MeasurementType == MeasurementType.Color);
        Assert.Contains(modelA.Points, p => p.MeasurementType == MeasurementType.Surface);
        Assert.Contains(modelA.Points, p => p.MeasurementType == MeasurementType.Position);
        // At least one point carries real 3D/solder/x-ray spec, per Task C1's "FULL depth" seed ask.
        Assert.Contains(modelA.Points, p => p.HeightMin.HasValue && p.VolumeMin.HasValue && p.CoplanarityMax.HasValue);

        var modelB = store.GetProduct("MODEL-B");
        Assert.NotNull(modelB);
        Assert.Equal(ProductLifecycleStatus.Development, modelB!.LifecycleStatus);
        Assert.Equal(6, modelB.Points.Count);

        var recipes = store.ListRecipes();
        var recipe = Assert.Single(recipes);
        Assert.Equal("SCREWDRIVE-M4", recipe.Code);
        Assert.Equal("SCREWDRIVE", recipe.MachineType);
        Assert.Equal(RecipeStatus.Active, recipe.Status);
        Assert.True(recipe.Payload.ContainsKey("torqueTarget"));
        Assert.True(recipe.Payload.ContainsKey("speedRpm"));
        Assert.False(string.IsNullOrEmpty(recipe.Checksum));
        Assert.Equal(64, recipe.Checksum!.Length);
    }

    [Fact]
    public void Seed_wire_shape_uses_the_contract_enum_vocabulary()
    {
        var store = new ProductConfigStore(TempDir());
        var modelA = store.GetProduct("MODEL-A")!;
        var json = JsonSerializer.Serialize(modelA);

        // lower_snake_case for toleranceMode/shape/lifecycleStatus/coordinateMode.
        Assert.Contains("\"active\"", json);
        Assert.Contains("\"pixel\"", json);
        Assert.Contains("\"range\"", json);
        Assert.Contains("\"bilateral\"", json);
        Assert.Contains("\"circle\"", json);
        // UPPER_SNAKE_CASE for measurementType.
        Assert.Contains("\"DIMENSION\"", json);
        Assert.Contains("\"ELECTRICAL\"", json);
    }
}
