using System.Text.Json;
using System.Text.Json.Nodes;
using St4i.Hmi.Contracts;
using Xunit;

namespace St4i.Hmi.Contracts.Tests;

/// <summary>
/// Mỗi fixture <c>contracts/fixtures/valid/screen-*.json</c> phải đọc được vào
/// <see cref="HmiScreenDocument"/> rồi ghi ra lại thành JSON <b>tương đương ngữ nghĩa</b> với bản gốc.
/// Đây là bài chứng minh một màn hình lưu hôm nay đọc lại được nguyên vẹn — nếu nó đỏ, mọi màn hình
/// khách đã thiết kế đều đang có nguy cơ mất dữ liệu khi tải lại.
///
/// <para><b>Bài test này KHÔNG đo cái gì:</b> (1) nó KHÔNG kiểm <c>bindings</c> trỏ tới một tag có thật,
/// cũng không kiểm <c>component</c> trỏ tới một linh kiện có thật — hai việc ấy cần cả tag namespace lẫn
/// component model, và là việc của runtime WS-HMI-1; (2) nó KHÔNG kiểm các widget có chồng lấn ô lưới —
/// editor WS-HMI-2 lo việc đó; (3) nó KHÔNG kiểm bất kỳ luật ISA-101 nào (màu, tương phản, vùng chạm) —
/// linter §6 là WS-HMI-4; (4) nó KHÔNG kiểm <c>props</c> có đúng hình dạng cho <c>kind</c> tương ứng —
/// <c>props</c> cố tình để mở ở tầng hợp đồng, xem ghi chú ở Step 6.</para>
/// </summary>
public class HmiScreenRoundTripTests
{
    public static TheoryData<string> ValidFixtures()
    {
        var data = new TheoryData<string>();
        foreach (var f in ContractFixtures.ValidFiles("screen-")) data.Add(f);
        return data;
    }

    [Theory]
    [MemberData(nameof(ValidFixtures))]
    public void Valid_fixture_round_trips_without_semantic_loss(string fixturePath)
    {
        var original = File.ReadAllText(fixturePath);

        var doc = JsonSerializer.Deserialize<HmiScreenDocument>(original, HmiContractJson.Options);
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
        Assert.NotEmpty(ContractFixtures.ValidFiles("screen-"));
    }
}
