using Opc.Ua;

// SAI (lỗi điển hình): bỏ qua URI — lấy NamespaceIndex của ExpandedNodeId (=0 khi có nsu) và dựng NodeId cục bộ trực tiếp.
namespace Sol {
  public static class ChuyenId {
    public static NodeId? SangNodeId(string chuoi, IList<string> bangNamespace) {
      var e = ExpandedNodeId.Parse(chuoi);
      if (e.NamespaceUri != null && !bangNamespace.Contains(e.NamespaceUri)) return null;
      return new NodeId(e.Identifier, e.NamespaceIndex);
    }
  }
}
