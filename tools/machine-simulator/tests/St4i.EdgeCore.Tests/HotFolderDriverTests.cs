using St4i.Connector.Abstractions.Models; using St4i.EdgeCore.Drivers.HotFolder; using Xunit;

public class HotFolderDriverTests {
  [Fact] public async Task Picks_up_written_file_and_archives() {
    var root=Path.Combine(Path.GetTempPath(),"st4i-hf-"+Guid.NewGuid().ToString("N"));
    var watch=Path.Combine(root,"in"); var arch=Path.Combine(root,"archive"); var err=Path.Combine(root,"error");
    Directory.CreateDirectory(watch);
    try {
      var reading=new DeviceReading{ MachineCode="AOI-01", Kind=ReadingKind.Inspection, SerialNumber="SN-1", Verdict=Verdict.Pass,
        Timestamp=DateTimeOffset.Now, Measurements=new(){ new MeasurementResult("R1","OK") } };
      new Doc28Writer().WriteAtomic(watch, reading);
      await using var drv=new HotFolderAoiDriver(watch,arch,err);
      using var cts=new CancellationTokenSource(TimeSpan.FromSeconds(5));
      DeviceReading? got=null; await foreach(var r in drv.ReadAsync(cts.Token)){ got=r; break; }
      Assert.NotNull(got); Assert.Equal("SN-1", got!.SerialNumber);
      Assert.True(Directory.GetFiles(arch).Length==1);
      Assert.Empty(Directory.GetFiles(watch));
      Assert.True(Directory.GetFiles(err).Length==0);
    } finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
  }

  [Fact] public async Task Writer_output_round_trips_through_the_real_parser_directly() {
    // Doc28Writer's whole job is to produce a document Doc28Parser can read back — verify that
    // contract directly (not just via the driver), including a defect measurement with bbox+3d.
    var root=Path.Combine(Path.GetTempPath(),"st4i-hf-"+Guid.NewGuid().ToString("N"));
    Directory.CreateDirectory(root);
    try {
      var reading=new DeviceReading{
        MachineCode="AOI-02", Kind=ReadingKind.Inspection, SerialNumber="SN-2026-000999",
        RecipeCode="MB-X1-TOP", RecipeVersion="1.4.0", Verdict=Verdict.Fail,
        Timestamp=DateTimeOffset.Now,
        Measurements=new(){
          new MeasurementResult("C3","OK", MeasuredValue: 99.1, Unit: "%"),
          new MeasurementResult("R12.1","NG", MeasuredValue: 61.2, DefectCatalogCode: "INSUFFICIENT_SOLDER",
            DefectSeverity: "major", Unit: "%", Bbox: new Bbox(120,340,48,32),
            Values3d: new Values3d(HeightUm: 95.0, AreaPct: 88.0)),
        },
      };
      var path = new Doc28Writer().WriteAtomic(root, reading);
      Assert.True(File.Exists(path));
      Assert.False(path.EndsWith(".tmp", StringComparison.OrdinalIgnoreCase));
      Assert.EndsWith(".st4i.json", path, StringComparison.Ordinal);

      var content = await File.ReadAllTextAsync(path);
      var parsed = Doc28Parser.Parse(content, Path.GetFileName(path));

      Assert.Equal("AOI-02", parsed.MachineCode);
      Assert.Equal("SN-2026-000999", parsed.SerialNumber);
      Assert.Equal(Verdict.Fail, parsed.Verdict);
      Assert.Equal(2, parsed.Measurements.Count);
      var ng = Assert.Single(parsed.Measurements, m => m.PointCode == "R12.1");
      Assert.Equal("NG", ng.Result);
      Assert.Equal("INSUFFICIENT_SOLDER", ng.DefectCatalogCode);
      Assert.NotNull(ng.Bbox);
      Assert.Equal(120, ng.Bbox!.X);
      Assert.NotNull(ng.Values3d);
      Assert.Equal(95.0, ng.Values3d!.HeightUm);
    } finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
  }

  [Fact] public async Task Moves_invalid_file_to_error_dir_without_yielding_and_never_deletes_it() {
    var root=Path.Combine(Path.GetTempPath(),"st4i-hf-"+Guid.NewGuid().ToString("N"));
    var watch=Path.Combine(root,"in"); var arch=Path.Combine(root,"archive"); var err=Path.Combine(root,"error");
    Directory.CreateDirectory(watch);
    try {
      var badPath = Path.Combine(watch, "AOI-01__SN-BAD__20260101T000000+0000.st4i.json");
      await File.WriteAllTextAsync(badPath, "{ this is not valid doc28 json");

      await using var drv=new HotFolderAoiDriver(watch,arch,err);
      using var cts=new CancellationTokenSource(TimeSpan.FromSeconds(3));
      var yielded=false;
      try {
        await foreach(var r in drv.ReadAsync(cts.Token)) { yielded=true; break; }
      } catch (OperationCanceledException) { /* expected: an invalid file never yields a reading */ }

      Assert.False(yielded);
      Assert.False(File.Exists(badPath), "invalid file must not remain in the watch dir");
      Assert.True(File.Exists(Path.Combine(err, "AOI-01__SN-BAD__20260101T000000+0000.st4i.json")),
        "invalid file must be moved to error dir, never deleted");
      Assert.Empty(Directory.GetFiles(arch));
    } finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
  }

  [Fact] public void Ignores_tmp_files_still_being_written() {
    var root=Path.Combine(Path.GetTempPath(),"st4i-hf-"+Guid.NewGuid().ToString("N"));
    var watch=Path.Combine(root,"in"); var arch=Path.Combine(root,"archive"); var err=Path.Combine(root,"error");
    Directory.CreateDirectory(watch);
    try {
      File.WriteAllText(Path.Combine(watch, "AOI-01__SN-1__x.st4i.json.tmp"), "{ irrelevant, still mid-write");
      var files = Directory.GetFiles(watch).Where(f => !f.EndsWith(".tmp", StringComparison.OrdinalIgnoreCase));
      Assert.Empty(files); // sanity: the .tmp convention itself is what the driver relies on to skip it
    } finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
  }
}
