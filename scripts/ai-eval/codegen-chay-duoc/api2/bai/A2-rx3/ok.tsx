import { Activity, useEffect, useState } from "react";

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

function TabCaiDat() {
  return <input aria-label="Ghi chú" />;
}

export function BangTab({ ghiNhan }: { ghiNhan: (s: string) => void }) {
  const [tab, datTab] = useState<"do" | "caidat">("do");
  return (
    <div>
      <button type="button" onClick={() => datTab("do")}>Đo</button>
      <button type="button" onClick={() => datTab("caidat")}>Cài đặt</button>
      <Activity mode={tab === "do" ? "visible" : "hidden"}>
        <TabDo ghiNhan={ghiNhan} />
      </Activity>
      <Activity mode={tab === "caidat" ? "visible" : "hidden"}>
        <TabCaiDat />
      </Activity>
    </div>
  );
}
