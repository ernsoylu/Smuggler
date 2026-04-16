/**
 * D3-powered dual-axis speed graph.
 *
 * Left  Y axis  → Download speed (emerald)
 * Right Y axis  → Upload   speed (blue)
 *
 * Accepts either:
 *   stats  — GlobalStats prop: the component builds its own rolling history.
 *   data   — DataPoint[]  prop: caller owns the history (per-mule cards, footer).
 */
import { useEffect, useRef, useState, useMemo } from 'react';
import * as d3 from 'd3';
import type { GlobalStats } from '../api/types';

const MAX_POINTS = 60;

export interface DataPoint {
  t: number;   // epoch ms
  down: number; // bytes/s
  up: number;   // bytes/s
}

function fmtAxis(v: d3.NumberValue): string {
  const n = +v;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)}M`;
  if (n >= 1_024)     return `${(n / 1_024).toFixed(0)}K`;
  return `${n}`;
}

interface Props {
  /** When provided the component manages its own rolling history. */
  stats?: GlobalStats;
  /** When provided the caller owns the data — internal history is ignored. */
  data?: DataPoint[];
  height?: number;
}

export function SpeedGraph({ stats, data, height = 140 }: Readonly<Props>) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef  = useRef<SVGSVGElement>(null);
  // Unique ID prefix so multiple graphs on the same page don't clash on <defs>
  const uid = useMemo(() => `sg-${Math.random().toString(36).slice(2, 9)}`, []);

  const [internalHistory, setInternalHistory] = useState<DataPoint[]>([]);
  const [width, setWidth] = useState(0);

  // Append global stats to internal rolling buffer
  useEffect(() => {
    if (!stats) return;
    setInternalHistory(prev =>
      [...prev, { t: Date.now(), down: stats.download_speed, up: stats.upload_speed }]
        .slice(-MAX_POINTS)
    );
  }, [stats]);

  // Track container width for responsive re-renders
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(e => setWidth(e[0].contentRect.width));
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const history = data ?? internalHistory;

  // ── D3 render ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!svgRef.current || history.length < 2 || width < 40) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', width).attr('height', height);

    const M = { top: 6, right: 52, bottom: 18, left: 52 };
    const iW = width  - M.left - M.right;
    const iH = height - M.top  - M.bottom;

    // ── Gradient defs ───────────────────────────────────────────────────────
    const defs = svg.append('defs');
    const mkGrad = (id: string, color: string) => {
      const g = defs.append('linearGradient')
        .attr('id', id).attr('x1','0').attr('x2','0').attr('y1','0').attr('y2','1');
      g.append('stop').attr('offset','0%')  .attr('stop-color', color).attr('stop-opacity', 0.28);
      g.append('stop').attr('offset','100%').attr('stop-color', color).attr('stop-opacity', 0.02);
    };
    mkGrad(`${uid}-dg`, '#10b981');
    mkGrad(`${uid}-ug`, '#60a5fa');

    const root = svg.append('g').attr('transform', `translate(${M.left},${M.top})`);

    // ── Scales ──────────────────────────────────────────────────────────────
    const x = d3.scaleTime()
      .domain(d3.extent(history, d => d.t) as [number, number])
      .range([0, iW]);

    const maxD = Math.max(d3.max(history, d => d.down) ?? 0, 512) * 1.25;
    const maxU = Math.max(d3.max(history, d => d.up)   ?? 0, 512) * 1.25;

    const yL = d3.scaleLinear().domain([0, maxD]).range([iH, 0]).nice();
    const yR = d3.scaleLinear().domain([0, maxU]).range([iH, 0]).nice();

    // ── Grid ────────────────────────────────────────────────────────────────
    root.append('g')
      .call(d3.axisLeft(yL).ticks(4).tickSize(-iW).tickFormat(() => ''))
      .call(g => g.select('.domain').remove())
      .call(g => g.selectAll('line')
        .attr('stroke', 'rgba(255,255,255,0.05)')
        .attr('stroke-dasharray', '4 4'));

    // ── Left axis (Download / emerald) ───────────────────────────────────
    root.append('g')
      .call(d3.axisLeft(yL).ticks(4).tickFormat(fmtAxis))
      .call(g => g.select('.domain').attr('stroke', 'rgba(255,255,255,0.07)'))
      .call(g => g.selectAll('.tick line').attr('stroke', 'rgba(255,255,255,0.07)'))
      .call(g => g.selectAll('.tick text')
        .attr('fill', '#10b981').attr('font-size', '10').attr('font-family', 'monospace'));

    // Left axis label
    root.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('x', -iH / 2).attr('y', -44)
      .attr('text-anchor', 'middle')
      .attr('fill', '#10b981').attr('font-size', '9').attr('font-family', 'monospace')
      .attr('opacity', 0.7)
      .text('↓ DL');

    // ── Right axis (Upload / blue) ────────────────────────────────────────
    root.append('g')
      .attr('transform', `translate(${iW},0)`)
      .call(d3.axisRight(yR).ticks(4).tickFormat(fmtAxis))
      .call(g => g.select('.domain').attr('stroke', 'rgba(255,255,255,0.07)'))
      .call(g => g.selectAll('.tick line').attr('stroke', 'rgba(255,255,255,0.07)'))
      .call(g => g.selectAll('.tick text')
        .attr('fill', '#60a5fa').attr('font-size', '10').attr('font-family', 'monospace'));

    // Right axis label
    root.append('text')
      .attr('transform', 'rotate(90)')
      .attr('x', iH / 2).attr('y', -(iW + 44))
      .attr('text-anchor', 'middle')
      .attr('fill', '#60a5fa').attr('font-size', '9').attr('font-family', 'monospace')
      .attr('opacity', 0.7)
      .text('↑ UL');

    // ── Generators ──────────────────────────────────────────────────────────
    const mkArea = (yScale: d3.ScaleLinear<number,number>, key: 'down'|'up') =>
      d3.area<DataPoint>()
        .x(d => x(d.t))
        .y0(iH)
        .y1(d => yScale(d[key]))
        .curve(d3.curveMonotoneX);

    const mkLine = (yScale: d3.ScaleLinear<number,number>, key: 'down'|'up') =>
      d3.line<DataPoint>()
        .x(d => x(d.t))
        .y(d => yScale(d[key]))
        .curve(d3.curveMonotoneX);

    // ── Draw areas ───────────────────────────────────────────────────────────
    root.append('path').datum(history)
      .attr('fill', `url(#${uid}-dg)`).attr('d', mkArea(yL, 'down'));
    root.append('path').datum(history)
      .attr('fill', `url(#${uid}-ug)`).attr('d', mkArea(yR, 'up'));

    // ── Draw lines ───────────────────────────────────────────────────────────
    root.append('path').datum(history)
      .attr('fill', 'none').attr('stroke', '#10b981').attr('stroke-width', 1.8)
      .attr('d', mkLine(yL, 'down'));
    root.append('path').datum(history)
      .attr('fill', 'none').attr('stroke', '#60a5fa').attr('stroke-width', 1.8)
      .attr('d', mkLine(yR, 'up'));

    // ── Live dots on latest point ────────────────────────────────────────────
    const last = history[history.length - 1];
    const dot = (cx: number, cy: number, color: string) =>
      root.append('circle')
        .attr('cx', cx).attr('cy', cy).attr('r', 3.5)
        .attr('fill', color).attr('stroke', '#0a0a0a').attr('stroke-width', 1.5);

    dot(x(last.t), yL(last.down), '#10b981');
    dot(x(last.t), yR(last.up),   '#60a5fa');

  }, [history, width, height, uid]);

  if (history.length < 2) {
    return (
      <div ref={wrapRef} style={{ height }} className="flex items-center justify-center text-[11px] text-neutral-600 font-mono">
        collecting data…
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="w-full">
      <svg ref={svgRef} className="block overflow-visible" />
    </div>
  );
}
