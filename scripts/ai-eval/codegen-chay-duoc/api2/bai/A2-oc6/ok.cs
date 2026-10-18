using Opc.Ua;

namespace Sol {
  public static class ChuyenId {
    public static NodeId? SangNodeId(string chuoi, IList<string> bangNamespace) {
      var bang = new NamespaceTable(bangNamespace);
      var e = ExpandedNodeId.Parse(chuoi);
      return ExpandedNodeId.ToNodeId(e, bang);
    }
  }
}
