using System.Data;
public static class T {
  static void Kiem(bool d, string m) { if (!d) throw new Exception("TRUOT: " + m); }
  public static int Main() {
    try {
      var cs = TroTsql.TaoCsdl();
      try {
        TroTsql.ChayLo(cs, @"CREATE TABLE dbo.Loi(Id int identity primary key, May nvarchar(10) not null, MaLoi nvarchar(20) not null, Luc datetime2(0) not null);
          INSERT dbo.Loi(May, MaLoi, Luc) VALUES
            (N'M02', N'E10', '2026-10-18 08:00'), (N'M01', N'E10', '2026-10-18 07:00'), (N'M01', N'E02', '2026-10-18 09:30'),
            (N'M01', N'E10', '2026-10-18 06:00'), (N'M01', N'E01', '2026-10-18 05:00'), (N'M02', N'E10', '2026-10-18 08:05'),
            (N'M03', N'Lỗi cảm biến', '2026-10-18 01:00');");
        var (cot, kieu, dong) = TroTsql.Doc(cs, TroTsql.LoiGiai, CommandType.Text);
        Kiem(string.Join(",", cot) == "May,SoLoi,DanhSachMa,LanCuoi", "cot: " + string.Join(",", cot));
        Kiem(kieu[1] == typeof(int), "SoLoi phai int, thay " + kieu[1].Name);
        Kiem(dong.Count == 3, "so hang " + dong.Count);
        string H(object?[] r) => $"{r[0]}|{r[1]}|{r[2]}|{(r[3] is DateTime d ? d.ToString("yyyy-MM-dd HH:mm") : r[3])}";
        Kiem(H(dong[0]) == "M01|4|E01, E02, E10|2026-10-18 09:30", "M01: " + H(dong[0]));
        Kiem(H(dong[1]) == "M02|2|E10|2026-10-18 08:05", "M02: " + H(dong[1]));
        Kiem(H(dong[2]) == "M03|1|Lỗi cảm biến|2026-10-18 01:00", "M03: " + H(dong[2]));
      } finally { TroTsql.XoaCsdl(); }
      Console.WriteLine("OK"); return 0;
    } catch (Exception e) { Console.WriteLine(e.GetType().Name + ": " + e.Message); return 1; }
  }
}
