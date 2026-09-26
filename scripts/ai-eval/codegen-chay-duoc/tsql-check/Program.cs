// Cong kiem T-SQL THAT (Microsoft.SqlServer.TransactSql.ScriptDom) — chay OFFLINE, khong can server.
// Vi sao can: don hang D1/D2 yeu cau SQL Server; bat PostgreSQL cham bai T-SQL la loi cua NGUOI DO.
using Microsoft.SqlServer.TransactSql.ScriptDom;
class P {
  static int Main(string[] a) {
    var sql = File.ReadAllText(a[0]);
    var parser = new TSql160Parser(true);
    parser.Parse(new StringReader(sql), out IList<ParseError> errs);
    if (errs == null || errs.Count == 0) { Console.WriteLine("OK"); return 0; }
    foreach (var e in errs.Take(5)) Console.WriteLine($"L{e.Line}: {e.Message}");
    return 1;
  }
}
