using System.Text.Json;
using System.Text.Json.Nodes;
using St4i.Hmi.Contracts;
using Xunit;

namespace St4i.Hmi.Contracts.Tests;

/// <summary>
/// Mỗi fixture <c>contracts/fixtures/valid/components-*.json</c> phải đọc được vào
/// <see cref="ComponentModelDocument"/> rồi ghi ra lại thành JSON <b>tương đương ngữ nghĩa</b> với bản gốc.
///
/// <para><b>Bài test này KHÔNG đo cái gì:</b> (1) nó KHÔNG kiểm <c>parentId</c> trỏ tới một component
/// có thật, cũng không kiểm cây có chu trình — toàn vẹn cây là việc của tầng lưu trữ ở WS-HMI-0, không
/// phải của tầng hợp đồng; (2) nó KHÔNG kiểm <c>tagPrefix</c> khớp với bất kỳ tag nào trong tag
/// namespace — hai document là hai hợp đồng độc lập, và việc nối chúng là runtime; (3) nó KHÔNG kiểm
/// <c>expr</c> của một state có phân tích cú pháp được — bộ đánh giá biểu thức thuộc WS-HMI-1;
/// (4) nó KHÔNG kiểm ràng buộc <c>allOf</c> (setpoint phải có min/max và policyAction) — corpus
/// <c>invalid/</c> ở phía web đo việc đó, nơi CÓ bộ validate.</para>
/// </summary>
public class ComponentModelRoundTripTests
{
    public static TheoryData<string> ValidFixtures()
    {
        var data = new TheoryData<string>();
        foreach (var f in ContractFixtures.ValidFiles("components-")) data.Add(f);
        return data;
    }

    [Theory]
    [MemberData(nameof(ValidFixtures))]
    public void Valid_fixture_round_trips_without_semantic_loss(string fixturePath)
    {
        var original = File.ReadAllText(fixturePath);

        var doc = JsonSerializer.Deserialize<ComponentModelDocument>(original, HmiContractJson.Options);
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
        Assert.NotEmpty(ContractFixtures.ValidFiles("components-"));
    }
}
