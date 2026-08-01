using St4i.Connector.Abstractions.Models; using St4i.EdgeCore.Drivers.HotFolder; using Xunit;
public class Doc28ParserTests {
  const string OkJson = @"{""spec_version"":1,""header"":{""machine_code"":""AOI-01"",""serial_number"":""SN-1"",""program_name"":""MB-X1"",""started_at"":""2026-07-18T08:30:00+07:00"",""finished_at"":""2026-07-18T08:30:12+07:00"",""result"":""NG""},""measurements"":[{""point_name"":""R12"",""result"":""NG"",""defect_code"":""BRIDGING""}]}";
  [Fact] public void Parses_valid_json() {
    var r = Doc28Parser.Parse(OkJson, "AOI-01__SN-1__x.st4i.json");
    Assert.Equal(ReadingKind.Inspection, r.Kind);
    Assert.Equal("SN-1", r.SerialNumber); Assert.Equal(Verdict.Fail, r.Verdict);
    Assert.Single(r.Measurements);
  }
  [Fact] public void Rejects_offsetless_timestamp() {
    var bad = OkJson.Replace("2026-07-18T08:30:12+07:00","2026-07-18T08:30:12");
    Assert.Throws<Doc28ValidationException>(()=>Doc28Parser.Parse(bad,"x.st4i.json"));
  }
  [Fact] public void Rejects_ok_header_with_ng_point() {
    var bad = OkJson.Replace("\"result\":\"NG\"},\"measurements\"","\"result\":\"OK\"},\"measurements\"");
    Assert.Throws<Doc28ValidationException>(()=>Doc28Parser.Parse(bad,"x.st4i.json"));
  }
  [Fact] public void Rejects_xml_with_doctype() {
    var xml = "<?xml version=\"1.0\"?><!DOCTYPE x><st4i_inspection><spec_version>1</spec_version></st4i_inspection>";
    Assert.Throws<Doc28ValidationException>(()=>Doc28Parser.Parse(xml,"x.st4i.xml"));
  }

  // ── extra coverage beyond the brief's 4 facts: CSV/XML happy paths (doc28 §5.2/§5.3 canonical
  //    examples, verbatim) + a couple more §8 validation rules that JSON alone doesn't exercise. ──

  const string SpecCsv =
    "#ST4I-INSPECTION,1\n" +
    "H,machine_code,AOI-01\n" +
    "H,serial_number,SN-2026-000123\n" +
    "H,program_name,MB-X1-TOP\n" +
    "H,program_version,1.4.0\n" +
    "H,lot_code,LOT-77\n" +
    "H,panel_id,PNL-88\n" +
    "H,board_index,2\n" +
    "H,operator_id,OP-0009\n" +
    "H,started_at,2026-07-04T08:30:00+07:00\n" +
    "H,finished_at,2026-07-04T08:30:12.480+07:00\n" +
    "H,cycle_time_sec,12.48\n" +
    "H,result,NG\n" +
    "M,R12.1,solder_joint,61.2,%,70,130,100,NG,INSUFFICIENT_SOLDER,major,120,340,48,32,SN-2026-000123__R12.1.jpg,insufficient fillet on pad 1,95.0,88.0,61.2,2.1,3.0,1.2,-3.5,1.1,0.4,40,130\n" +
    "M,C3,component,99.1,%,,,,OK\n" +
    "M,U1.pin5,solder_joint,,,,,,NTF,BRIDGING,minor,610,900,22,18,SN-2026-000123__U1.pin5.jpg\n";

  [Fact] public void Parses_valid_csv_spec_example() {
    var r = Doc28Parser.Parse(SpecCsv, "AOI-01__SN-2026-000123__x.st4i.csv");
    Assert.Equal(ReadingKind.Inspection, r.Kind);
    Assert.Equal("AOI-01", r.MachineCode);
    Assert.Equal("SN-2026-000123", r.SerialNumber);
    Assert.Equal(Verdict.Fail, r.Verdict); // header result NG
    Assert.Equal(3, r.Measurements.Count);
    var r121 = Assert.Single(r.Measurements, m => m.PointCode == "R12.1");
    Assert.Equal("NG", r121.Result);
    Assert.Equal("INSUFFICIENT_SOLDER", r121.DefectCatalogCode);
    Assert.Equal(61.2, r121.MeasuredValue);
    Assert.NotNull(r121.Bbox);
    Assert.Equal(120, r121.Bbox!.X); Assert.Equal(340, r121.Bbox.Y); Assert.Equal(48, r121.Bbox.W); Assert.Equal(32, r121.Bbox.H);
    Assert.NotNull(r121.Values3d);
    Assert.Equal(95.0, r121.Values3d!.HeightUm);
    var u1 = Assert.Single(r.Measurements, m => m.PointCode == "U1.pin5");
    Assert.Equal("NTF", u1.Result);
  }

  const string SpecXml =
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
    "<st4i_inspection>\n" +
    "  <spec_version>1</spec_version>\n" +
    "  <header>\n" +
    "    <machine_code>AOI-01</machine_code>\n" +
    "    <serial_number>SN-2026-000123</serial_number>\n" +
    "    <program_name>MB-X1-TOP</program_name>\n" +
    "    <started_at>2026-07-04T08:30:00+07:00</started_at>\n" +
    "    <finished_at>2026-07-04T08:30:12.480+07:00</finished_at>\n" +
    "    <result>NG</result>\n" +
    "  </header>\n" +
    "  <measurements>\n" +
    "    <measurement>\n" +
    "      <point_name>R12.1</point_name>\n" +
    "      <type>solder_joint</type>\n" +
    "      <value>61.2</value>\n" +
    "      <unit>%</unit>\n" +
    "      <result>NG</result>\n" +
    "      <defect_code>INSUFFICIENT_SOLDER</defect_code>\n" +
    "      <bbox_px><x>120</x><y>340</y><w>48</w><h>32</h></bbox_px>\n" +
    "    </measurement>\n" +
    "    <measurement>\n" +
    "      <point_name>C3</point_name>\n" +
    "      <type>component</type>\n" +
    "      <value>99.1</value>\n" +
    "      <unit>%</unit>\n" +
    "      <result>OK</result>\n" +
    "    </measurement>\n" +
    "  </measurements>\n" +
    "</st4i_inspection>\n";

  [Fact] public void Parses_valid_xml_spec_example() {
    var r = Doc28Parser.Parse(SpecXml, "AOI-01__SN-2026-000123__x.st4i.xml");
    Assert.Equal(ReadingKind.Inspection, r.Kind);
    Assert.Equal("SN-2026-000123", r.SerialNumber);
    Assert.Equal(Verdict.Fail, r.Verdict);
    Assert.Equal(2, r.Measurements.Count);
    var r121 = Assert.Single(r.Measurements, m => m.PointCode == "R12.1");
    Assert.Equal(61.2, r121.MeasuredValue);
    Assert.NotNull(r121.Bbox);
    Assert.Equal(120, r121.Bbox!.X);
  }

  [Fact] public void Rejects_missing_required_header_field() {
    var bad = OkJson.Replace("\"machine_code\":\"AOI-01\",", "");
    Assert.Throws<Doc28ValidationException>(()=>Doc28Parser.Parse(bad,"x.st4i.json"));
  }

  [Fact] public void Rejects_invalid_result_token() {
    var bad = OkJson.Replace("\"result\":\"NG\",\"defect_code\"", "\"result\":\"FAIL\",\"defect_code\"");
    Assert.Throws<Doc28ValidationException>(()=>Doc28Parser.Parse(bad,"x.st4i.json"));
  }

  [Fact] public void Rejects_bbox_with_missing_component() {
    var bad = OkJson.Replace(
      "\"defect_code\":\"BRIDGING\"}",
      "\"defect_code\":\"BRIDGING\",\"bbox_px\":{\"x\":1,\"y\":2,\"w\":3}}");
    Assert.Throws<Doc28ValidationException>(()=>Doc28Parser.Parse(bad,"x.st4i.json"));
  }

  [Fact] public void Rejects_csv_without_magic_line_version() {
    // still starts with '#ST4I-INSPECTION' (routed to the CSV parser) but the magic line is
    // missing its ',<version>' — exercises doc28 §8 rule 10 specifically, not just format sniffing.
    var bad = SpecCsv.Replace("#ST4I-INSPECTION,1\n", "#ST4I-INSPECTION\n");
    Assert.Throws<Doc28ValidationException>(()=>Doc28Parser.Parse(bad,"x.st4i.csv"));
  }
}
