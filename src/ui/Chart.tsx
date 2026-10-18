/**
 * Graphique uPlot minimal (séries partageant un axe x).
 */
import { useEffect, useRef } from 'react';
import uPlot from 'uplot';

export interface ChartSeries {
  label: string;
  values: ArrayLike<number | null>;
  color: string;
  /** axe de droite */
  right?: boolean;
  /** points seuls (ex. point de fonctionnement) */
  points?: boolean;
  dash?: number[];
}

interface Props {
  title: string;
  x: ArrayLike<number>;
  xLabel: string;
  series: ChartSeries[];
  yLabel: string;
  yRightLabel?: string;
  height?: number;
}

export function Chart({ title, x, xLabel, series, yLabel, yRightLabel, height = 220 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const opts: uPlot.Options = {
      title,
      width: el.clientWidth || 600,
      height,
      scales: { x: { time: false } },
      legend: { live: true },
      axes: [
        { label: xLabel, stroke: '#8a8f98', grid: { stroke: 'rgba(138,143,152,0.18)' } },
        { label: yLabel, scale: 'y', stroke: '#8a8f98', grid: { stroke: 'rgba(138,143,152,0.18)' } },
        ...(yRightLabel ? [{ label: yRightLabel, scale: 'y2', side: 1, stroke: '#8a8f98', grid: { show: false } } as uPlot.Axis] : []),
      ],
      series: [
        { label: xLabel },
        ...series.map((s) => ({
          label: s.label,
          stroke: s.color,
          width: s.points ? 0 : 1.6,
          dash: s.dash,
          scale: s.right ? 'y2' : 'y',
          points: s.points ? { show: true, size: 9, fill: s.color, stroke: s.color } : { show: false },
          spanGaps: false,
        })),
      ],
    };
    const data = [Array.from(x), ...series.map((s) => Array.from(s.values))] as uPlot.AlignedData;
    const plot = new uPlot(opts, data, el);
    const ro = new ResizeObserver(() => plot.setSize({ width: el.clientWidth, height }));
    ro.observe(el);
    return () => {
      ro.disconnect();
      plot.destroy();
    };
  }, [title, x, xLabel, series, yLabel, yRightLabel, height]);
  return <div className="chart" ref={ref} />;
}
