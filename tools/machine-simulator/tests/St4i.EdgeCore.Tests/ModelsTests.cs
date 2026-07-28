using St4i.Connector.Abstractions.Models; using Xunit;
public class ModelsTests {
  [Fact] public void Can_build_a_process_reading() {
    var r = new DeviceReading { MachineCode="SCRW-01", Kind=ReadingKind.ProcessResult,
      SerialNumber="SN1", StepType="screw_tightening", Verdict=Verdict.Pass,
      Metrics=new(){ new MetricSample("torque",12.1,"Nm",10.5,13.5,12.0) }, CycleCounter=1 };
    Assert.Equal(ReadingKind.ProcessResult, r.Kind);
    Assert.Single(r.Metrics);
  }
}
