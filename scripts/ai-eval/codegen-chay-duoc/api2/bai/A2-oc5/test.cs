using Sol;
using Opc.Ua;
public static class T {
  static void Kiem(bool d, string m) { if (!d) throw new Exception("TRUOT: " + m); }
  public static int Main() {
    try {
      var ids = new[] { "ns=2;s=Line1.Temp", "i=2258", "ns=3;g=1a2b3c4d-0000-0000-0000-000000000001", "ns=2;i=77" };
      ReadValueIdCollection r = DocOpc.TaoYeuCauDoc(ids);
      Kiem(r.Count == 4, "so ReadValueId " + r.Count);
      for (int i = 0; i < 4; i++) {
        Kiem(r[i].NodeId == NodeId.Parse(ids[i]), $"NodeId {i}: {r[i].NodeId}");
        Kiem(r[i].AttributeId == Attributes.Value, $"AttributeId {i}: {r[i].AttributeId}");
      }
      Kiem(r[0].NodeId.NamespaceIndex == 2 && r[0].NodeId.IdType == IdType.String, "ns=2;s=…");
      Kiem(r[2].NodeId.IdType == IdType.Guid, "g=… phai la Guid");
      var kq = new DataValueCollection {
        new DataValue(new Variant(21.5), StatusCodes.Good),
        new DataValue(new Variant(new DateTime(2026, 10, 18, 1, 0, 0, DateTimeKind.Utc)), StatusCodes.Good),
        new DataValue(new Variant(7), StatusCodes.UncertainLastUsableValue),
        new DataValue(new Variant(9), StatusCodes.BadSensorFailure),
      };
      var g = DocOpc.GhepKetQua(ids, kq);
      Kiem(g.Count == 4, "so muc " + g.Count);
      Kiem(g[ids[0]] is double d0 && d0 == 21.5, "Good double");
      Kiem(g[ids[1]] is DateTime, "Good DateTime");
      Kiem(g[ids[2]] is int i2 && i2 == 7, "Uncertain ⇒ van tra gia tri");
      Kiem(g[ids[3]] == null, "Bad ⇒ null");
      var g2 = DocOpc.GhepKetQua(new[] { "i=1" }, new DataValueCollection { new DataValue(StatusCodes.BadNodeIdUnknown) });
      Kiem(g2["i=1"] == null, "BadNodeIdUnknown ⇒ null");
      try { DocOpc.GhepKetQua(ids, new DataValueCollection { new DataValue(new Variant(1), StatusCodes.Good) }); Kiem(false, "lech do dai phai nem"); }
      catch (ServiceResultException e) { Kiem(e.StatusCode == StatusCodes.BadUnexpectedError, "ma loi " + e.StatusCode); }
      Console.WriteLine("OK"); return 0;
    } catch (Exception e) { Console.WriteLine(e.GetType().Name + ": " + e.Message); return 1; }
  }
}
