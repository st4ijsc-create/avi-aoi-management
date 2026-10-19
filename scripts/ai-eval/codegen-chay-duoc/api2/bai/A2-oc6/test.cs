using Sol;
using Opc.Ua;
public static class T {
  static void Kiem(bool d, string m) { if (!d) throw new Exception("TRUOT: " + m); }
  public static int Main() {
    try {
      var bang = new List<string> { "http://opcfoundation.org/UA/", "urn:may-chu:local", "urn:x", "urn:aoi:line1" };
      var a = ChuyenId.SangNodeId("nsu=urn:aoi:line1;s=Temp", bang);
      Kiem(a != null && a.NamespaceIndex == 3 && a.IdType == IdType.String && (string)a.Identifier == "Temp", "nsu=urn:aoi:line1;s=Temp ⇒ ns=3, thay " + a);
      var b = ChuyenId.SangNodeId("nsu=urn:x;i=5", bang);
      Kiem(b != null && b == new NodeId(5u, 2), "nsu=urn:x;i=5 ⇒ ns=2;i=5, thay " + b);
      var c = ChuyenId.SangNodeId("i=2258", bang);
      Kiem(c != null && c == new NodeId(2258u, 0), "i=2258, thay " + c);
      var d = ChuyenId.SangNodeId("ns=1;s=Abc", bang);
      Kiem(d != null && d == new NodeId("Abc", 1), "ns=1;s=Abc giu nguyen, thay " + d);
      var e = ChuyenId.SangNodeId("nsu=http://opcfoundation.org/UA/;i=85", bang);
      Kiem(e != null && e == new NodeId(85u, 0), "nsu UA;i=85 ⇒ i=85, thay " + e);
      Kiem(ChuyenId.SangNodeId("nsu=urn:khong-co;i=5", bang) == null, "URI khong co ⇒ null");
      var bang2 = new List<string> { "http://opcfoundation.org/UA/", "urn:aoi:line1" };
      var f = ChuyenId.SangNodeId("nsu=urn:aoi:line1;s=Temp", bang2);
      Kiem(f != null && f.NamespaceIndex == 1, "bang khac ⇒ chi so khac, thay " + f);
      Console.WriteLine("OK"); return 0;
    } catch (Exception e) { Console.WriteLine(e.GetType().Name + ": " + e.Message); return 1; }
  }
}
