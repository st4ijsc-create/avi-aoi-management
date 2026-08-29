using System.Text.Json;
using System.Text.Json.Nodes;
using St4i.Hmi.Contracts;
using Xunit;

namespace St4i.Hmi.Contracts.Tests;

/// <summary>
/// Mỗi fixture <c>contracts/fixtures/valid/tags-*.json</c> phải đọc được vào
/// <see cref="TagNamespaceDocument"/> rồi ghi ra lại thành JSON <b>tương đương ngữ nghĩa</b> với bản gốc.
///
/// <para><b>Bài test này KHÔNG đo cái gì:</b> (1) nó KHÔNG kiểm fixture có hợp lệ theo JSON Schema hay
/// không — không có bộ validate JSON Schema nào trong cây này (chủ ý: contract assembly zero-dependency),
/// việc "schema từ chối đúng thứ cần từ chối" do <c>TagNamespaceSchemaPinTests</c> đo bằng cách khác;
/// (2) nó KHÔNG chứng minh phía TypeScript đọc cùng fixture ra cùng kết quả — đó là
/// <c>web/contract-tests/contracts.test.mjs</c>; (3) một fixture xanh ở đây KHÔNG có nghĩa driver
/// nào nạp tag ấy thật — cờ <c>isBackedByDriver</c> chỉ là một trường dữ liệu ở tầng này.</para>
/// </summary>
public class TagNamespaceRoundTripTests
{
    public static TheoryData<string> ValidFixtures()
    {
        var data = new TheoryData<string>();
        foreach (var f in ContractFixtures.ValidFiles("tags-")) data.Add(f);
        return data;
    }

    [Theory]
    [MemberData(nameof(ValidFixtures))]
    public void Valid_fixture_round_trips_without_semantic_loss(string fixturePath)
    {
        var original = File.ReadAllText(fixturePath);

        var doc = JsonSerializer.Deserialize<TagNamespaceDocument>(original, HmiContractJson.Options);
        Assert.NotNull(doc);

        var rewritten = JsonSerializer.Serialize(doc, HmiContractJson.Options);

        Assert.True(
            JsonNode.DeepEquals(JsonNode.Parse(original), JsonNode.Parse(rewritten)),
            $"round-trip changed the document.\nORIGINAL:\n{original}\n\nREWRITTEN:\n{rewritten}");
    }

    [Fact]
    public void Fixture_corpus_is_not_empty()
    {
        // Chống bài test rỗng: một glob hụt sẽ làm mọi [Theory] ở trên biến mất mà vẫn "xanh".
        Assert.NotEmpty(ContractFixtures.ValidFiles("tags-"));
    }
}
