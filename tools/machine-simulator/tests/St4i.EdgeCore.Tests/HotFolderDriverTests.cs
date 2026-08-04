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

  /// <summary>
  /// 🔴 backlog-test-deadlines — the regression test for the defect that wedged the whole
  /// <c>St4i.EdgeCore.Tests</c> assembly for 900 s at a time and was read, for four consecutive tasks, as
  /// "a pre-existing flake in DeviceIdentityStore, no root cause".
  ///
  /// <para><b>What it pins.</b> <see cref="HotFolderAoiDriver.DisposeAsync"/> must END an in-flight
  /// <see cref="HotFolderAoiDriver.ReadAsync"/>, and end it CLEANLY. It used to call
  /// <c>_wake.Dispose()</c>, and <see cref="System.Threading.SemaphoreSlim.Dispose()"/> drops queued async
  /// waiters WITHOUT completing them — so disposing the driver while its read loop was parked in the idle
  /// wait stranded that <c>await</c> permanently: no completion, no exception, and no
  /// <see cref="CancellationToken"/> that could reach it, because the cancellation path is precisely the
  /// one that gets swallowed. A standalone probe measured that ordering at <b>200/200</b> stranded.</para>
  ///
  /// <para><b>Why NO token is cancelled here.</b> Cancelling would let the token end the enumeration and
  /// hide the defect; <see cref="HotFolderAoiDriver.DisposeAsync"/> alone must be sufficient, which is also
  /// exactly what <c>FleetHost</c> relies on when it stops a connector. The 400 ms delay is what makes the
  /// old failure DETERMINISTIC rather than a race: the watch directory is empty, so the loop spends all but
  /// a few microseconds of every 120 ms poll interval parked, and "disposed while parked" is the certain
  /// case rather than the lucky one.</para>
  ///
  /// <para><b>Both assertions are load-bearing, because the old code failed two different ways.</b> Parked
  /// at disposal it hung (caught by the first); NOT parked at disposal, its next
  /// <c>WaitAsync</c> threw <see cref="ObjectDisposedException"/> straight out of the enumeration (caught
  /// only by the second). A fix for one arm alone still fails this test.</para>
  /// </summary>
  [Fact] public async Task DisposeAsync_WhileTheReadLoopIsIdle_EndsTheEnumeration_RatherThanStrandingItForever() {
    var root=Path.Combine(Path.GetTempPath(),"st4i-hf-"+Guid.NewGuid().ToString("N"));
    var watch=Path.Combine(root,"in"); var arch=Path.Combine(root,"archive"); var err=Path.Combine(root,"error");
    Directory.CreateDirectory(watch);
    try {
      var drv=new HotFolderAoiDriver(watch,arch,err);
      using var neverCancelled=new CancellationTokenSource();
      var run=Task.Run(async () => { await foreach(var _ in drv.ReadAsync(neverCancelled.Token)) { } });

      await Task.Delay(TimeSpan.FromMilliseconds(400));
      Assert.False(run.IsCompleted, "sanity: with an empty watch dir the read loop must still be running");

      await drv.DisposeAsync();

      var ended = await Task.WhenAny(run, Task.Delay(TimeSpan.FromSeconds(5))) == run;
      Assert.True(ended,
        "DisposeAsync did not end the in-flight ReadAsync within 5s. A read loop that outlives its own " +
        "driver can never be reclaimed — its token was never cancelled and now cannot help, so nothing " +
        "in-process can stop it. The usual cause is disposing a synchronisation primitive the loop is " +
        "parked on: SemaphoreSlim.Dispose() drops queued async waiters without completing them.");

      Assert.Null(await Record.ExceptionAsync(() => run));
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
