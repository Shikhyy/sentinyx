import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

// The nav logo: three rings of dots on night, with one signal dot.
export default function Icon() {
  const dots: { x: number; y: number; r: number; c: string }[] = [];
  [[10, 8], [18, 14], [26, 20]].forEach(([r, n], k) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + k * 0.5;
      dots.push({ x: 32 + Math.cos(a) * r, y: 32 + Math.sin(a) * r, r: 1.9, c: k === 1 && i === 0 ? "#FF5F1F" : `rgba(233,230,223,${0.4 + 0.2 * k})` });
    }
  });
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", background: "#1C1C1B", borderRadius: 14, display: "flex" }}>
        <svg width="64" height="64" viewBox="0 0 64 64">
          {dots.map((d, i) => (
            <circle key={i} cx={d.x} cy={d.y} r={d.r} fill={d.c} />
          ))}
        </svg>
      </div>
    ),
    size,
  );
}
