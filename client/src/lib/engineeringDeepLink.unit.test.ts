import { describe, expect, it } from "vitest";
import { parseDeepLink, withParams } from "./engineeringDeepLink";

describe("parseDeepLink", () => {
  describe("định dạng chuỗi search", () => {
    it("có dấu '?' đầu → parse đúng", () => {
      const result = parseDeepLink("?projectId=5&machineId=3&ref=line-a");
      expect(result).toEqual({ projectId: 5, machineId: 3, ref: "line-a" });
    });

    it("không có dấu '?' đầu → parse đúng", () => {
      const result = parseDeepLink("projectId=5&machineId=3&ref=line-a");
      expect(result).toEqual({ projectId: 5, machineId: 3, ref: "line-a" });
    });

    it("chuỗi rỗng → tất cả null", () => {
      const result = parseDeepLink("");
      expect(result).toEqual({ projectId: null, machineId: null, ref: null });
    });
  });

  describe("projectId — chỉ nhận số nguyên dương", () => {
    it("số nguyên dương → giữ nguyên", () => {
      expect(parseDeepLink("projectId=1").projectId).toBe(1);
      expect(parseDeepLink("projectId=999").projectId).toBe(999);
    });

    it("0 → null", () => {
      expect(parseDeepLink("projectId=0").projectId).toBeNull();
    });

    it("số âm → null", () => {
      expect(parseDeepLink("projectId=-1").projectId).toBeNull();
      expect(parseDeepLink("projectId=-100").projectId).toBeNull();
    });

    it("số thập phân → null", () => {
      expect(parseDeepLink("projectId=1.5").projectId).toBeNull();
      expect(parseDeepLink("projectId=3.14").projectId).toBeNull();
    });

    it("chữ → null", () => {
      expect(parseDeepLink("projectId=abc").projectId).toBeNull();
      expect(parseDeepLink("projectId=project1").projectId).toBeNull();
    });

    it("rỗng → null", () => {
      expect(parseDeepLink("projectId=").projectId).toBeNull();
    });

    it("khoảng trắng → null", () => {
      expect(parseDeepLink("projectId=%20").projectId).toBeNull();
      expect(parseDeepLink("projectId=%20%20").projectId).toBeNull();
    });
  });

  describe("machineId — chỉ nhận số nguyên dương", () => {
    it("số nguyên dương → giữ nguyên", () => {
      expect(parseDeepLink("machineId=42").machineId).toBe(42);
    });

    it("0 → null", () => {
      expect(parseDeepLink("machineId=0").machineId).toBeNull();
    });

    it("số âm → null", () => {
      expect(parseDeepLink("machineId=-5").machineId).toBeNull();
    });

    it("số thập phân → null", () => {
      expect(parseDeepLink("machineId=2.7").machineId).toBeNull();
    });

    it("chữ → null", () => {
      expect(parseDeepLink("machineId=xyz").machineId).toBeNull();
    });

    it("rỗng → null", () => {
      expect(parseDeepLink("machineId=").machineId).toBeNull();
    });

    it("khoảng trắng → null", () => {
      expect(parseDeepLink("machineId=%20").machineId).toBeNull();
    });
  });

  describe("ref — giữ nguyên giá trị hợp lệ, rỗng/khoảng trắng → null", () => {
    it("có giá trị → giữ nguyên", () => {
      expect(parseDeepLink("ref=line-a").ref).toBe("line-a");
      expect(parseDeepLink("ref=workflow-123").ref).toBe("workflow-123");
    });

    it("rỗng → null", () => {
      expect(parseDeepLink("ref=").ref).toBeNull();
    });

    it("toàn khoảng trắng → null", () => {
      expect(parseDeepLink("ref=%20").ref).toBeNull();
      expect(parseDeepLink("ref=%20%20%20").ref).toBeNull();
    });
  });

  describe("thiếu tham số", () => {
    it("thiếu projectId → null", () => {
      const result = parseDeepLink("machineId=3&ref=line-a");
      expect(result.projectId).toBeNull();
    });

    it("thiếu machineId → null", () => {
      const result = parseDeepLink("projectId=5&ref=line-a");
      expect(result.machineId).toBeNull();
    });

    it("thiếu ref → null", () => {
      const result = parseDeepLink("projectId=5&machineId=3");
      expect(result.ref).toBeNull();
    });
  });

  describe("tham số lạ bị bỏ qua", () => {
    it("tham số không xác định không ảnh hưởng kết quả", () => {
      const result = parseDeepLink("projectId=5&unknown=foo&machineId=3&extra=bar");
      expect(result).toEqual({ projectId: 5, machineId: 3, ref: null });
    });
  });

  describe("kết hợp nhiều tham số", () => {
    it("đầy đủ 3 tham số hợp lệ", () => {
      const result = parseDeepLink("?projectId=10&machineId=20&ref=test-ref");
      expect(result).toEqual({ projectId: 10, machineId: 20, ref: "test-ref" });
    });

    it("một số tham số hợp lệ, một số không", () => {
      const result = parseDeepLink("projectId=abc&machineId=7&ref=");
      expect(result).toEqual({ projectId: null, machineId: 7, ref: null });
    });
  });
});

describe("withParams", () => {
  describe("lọc giá trị null/undefined/rỗng/khoảng trắng", () => {
    it("bỏ null", () => {
      expect(withParams("/path", { a: null })).toBe("/path");
    });

    it("bỏ undefined", () => {
      expect(withParams("/path", { a: undefined })).toBe("/path");
    });

    it("bỏ chuỗi rỗng", () => {
      expect(withParams("/path", { a: "" })).toBe("/path");
    });

    it("bỏ chuỗi toàn khoảng trắng", () => {
      expect(withParams("/path", { a: "   " })).toBe("/path");
    });
  });

  describe("cắt khoảng trắng hai đầu", () => {
    it("trim khoảng trắng trước", () => {
      expect(withParams("/path", { a: "  value  " })).toBe("/path?a=value");
    });
  });

  describe("số được chuyển thành chuỗi", () => {
    it("số nguyên → chuỗi", () => {
      expect(withParams("/path", { projectId: 5 })).toBe("/path?projectId=5");
    });

    it("số 0 → chuỗi '0'", () => {
      expect(withParams("/path", { projectId: 0 })).toBe("/path?projectId=0");
    });

    it("số thập phân → chuỗi", () => {
      expect(withParams("/path", { value: 3.14 })).toBe("/path?value=3.14");
    });
  });

  describe("không còn tham số nào hợp lệ", () => {
    it("tất cả null → path trơn", () => {
      expect(withParams("/path", { a: null, b: undefined })).toBe("/path");
    });

    it("tất cả rỗng → path trơn", () => {
      expect(withParams("/path", { a: "", b: "   " })).toBe("/path");
    });

    it("object rỗng → path trơn", () => {
      expect(withParams("/path", {})).toBe("/path");
    });
  });

  describe("nhiều tham số hợp lệ", () => {
    it("nhiều tham số → ghép đúng", () => {
      const result = withParams("/path", {
        projectId: 5,
        machineId: 3,
        ref: "line-a",
      });
      expect(result).toBe("/path?projectId=5&machineId=3&ref=line-a");
    });
  });

  describe("mã hoá ký tự đặc biệt", () => {
    it("ký tự khoảng trắng → + (URLSearchParams encode)", () => {
      expect(withParams("/path", { name: "hello world" })).toBe(
        "/path?name=hello+world",
      );
    });

    it("ký tự & → %26", () => {
      expect(withParams("/path", { q: "a&b" })).toBe("/path?q=a%26b");
    });

    it("ký tự = → %3D", () => {
      expect(withParams("/path", { eq: "a=b" })).toBe("/path?eq=a%3Db");
    });

    it("ký tự # → %23", () => {
      expect(withParams("/path", { hash: "a#b" })).toBe("/path?hash=a%23b");
    });

    it("ký tự + → %2B", () => {
      expect(withParams("/path", { plus: "a+b" })).toBe("/path?plus=a%2Bb");
    });

    it("ký tự @ → %40", () => {
      expect(withParams("/path", { at: "a@b" })).toBe("/path?at=a%40b");
    });

    it("ký tự / → %2F", () => {
      expect(withParams("/path", { slash: "a/b" })).toBe("/path?slash=a%2Fb");
    });
  });

  describe("path không có dấu '/'", () => {
    it("path trơn → thêm query đúng", () => {
      expect(withParams("page", { a: "1" })).toBe("page?a=1");
    });
  });

  describe("path đã có query string", () => {
    it("tham số mới ghép bằng '&', giữ nguyên query cũ", () => {
      const result = withParams("/path?old=1", { new: "2" });
      expect(result).toBe("/path?old=1&new=2");
    });

    it("khoá trùng → giá trị mới thay giá trị cũ tại vị trí cũ", () => {
      const result = withParams("/path?old=1&ref=line-a", { old: "99" });
      expect(result).toBe("/path?old=99&ref=line-a");
    });

    it("tham số cũ giữ nguyên văn (không re-encode)", () => {
      const result = withParams("/path?name=hello%20world", { new: "2" });
      expect(result).toBe("/path?name=hello%20world&new=2");
    });

    it("nhiều tham số cũ + nhiều tham số mới", () => {
      const result = withParams("/path?a=1&b=2&c=3", { d: "4", e: "5" });
      expect(result).toBe("/path?a=1&b=2&c=3&d=4&e=5");
    });
  });

  describe("trộn giá trị hợp lệ và không hợp lệ", () => {
    it("chỉ giữ tham số hợp lệ", () => {
      const result = withParams("/path", {
        valid: "yes",
        nullVal: null,
        empty: "",
        ws: "   ",
        undef: undefined,
      });
      expect(result).toBe("/path?valid=yes");
    });
  });

  describe("edge cases — path đặc biệt", () => {
    it("path rỗng + có param → '?key=value'", () => {
      expect(withParams("", { a: "1" })).toBe("?a=1");
    });

    it("path rỗng + không param → ''", () => {
      expect(withParams("", {})).toBe("");
    });

    it("path '/' → '/?key=value'", () => {
      expect(withParams("/", { a: "1" })).toBe("/?a=1");
    });
  });

  describe("edge cases — số âm trong withParams", () => {
    it("số âm → chuỗi có dấu trừ", () => {
      expect(withParams("/path", { val: -5 })).toBe("/path?val=-5");
    });
  });

  describe("edge cases — Unicode trong withParams", () => {
    it("Unicode được URLSearchParams encode", () => {
      const result = withParams("/path", { name: "xin chào" });
      expect(result).toContain("name=");
      expect(result).not.toContain("chào");
    });

    it("ký tự emoji được encode", () => {
      const result = withParams("/path", { emoji: "😀" });
      expect(result).toContain("emoji=");
      expect(result).not.toContain("😀");
    });
  });

  describe("edge cases — path có hash", () => {
    it("path có hash → query đứng trước '#', fragment giữ nguyên", () => {
      const result = withParams("/path?old=1#section", { new: "2" });
      expect(result).toBe("/path?old=1&new=2#section");
    });

    it("path không có query nhưng có hash → query đứng trước '#'", () => {
      const result = withParams("/path#section", { new: "2" });
      expect(result).toBe("/path?new=2#section");
    });

    it("path có cả '?' và '#' → query đã ghép đứng trước '#'", () => {
      const result = withParams("/path?old=1#section", { new: "2" });
      expect(result).toBe("/path?old=1&new=2#section");
    });
  });

  describe("không có tham số hợp lệ → path nguyên văn", () => {
    it("path có '?' nhưng không param → giữ nguyên", () => {
      expect(withParams("/path?", {})).toBe("/path?");
    });

    it("path có '#' nhưng không param → giữ nguyên", () => {
      expect(withParams("/path#", {})).toBe("/path#");
    });

    it("path có cả '?' và '#' nhưng không param → giữ nguyên", () => {
      expect(withParams("/path?#frag", {})).toBe("/path?#frag");
    });

    it("path có query cũ nhưng không param mới → giữ nguyên", () => {
      expect(withParams("/path?old=1", {})).toBe("/path?old=1");
    });

    it("path có query cũ + hash nhưng không param mới → giữ nguyên", () => {
      expect(withParams("/path?old=1#frag", {})).toBe("/path?old=1#frag");
    });
  });

  describe("edge cases — path kết thúc bằng '?' hoặc '#' trống", () => {
    it("path '/p?' + param → '/p?key=value' (không '?&')", () => {
      expect(withParams("/p?", { a: "1" })).toBe("/p?a=1");
    });

    it("path '/p#' + param → '/p?key=value#' (giữ '#' ở cuối)", () => {
      expect(withParams("/p#", { a: "1" })).toBe("/p?a=1#");
    });

    it("path '/p?#' + param → '/p?a=1#'", () => {
      expect(withParams("/p?#", { a: "1" })).toBe("/p?a=1#");
    });
  });

  describe("tham số cũ không có dấu '='", () => {
    it("param '/p?flag' giữ nguyên văn", () => {
      const result = withParams("/p?flag", { new: "2" });
      expect(result).toBe("/p?flag&new=2");
    });

    it("param '/p?flag' + param trùng → thay flag bằng key=value mới", () => {
      const result = withParams("/p?flag", { flag: "9" });
      expect(result).toBe("/p?flag=9");
    });
  });

  describe("khoá trùng trong query cũ", () => {
    it("query có khoá lặp '/p?a=1&a=2' + {a:'9'} → 'a=9' (một lần, vị trí đầu)", () => {
      const result = withParams("/p?a=1&a=2", { a: "9" });
      expect(result).toBe("/p?a=9");
    });

    it("query có khoá lặp '/p?a=1&a=2&b=3' + {a:'9'} → 'a=9&b=3'", () => {
      const result = withParams("/p?a=1&a=2&b=3", { a: "9" });
      expect(result).toBe("/p?a=9&b=3");
    });

    it("query có khoá lặp '/p?a=1&a=2' + {b:'3'} → 'a=1&a=2&b=3' (giữ nguyên bản lặp)", () => {
      const result = withParams("/p?a=1&a=2", { b: "3" });
      expect(result).toBe("/p?a=1&a=2&b=3");
    });
  });

  describe("thay thế nhiều khoá trùng", () => {
    it("query '/p?a=1&b=2&c=3' + {a:'9',c:'7'} → 'a=9&b=2&c=7'", () => {
      const result = withParams("/p?a=1&b=2&c=3", { a: "9", c: "7" });
      expect(result).toBe("/p?a=9&b=2&c=7");
    });
  });
});

describe("parseDeepLink — edge cases", () => {
  describe("số đặc biệt", () => {
    it("projectId=+5 → 5 (dấu + được chấp nhận)", () => {
      expect(parseDeepLink("projectId=+5").projectId).toBe(5);
    });

    it("projectId=1.0 → 1 (thập phân .0 vẫn là số nguyên)", () => {
      expect(parseDeepLink("projectId=1.0").projectId).toBe(1);
    });

    it("projectId=00 → null (00 = 0, không dương)", () => {
      expect(parseDeepLink("projectId=00").projectId).toBeNull();
    });

    it("projectId=01 → 1 (leading zero)", () => {
      expect(parseDeepLink("projectId=01").projectId).toBe(1);
    });

    it("projectId=1e2 → 100 (ký hiệu khoa học)", () => {
      expect(parseDeepLink("projectId=1e2").projectId).toBe(100);
    });

    it("projectId=1e10 → 10000000000 (số lớn)", () => {
      expect(parseDeepLink("projectId=1e10").projectId).toBe(10000000000);
    });

    it("projectId=-0 → null (-0 không > 0)", () => {
      expect(parseDeepLink("projectId=-0").projectId).toBeNull();
    });

    it("projectId=Infinity → null", () => {
      expect(parseDeepLink("projectId=Infinity").projectId).toBeNull();
    });

    it("projectId=-Infinity → null", () => {
      expect(parseDeepLink("projectId=-Infinity").projectId).toBeNull();
    });

    it("projectId=NaN → null", () => {
      expect(parseDeepLink("projectId=NaN").projectId).toBeNull();
    });
  });

  describe("ref với whitespace đặc biệt", () => {
    it("ref với newline → null (trim rỗng)", () => {
      expect(parseDeepLink("ref=%0A").ref).toBeNull();
    });

    it("ref với tab → null (trim rỗng)", () => {
      expect(parseDeepLink("ref=%09").ref).toBeNull();
    });

    it("ref với newline + chữ → giữ nguyên (trim không rỗng)", () => {
      const result = parseDeepLink("ref=%0Ahello");
      expect(result.ref).toBe("\nhello");
    });

    it("ref với nhiều khoảng trắng giữa chữ → giữ nguyên", () => {
      expect(parseDeepLink("ref=a%20%20b").ref).toBe("a  b");
    });
  });

  describe("search string toàn khoảng trắng", () => {
    it("search = '   ' → tất cả null", () => {
      const result = parseDeepLink("   ");
      expect(result).toEqual({ projectId: null, machineId: null, ref: null });
    });

    it("search = '%20%20' → tất cả null", () => {
      const result = parseDeepLink("%20%20");
      expect(result).toEqual({ projectId: null, machineId: null, ref: null });
    });
  });

  describe("nhiều dấu ? trong chuỗi", () => {
    it("??projectId=5 → projectId vẫn = 5 (URLSearchParams bỏ ?)", () => {
      const result = parseDeepLink("??projectId=5");
      // slice(1) bỏ 1 '?', còn "?projectId=5"
      // URLSearchParams tự bỏ ? ở đầu → projectId=5
      expect(result.projectId).toBe(5);
    });
  });
});
