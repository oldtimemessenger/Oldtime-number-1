import { createRoot } from "react-dom/client";
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";

const roots = new WeakMap();
const AX = { fontSize: 11, fill: "#6d737c" };
const GRID = "rgba(24,28,34,.12)";
const INK = "#24262b";

function Chart({ kind, data, xKey, yKey, xLabel, yLabel, yPercent }) {
  const margin = { top: 8, right: 10, bottom: 22, left: 8 };
  const axes = [
    <CartesianGrid key="g" stroke={GRID} vertical={false} />,
    <XAxis key="x" dataKey={xKey} tick={AX} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={18} label={{ value: xLabel, position: "insideBottom", offset: -14, style: AX }} />,
    <YAxis key="y" tick={AX} tickLine={false} axisLine={false} allowDecimals={false} width={44} {...(yPercent ? { domain: [0, 100], ticks: [0, 25, 50, 75, 100], tickFormatter: v => `${v}%` } : {})} label={{ value: yLabel, angle: -90, position: "insideLeft", style: AX }} />,
    <Tooltip key="t" formatter={v => [yPercent ? `${v}%` : v, yLabel]} labelFormatter={l => `${xLabel}: ${l}`} contentStyle={{ borderRadius: 10, border: `1px solid ${GRID}`, fontSize: 12 }} />
  ];
  return (
    <ResponsiveContainer width="100%" height={220}>
      {kind === "bar"
        ? <BarChart data={data} margin={margin}>{axes}<Bar dataKey={yKey} fill={INK} radius={[3, 3, 0, 0]} isAnimationActive={false} /></BarChart>
        : <LineChart data={data} margin={margin}>{axes}<Line type="monotone" dataKey={yKey} stroke={INK} strokeWidth={2} dot={data.length < 32} isAnimationActive={false} /></LineChart>}
    </ResponsiveContainer>
  );
}

export function mountStudioChart(el, props) {
  if (!el) return;
  let root = roots.get(el);
  if (!root) { root = createRoot(el); roots.set(el, root); }
  root.render(<Chart {...props} />);
}

export function unmountStudioChart(el) {
  const root = el && roots.get(el);
  if (root) { roots.delete(el); setTimeout(() => root.unmount(), 0); }
}
