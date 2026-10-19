using Opc.Ua;

// SAI (lỗi điển hình): chỉ nhận Good — Uncertain bị coi như Bad.
namespace Sol {
  public static class DocOpc {
    public static ReadValueIdCollection TaoYeuCauDoc(IEnumerable<string> nodeIds) {
      var r = new ReadValueIdCollection();
      foreach (var s in nodeIds) r.Add(new ReadValueId { NodeId = NodeId.Parse(s), AttributeId = Attributes.Value });
      return r;
    }

    public static Dictionary<string, object?> GhepKetQua(IReadOnlyList<string> nodeIds, DataValueCollection ketQua) {
      if (nodeIds.Count != ketQua.Count) throw new ServiceResultException(StatusCodes.BadUnexpectedError, "lech do dai");
      var d = new Dictionary<string, object?>();
      for (int i = 0; i < nodeIds.Count; i++) {
        var dv = ketQua[i];
        d[nodeIds[i]] = StatusCode.IsGood(dv.StatusCode) ? dv.Value : null;
      }
      return d;
    }
  }
}
