// FactoryScene2D.tsx — cảnh nhà máy 2D top-down bằng SVG. ĐÂY LÀ MẶC ĐỊNH:
// nhẹ (không WebGL), in được, hiển thị TV được, tải tức thì.
//  • Máy = hình chữ nhật theo vị trí thật (top-down: worldX→x, worldZ→y), màu theo overlay.
//  • Click chọn, hover nhấn sáng; viền nháy Andon (CSS animation), vòng PdM gạch nét.
//  • Pan (kéo) + zoom (cuộn) + fly-to mượt khi focusId đổi (tween viewBox tự viết).
//  • Theme-aware qua ThemeContext (đọc class <html>), fallback prefers-color-scheme.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { useOptionalTheme } from "./useOptionalTheme";
import {
  type FactorySceneProps,
  overlayColorHex,
  resolveLayout,
  scenePalette,
  STATUS_LABEL_VI,
} from "./sceneTypes";

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

function lerpVB(a: ViewBox, b: ViewBox, k: number): ViewBox {
  return {
    x: a.x + (b.x - a.x) * k,
    y: a.y + (b.y - a.y) * k,
    w: a.w + (b.w - a.w) * k,
    h: a.h + (b.h - a.h) * k,
  };
}

export function FactoryScene2D(props: FactorySceneProps) {
  const { machines, selectedId, onSelect, overlay, focusId } = props;
  const ctxTheme = useOptionalTheme();
  const theme = props.theme ?? ctxTheme;
  const palette = scenePalette(theme);

  const svgRef = useRef<SVGSVGElement>(null);
  const layout = useMemo(() => resolveLayout(machines), [machines]);
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  // Khung nhìn khớp toàn cảnh (fit-all).
  const fitView = useMemo<ViewBox>(() => {
    const { minX, maxX, minZ, maxZ } = layout.bounds;
    const pad = Math.max(3, layout.radius * 0.15);
    const w = Math.max(10, maxX - minX + pad * 2);
    const h = Math.max(10, maxZ - minZ + pad * 2);
    return { x: minX - pad, y: minZ - pad, w, h };
  }, [layout]);

  const [view, setView] = useState<ViewBox>(fitView);
  const rafRef = useRef<number | null>(null);

  const animateTo = (target: ViewBox, dur = 480) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const start = view;
    const t0 = performance.now();
    const step = (now: number) => {
      const k = easeOutCubic(Math.min(1, (now - t0) / dur));
      setView(lerpVB(start, target, k));
      if (k < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  };

  // Reset khung nhìn CHỈ khi tập máy (cấu trúc) đổi — không reset khi socket cập nhật trạng thái.
  const idsKey = useMemo(
    () => machines.map((m) => m.id).join(","),
    [machines],
  );
  useEffect(() => {
    setView(fitView);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  // Fly-to khi focusId đổi.
  useEffect(() => {
    if (focusId == null) return;
    const p = layout.byId.get(focusId);
    if (!p) return;
    const zw = Math.max(p.w * 6, 14);
    const zh = zw * (fitView.h / fitView.w || 0.7);
    animateTo({ x: p.x - zw / 2, y: p.z - zh / 2, w: zw, h: zh });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);

  /* ------------ Pan (kéo) + Zoom (cuộn) ------------ */
  const dragRef = useRef<{ px: number; py: number; vx: number; vy: number } | null>(
    null,
  );

  const clientToUnitScale = () => {
    const el = svgRef.current;
    if (!el) return 1;
    const rect = el.getBoundingClientRect();
    return view.w / Math.max(1, rect.width);
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    dragRef.current = { px: e.clientX, py: e.clientY, vx: view.x, vy: view.y };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const s = clientToUnitScale();
    setView((v) => ({
      ...v,
      x: d.vx - (e.clientX - d.px) * s,
      y: d.vy - (e.clientY - d.py) * s,
    }));
  };
  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    dragRef.current = null;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  };

  const onWheel = (e: ReactWheelEvent<SVGSVGElement>) => {
    const el = svgRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width; // 0..1
    const my = (e.clientY - rect.top) / rect.height;
    const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
    setView((v) => {
      const nw = Math.max(6, Math.min(layout.radius * 6, v.w * factor));
      const nh = nw * (v.h / v.w);
      // zoom quanh con trỏ
      return {
        x: v.x + (v.w - nw) * mx,
        y: v.y + (v.h - nh) * my,
        w: nw,
        h: nh,
      };
    });
  };

  /* ------------ Nhãn line (đặt ở mép trái mỗi cụm line) ------------ */
  const lineLabels = useMemo(() => {
    const byLine = new Map<
      string,
      { name: string; minX: number; z: number; count: number }
    >();
    for (const p of layout.placed) {
      const name = p.node.lineName || "—";
      const key = `${p.node.lineId ?? "x"}:${name}`;
      const cur = byLine.get(key);
      if (!cur) byLine.set(key, { name, minX: p.x - p.w / 2, z: p.z, count: 1 });
      else {
        cur.minX = Math.min(cur.minX, p.x - p.w / 2);
        cur.count++;
      }
    }
    return Array.from(byLine.values());
  }, [layout]);

  // Ngưỡng hiện nhãn code: khi zoom đủ gần (viewBox nhỏ) hoặc luôn cho selected/hover.
  const showAllCodes = view.w < layout.radius * 1.6;

  const strokeSel = theme === "dark" ? "#f8fafc" : "#0f172a";

  return (
    <div
      className={props.className}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        minHeight: 320,
        background: palette.background,
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <style>{`
        @keyframes fs2dAndon { 0%,100%{ stroke-opacity:1 } 50%{ stroke-opacity:.2 } }
        .fs2d-andon { animation: fs2dAndon 1s ease-in-out infinite; }
      `}</style>
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: "block", cursor: dragRef.current ? "grabbing" : "grab", touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onWheel={onWheel}
      >
        {/* Lưới sàn nhẹ. */}
        <defs>
          <pattern id="fs2dGrid" width="2" height="2" patternUnits="userSpaceOnUse">
            <path d="M2 0H0V2" fill="none" stroke={palette.gridCell} strokeWidth={0.03} />
          </pattern>
        </defs>
        <rect
          x={view.x}
          y={view.y}
          width={view.w}
          height={view.h}
          fill="url(#fs2dGrid)"
        />

        {/* Nhãn line. */}
        {lineLabels.map((l, i) => (
          <text
            key={i}
            x={l.minX - 0.4}
            y={l.z}
            fontSize={0.9}
            fontWeight={700}
            textAnchor="end"
            dominantBaseline="middle"
            fill={palette.gridSection}
            style={{ pointerEvents: "none", userSelect: "none" }}
          >
            {l.name}
          </text>
        ))}

        {/* Máy. */}
        {layout.placed.map((p) => {
          const m = p.node;
          const fill = overlayColorHex(m, overlay);
          const isSel = m.id === selectedId;
          const isHov = m.id === hoveredId;
          const rx = p.x - p.w / 2;
          const ry = p.z - p.d / 2;
          const deg = ((m.rotation || 0) * 180) / Math.PI;
          const showCode = showAllCodes || isSel || isHov;
          return (
            <g
              key={m.id}
              transform={`rotate(${deg} ${p.x} ${p.z})`}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(m.id);
              }}
              onPointerEnter={() => setHoveredId(m.id)}
              onPointerLeave={() => setHoveredId((h) => (h === m.id ? null : h))}
              style={{ cursor: "pointer" }}
            >
              {/* Thân máy. */}
              <rect
                x={rx}
                y={ry}
                width={p.w}
                height={p.d}
                rx={0.18}
                fill={fill}
                fillOpacity={m.status === "offline" ? 0.5 : 0.92}
                stroke={isSel ? strokeSel : isHov ? strokeSel : "rgba(0,0,0,0.35)"}
                strokeWidth={isSel ? 0.16 : isHov ? 0.1 : 0.04}
              />
              {/* Vòng PdM rủi ro cao (gạch nét hổ phách). */}
              {m.pdmRiskHigh && !m.andonActive && (
                <rect
                  x={rx - 0.18}
                  y={ry - 0.18}
                  width={p.w + 0.36}
                  height={p.d + 0.36}
                  rx={0.3}
                  fill="none"
                  stroke="#f59e0b"
                  strokeWidth={0.1}
                  strokeDasharray="0.4 0.3"
                />
              )}
              {/* Viền nháy Andon. */}
              {m.andonActive && (
                <rect
                  className="fs2d-andon"
                  x={rx - 0.22}
                  y={ry - 0.22}
                  width={p.w + 0.44}
                  height={p.d + 0.44}
                  rx={0.32}
                  fill="none"
                  stroke="#ef4444"
                  strokeWidth={0.16}
                />
              )}
              {/* Mã máy. */}
              {showCode && (
                <text
                  x={p.x}
                  y={p.z}
                  fontSize={Math.min(0.6, p.w * 0.28)}
                  fontWeight={700}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={theme === "dark" ? "#0b0f14" : "#0b0f14"}
                  style={{ pointerEvents: "none", userSelect: "none" }}
                >
                  {m.code}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Tooltip hover (DOM, theme-aware). */}
      {hoveredId != null &&
        (() => {
          const p = layout.byId.get(hoveredId);
          if (!p) return null;
          const m = p.node;
          return (
            <div
              style={{
                position: "absolute",
                left: 12,
                bottom: 12,
                padding: "6px 10px",
                borderRadius: 8,
                fontSize: 12,
                background: palette.labelBg,
                color: palette.labelFg,
                border: `1px solid ${palette.labelBorder}`,
                pointerEvents: "none",
                boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
              }}
            >
              <strong>{m.code}</strong> · {m.name}
              <br />
              <span style={{ opacity: 0.75 }}>
                {STATUS_LABEL_VI[m.status]}
                {m.oeePercent != null ? ` · OEE ${m.oeePercent.toFixed(0)}%` : ""}
                {m.lineName ? ` · ${m.lineName}` : ""}
              </span>
            </div>
          );
        })()}
    </div>
  );
}

export default FactoryScene2D;
