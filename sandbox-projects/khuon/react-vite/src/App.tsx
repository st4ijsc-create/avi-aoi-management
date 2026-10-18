import { useState } from "react";

export function App() {
  const [dem, setDem] = useState(0);
  return (
    <main style={{ fontFamily: "system-ui", padding: 24 }}>
      <h1>Xin chào!</h1>
      <button type="button" onClick={() => setDem((n) => n + 1)}>
        Đã bấm {dem} lần
      </button>
    </main>
  );
}
