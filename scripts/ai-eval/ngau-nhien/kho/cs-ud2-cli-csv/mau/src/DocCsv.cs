using System.Text;

namespace Bai;

public static class DocCsv
{
    /// <summary>
    /// Đọc CSV (dấu phẩy, nháy kép kiểu RFC 4180). Dòng kết thúc bằng "\n" hoặc "\r\n"; dòng trống (ngoài nháy) bị bỏ.
    /// Ô bắt đầu bằng nháy: "" là một dấu nháy, giữ nguyên phẩy/xuống dòng bên trong; sau nháy đóng phải là phẩy,
    /// hết dòng hoặc hết dữ liệu. Nháy giữa ô không nháy là ký tự thường.
    /// </summary>
    public static IReadOnlyList<string[]> Doc(TextReader vao)
    {
        ArgumentNullException.ThrowIfNull(vao);
        var s = vao.ReadToEnd();
        int n = s.Length, i = 0;
        var kq = new List<string[]>();

        bool HetDong(int j) => s[j] == '\n' || (s[j] == '\r' && j + 1 < n && s[j + 1] == '\n');

        while (i < n)
        {
            if (HetDong(i))
            {
                i += s[i] == '\r' ? 2 : 1;
                continue;
            }
            var o = new List<string>();
            while (true)
            {
                if (i < n && s[i] == '"')
                {
                    var sb = new StringBuilder();
                    int moNhay = i;
                    i++;
                    while (true)
                    {
                        if (i >= n) throw new FormatException($"thiếu dấu nháy đóng cho ô bắt đầu ở vị trí {moNhay}");
                        if (s[i] == '"')
                        {
                            if (i + 1 < n && s[i + 1] == '"') { sb.Append('"'); i += 2; }
                            else { i++; break; }
                        }
                        else sb.Append(s[i++]);
                    }
                    if (i < n && s[i] != ',' && !HetDong(i)) throw new FormatException($"ký tự lạ sau nháy đóng ở vị trí {i}");
                    o.Add(sb.ToString());
                }
                else
                {
                    int dau = i;
                    while (i < n && s[i] != ',' && !HetDong(i)) i++;
                    o.Add(s[dau..i]);
                }
                if (i < n && s[i] == ',')
                {
                    i++;
                    continue;
                }
                if (i < n) i += s[i] == '\r' ? 2 : 1;
                break;
            }
            kq.Add(o.ToArray());
        }
        return kq;
    }
}
