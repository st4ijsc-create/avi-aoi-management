using St4i.EdgeCore.Models; using St4i.EdgeCore.Mapping; using Xunit;
public class NormalizerTests {
  [Fact] public void IdempotencyKey_is_stable_and_min_8() {
    var r = new DeviceReading{ MachineCode="SCRW-01", RecipeCode="RC1", CycleCounter=1, Kind=ReadingKind.ProcessResult, SerialNumber="SN1", StepType="screw_tightening" };
    var k = Normalizer.BuildIdempotencyKey(r);
    Assert.Equal("SCRW-01:RC1:000001", k);
    Assert.True(k.Length >= 8);
  }
  [Fact] public void Process_reading_maps_to_process_result_path_with_numeric_value() {
    var r = new DeviceReading{ MachineCode="SCRW-01", Kind=ReadingKind.ProcessResult, SerialNumber="SN1",
      StepType="screw_tightening", Verdict=Verdict.Pass, RecipeCode="RC1", CycleCounter=2,
      Timestamp=DateTimeOffset.Parse("2026-07-18T10:00:00+07:00"),
      Metrics=new(){ new MetricSample("torque",12.1,"Nm",10.5,13.5,12.0) } };
    var env = Normalizer.Normalize(r, MappingProfile.ForClass(DeviceClass.Automation));
    Assert.Equal("/api/v1/ingest/process-result", env.Path);
    Assert.Equal(ReadingKind.ProcessResult, env.Kind);
    Assert.Equal("pass", env.Payload["result"]);
    var metrics = (System.Collections.IEnumerable)env.Payload["metrics"];
    Assert.NotNull(metrics);
  }
  [Fact] public void Inspection_reading_uppercases_overallResult() {
    var r = new DeviceReading{ MachineCode="AOI-01", Kind=ReadingKind.Inspection, SerialNumber="SN1",
      Verdict=Verdict.Fail, CycleCounter=1, Timestamp=DateTimeOffset.Parse("2026-07-18T10:00:00+07:00"),
      Measurements=new(){ new MeasurementResult("R12","NG",DefectCatalogCode:"BRIDGING") } };
    var env = Normalizer.Normalize(r, MappingProfile.ForClass(DeviceClass.AoiAvi));
    Assert.Equal("/api/v1/ingest/inspection", env.Path);
    Assert.Equal("NG", env.Payload["overallResult"]);
  }
}
