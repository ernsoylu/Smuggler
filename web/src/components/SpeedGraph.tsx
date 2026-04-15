import { useEffect, useRef, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import type { GlobalStats } from '../api/types';

const MAX_POINTS = 60;

interface DataPoint {
  t: number;
  down: number;
  up: number;
}

function formatSpeed(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB/s`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(0)} KB/s`;
  return `${bytes} B/s`;
}

interface Props {
  stats: GlobalStats | undefined;
}

export function SpeedGraph({ stats }: Props) {
  const [history, setHistory] = useState<DataPoint[]>([]);
  const tickRef = useRef(0);

  useEffect(() => {
    if (!stats) return;
    tickRef.current += 1;
    setHistory(prev => {
      const next = [
        ...prev,
        { t: tickRef.current, down: stats.download_speed, up: stats.upload_speed },
      ];
      return next.slice(-MAX_POINTS);
    });
  }, [stats]);

  if (history.length < 2) {
    return (
      <div className="h-32 flex items-center justify-center text-xs text-gray-600">
        Waiting for data…
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={128}>
      <LineChart data={history} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <XAxis dataKey="t" hide />
        <YAxis
          tickFormatter={formatSpeed}
          tick={{ fontSize: 10, fill: '#6b7280' }}
          width={72}
        />
        <Tooltip
          formatter={(value: any) => formatSpeed(Number(value) || 0)}
          labelFormatter={() => ''}
          contentStyle={{ background: '#1f2937', border: '1px solid #374151', fontSize: 12 }}
          itemStyle={{ color: '#d1d5db' }}
        />
        <Legend
          iconSize={8}
          wrapperStyle={{ fontSize: 11, color: '#9ca3af' }}
        />
        <Line
          type="monotone"
          dataKey="down"
          name="Download"
          stroke="#34d399"
          dot={false}
          strokeWidth={1.5}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="up"
          name="Upload"
          stroke="#60a5fa"
          dot={false}
          strokeWidth={1.5}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
