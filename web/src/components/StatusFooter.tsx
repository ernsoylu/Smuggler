/**
 * Persistent status bar footer — visible on all pages.
 *
 * Collapsed: shows ↓ DL / ↑ UL speeds, active torrents, active mules.
 * Expanded:  also shows the D3 SpeedGraph with rolling history.
 */
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Box, Collapse, Divider, Group, SimpleGrid, Stack, Text, UnstyledButton,
} from '@mantine/core';
import { getStats, getAllTorrents } from '../api/client';
import { SpeedGraph } from './SpeedGraph';
import type { DataPoint } from './SpeedGraph';
import { ChevronUp, ChevronDown, Activity, Download, Upload, Server } from 'lucide-react';

const MAX_POINTS = 60;

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function SummaryRow({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <Group justify="space-between" gap="xl" wrap="nowrap">
      <Text size="sm" c="dimmed">{label}</Text>
      <Text size="sm" ff="monospace" fw={500}>{value}</Text>
    </Group>
  );
}

function CountCell({ label, value, color }: Readonly<{ label: string; value: number; color: string }>) {
  return (
    <Group justify="space-between" gap="sm" wrap="nowrap">
      <Group gap={6} wrap="nowrap">
        <Box w={6} h={6} bg={color} style={{ borderRadius: '50%' }} />
        <Text size="sm">{label}</Text>
      </Group>
      <Text size="sm" ff="monospace" fw={500} c={color}>{value}</Text>
    </Group>
  );
}

export function StatusFooter() {
  const [expanded, setExpanded] = useState(false);
  const [history, setHistory] = useState<DataPoint[]>([]);

  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: getStats,
    refetchInterval: 2_000,
  });

  const { data: torrents = [] } = useQuery({
    queryKey: ['torrents'],
    queryFn: getAllTorrents,
    refetchInterval: 2_000,
  });

  // Build a rolling speed history from polled stats. Genuine time-series
  // accumulation keyed on Date.now() (impure — must run in an effect), so the
  // set-state-in-effect rule is intentionally waived here.
  useEffect(() => {
    if (!stats) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHistory(prev =>
      [...prev, { t: Date.now(), down: stats.download_speed, up: stats.upload_speed }]
        .slice(-MAX_POINTS)
    );
  }, [stats]);

  const dl   = stats?.download_speed ?? 0;
  const ul   = stats?.upload_speed   ?? 0;
  const active  = stats?.num_active   ?? 0;
  const waiting = stats?.num_waiting  ?? 0;
  const mules   = stats?.num_mules    ?? 0;

  const totalDownloaded = torrents.reduce((sum, t) => sum + t.completed_length, 0);
  const totalUploaded   = torrents.reduce((sum, t) => sum + t.uploaded_length, 0);
  const avgRatio = torrents.length > 0
    ? (torrents.reduce((sum, t) => sum + t.ratio, 0) / torrents.length)
    : 0;

  const counts = {
    active: torrents.filter(t => t.status === 'active').length,
    waiting: torrents.filter(t => t.status === 'waiting').length,
    paused: torrents.filter(t => t.status === 'paused').length,
    complete: torrents.filter(t => t.status === 'complete').length,
    error: torrents.filter(t => t.status === 'error').length,
  };

  const isActive = dl > 0 || ul > 0 || active > 0;

  return (
    <Box
      component="footer"
      style={{
        flexShrink: 0,
        borderTop: '1px solid var(--mantine-color-default-border)',
        background: 'var(--mantine-color-body)',
      }}
    >
      {/* Graph panel — slides open above the bar */}
      <Collapse expanded={expanded}>
        <Group px="lg" py="md" gap="xl" align="stretch" wrap="wrap">
          <Box flex={1} miw={280} pos="relative">
            <Text
              size="10px" tt="uppercase" fw={600} c="dimmed" lts={2}
              pos="absolute" top={-2} left={8} style={{ zIndex: 1 }}
            >
              Bandwidth History
            </Text>
            <Box pt="md">
              <SpeedGraph data={history} height={140} />
            </Box>
          </Box>

          <Divider orientation="vertical" visibleFrom="md" />

          <Stack gap="xs" miw={150} justify="center">
            <Text size="10px" tt="uppercase" fw={600} c="dimmed" lts={2}>Transfer Summary</Text>
            <SummaryRow label="Downloaded" value={formatBytes(totalDownloaded)} />
            <SummaryRow label="Uploaded" value={formatBytes(totalUploaded)} />
            <SummaryRow label="Avg Ratio" value={avgRatio.toFixed(3)} />
          </Stack>

          <Divider orientation="vertical" />

          <Stack gap="xs" miw={200} justify="center">
            <Text size="10px" tt="uppercase" fw={600} c="dimmed" lts={2}>Distribution</Text>
            <SimpleGrid cols={2} spacing="lg" verticalSpacing={8}>
              <CountCell label="Active" value={counts.active} color="teal.5" />
              <CountCell label="Complete" value={counts.complete} color="gray.5" />
              <CountCell label="Queued" value={counts.waiting} color="smuggler.5" />
              <CountCell label="Error" value={counts.error} color="red.5" />
              <CountCell label="Paused" value={counts.paused} color="blue.5" />
            </SimpleGrid>
          </Stack>
        </Group>
      </Collapse>

      {/* Status bar */}
      <Group px="md" py={6} gap="md" wrap="nowrap">
        <UnstyledButton
          onClick={() => setExpanded(v => !v)}
          title={expanded ? 'Collapse graph' : 'Expand graph'}
          aria-expanded={expanded}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          c="dimmed"
        >
          <Activity size={14} color={isActive ? 'var(--mantine-color-teal-5)' : 'currentColor'} />
          {expanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </UnstyledButton>

        <Divider orientation="vertical" h={16} style={{ alignSelf: 'center' }} />

        <Group gap={6} wrap="nowrap" miw={90}>
          <Download size={13} color="var(--mantine-color-teal-5)" />
          <Text size="xs" ff="monospace" fw={600} c="teal.4">{formatBytes(dl)}/s</Text>
        </Group>

        <Group gap={6} wrap="nowrap" miw={90}>
          <Upload size={13} color="var(--mantine-color-blue-5)" />
          <Text size="xs" ff="monospace" fw={600} c="blue.4">{formatBytes(ul)}/s</Text>
        </Group>

        <Divider orientation="vertical" h={16} style={{ alignSelf: 'center' }} />

        <Group gap={6} wrap="nowrap">
          <Box
            w={6} h={6}
            bg={active > 0 ? 'teal.5' : 'gray.6'}
            style={{ borderRadius: '50%' }}
            className={active > 0 ? 'smuggler-pulse' : undefined}
          />
          <Text size="xs" fw={600}>{active}</Text>
          <Text size="xs" c="dimmed">active</Text>
          {waiting > 0 && <Text size="xs" c="dimmed">· {waiting} queued</Text>}
        </Group>

        <Divider orientation="vertical" h={16} style={{ alignSelf: 'center' }} />

        <Group gap={6} wrap="nowrap">
          <Server size={12} color="var(--mantine-color-dimmed)" />
          <Text size="xs" fw={600}>{mules}</Text>
          <Text size="xs" c="dimmed">mule{mules === 1 ? '' : 's'}</Text>
        </Group>

        <Box flex={1} />

        <Text size="10px" c="dimmed" ff="monospace" visibleFrom="sm" style={{ userSelect: 'none' }}>
          Smuggler
        </Text>
      </Group>
    </Box>
  );
}
