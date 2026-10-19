import { useEffect, useState } from "react";

// SAI (cách làm trước 19.2): giữ cả hai tab mounted và ẩn bằng CSS ⇒ giữ được state nhưng effect của tab ẩn KHÔNG được dọn.
function TabDo({ ghiNhan }: { ghiNhan: (s: string) => void }) {
  const [n, datN] = useState(0);
  useEffect(() => {
    ghiNhan("mo");
    return () => ghiNhan("dong");
  }, []);
  return (
    <div>
      <span>Đếm: {n}</span>
      <button type="button" onClick={() => datN((x) => x + 1)}>Tăng</button>
    </div>
  );
}

export function BangTab({ ghiNhan }: { ghiNhan: (s: string) => void }) {
  const [tab, datTab] = useState<"do" | "caidat">("do");
  return (
    <div>
      <button type="button" onClick={() => datTab("do")}>Đo</button>
      <button type="button" onClick={() => datTab("caidat")}>Cài đặt</button>
      <div style={{ display: tab === "do" ? "block" : "none" }}><TabDo ghiNhan={ghiNhan} /></div>
      <div style={{ display: tab === "caidat" ? "block" : "none" }}><input aria-label="Ghi chú" /></div>
    </div>
  );
}
