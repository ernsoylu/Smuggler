import { useState, useEffect } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import {
  ActionIcon, Badge, Box, Button, Card, Collapse, Group, Loader, Paper, Progress,
  Stack, Text, Tooltip,
} from '@mantine/core';
import { stopMule, killMule, getMuleTorrents } from '../api/client';
import type { Mule, Torrent } from '../api/types';
import { SpeedGraph } from './SpeedGraph';
import type { DataPoint } from './SpeedGraph';
import {
  Power, Trash2, Globe2, Shield, Radio, TerminalSquare,
  ChevronDown, ChevronUp, CheckCircle2, PauseCircle, Download,
} from 'lucide-react';

const MAX_POINTS = 60;

function fmt(bps: number): string {
  if (bps >= 1_048_576) return `${(bps / 1_048_576).toFixed(1)} MB/s`;
  if (bps >= 1_024)     return `${(bps / 1_024).toFixed(0)} KB/s`;
  return `${bps} B/s`;
}

function fmtBytes(b: number): string {
  if (b >= 1_073_741_824) return `${(b / 1_073_741_824).toFixed(2)} GB`;
  if (b >= 1_048_576)     return `${(b / 1_048_576).toFixed(1)} MB`;
  if (b >= 1_024)         return `${(b / 1_024).toFixed(0)} KB`;
  return `${b} B`;
}

function torrentStatusColor(status: string): string {
  if (status === 'active')   return 'teal.4';
  if (status === 'paused')   return 'yellow.4';
  if (status === 'error')    return 'red.4';
  return 'dimmed';
}

function InfoRow({ icon, label, value, mono }: Readonly<{
  icon?: React.ReactNode; label: string; value: string; mono?: boolean;
}>) {
  return (
    <Group justify="space-between" gap="md" wrap="nowrap">
      <Text size="xs" fw={600} tt="uppercase" c="dimmed" lts={1}
        style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        {icon} {label}
      </Text>
      <Text size="xs" fw={500} ff={mono ? 'monospace' : undefined} truncate>
        {value}
      </Text>
    </Group>
  );
}

interface ExpandedStatsPanelProps {
  history: DataPoint[];
  torrents: Torrent[];
  liveDl: number;
  liveUl: number;
  activeCount: number;
  pausedCount: number;
  completeCount: number;
  totalDl: number;
  totalUl: number;
  expanded: boolean;
}

function ExpandedStatsPanel({ history, torrents, liveDl, liveUl, activeCount, pausedCount, completeCount, totalDl, totalUl, expanded }: Readonly<ExpandedStatsPanelProps>) {
  return (
    <Collapse expanded={expanded}>
      <Box style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
        <Box px="md" pt="md" pb="xs">
          <Text size="10px" fw={600} tt="uppercase" lts={2} c="dimmed" mb={8}>Speed</Text>
          <SpeedGraph data={history} height={110} />
        </Box>
        <Group px="md" pb="sm" gap="md">
          <Group gap={6}>
            <Download size={11} color="var(--mantine-color-teal-4)" />
            <Text size="xs" ff="monospace" fw={600} c="var(--smg-ok)">{fmt(liveDl)}</Text>
          </Group>
          <Group gap={6}>
            <Download size={11} color="var(--mantine-color-blue-4)" style={{ transform: 'rotate(180deg)' }} />
            <Text size="xs" ff="monospace" fw={600} c="var(--smg-info)">{fmt(liveUl)}</Text>
          </Group>
        </Group>
        <Group px="md" pb="sm" gap="xs">
          {activeCount > 0 && (
            <Badge variant="light" color="teal" size="sm" radius="md" tt="none">
              {activeCount} active
            </Badge>
          )}
          {pausedCount > 0 && (
            <Badge variant="light" color="yellow" size="sm" radius="md" tt="none" leftSection={<PauseCircle size={11} />}>
              {pausedCount} paused
            </Badge>
          )}
          {completeCount > 0 && (
            <Badge variant="default" size="sm" radius="md" tt="none" leftSection={<CheckCircle2 size={11} />}>
              {completeCount} done
            </Badge>
          )}
          {torrents.length === 0 && (
            <Text size="11px" c="dimmed" fs="italic">No torrents</Text>
          )}
        </Group>
        {(totalDl > 0 || totalUl > 0) && (
          <Group px="md" pb="sm" gap="md">
            <Text size="xs" c="dimmed">↓ {fmtBytes(totalDl)}</Text>
            <Text size="xs" c="dimmed">↑ {fmtBytes(totalUl)}</Text>
          </Group>
        )}
        {torrents.length > 0 && (
          <Stack px="md" pb="md" gap={6}>
            {torrents.slice(0, 5).map(t => {
              const pct = t.total_length > 0 ? Math.round((t.completed_length / t.total_length) * 100) : 0;
              return (
                <Group key={t.gid} gap="xs" wrap="nowrap">
                  <Stack gap={2} flex={1} miw={0}>
                    <Text size="11px" fw={500} c={torrentStatusColor(t.status)} truncate>
                      {t.name || t.gid}
                    </Text>
                    <Progress size={3} value={pct} color={t.status === 'complete' ? 'gray' : 'teal'} />
                  </Stack>
                  <Text size="11px" c="dimmed" ff="monospace" style={{ flexShrink: 0 }}>{pct}%</Text>
                </Group>
              );
            })}
            {torrents.length > 5 && (
              <Text size="10px" c="dimmed">+{torrents.length - 5} more</Text>
            )}
          </Stack>
        )}
      </Box>
    </Collapse>
  );
}

interface Props {
  mule: Mule;
}

export function MuleCard({ mule }: Readonly<Props>) {
  const qc = useQueryClient();
  const [showConfirm, setShowConfirm] = useState<'stop' | 'kill' | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [history, setHistory] = useState<DataPoint[]>([]);

  const stop = useMutation({
    mutationFn: () => stopMule(mule.name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mules'] }),
  });

  const kill = useMutation({
    mutationFn: () => killMule(mule.name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mules'] }),
  });

  // Per-mule torrent polling — only when card is expanded
  const { data: torrents = [] } = useQuery({
    queryKey: ['mule-torrents', mule.name],
    queryFn: () => getMuleTorrents(mule.name),
    refetchInterval: expanded ? 2_000 : false,
    enabled: expanded && mule.status === 'running',
  });

  // Reset history when the card collapses — render-phase "previous prop"
  // pattern (no extra render, unlike an effect).
  const [prevExpanded, setPrevExpanded] = useState(expanded);
  if (expanded !== prevExpanded) {
    setPrevExpanded(expanded);
    if (!expanded) setHistory([]);
  }

  // Build a rolling speed history from polled torrent data. This is a genuine
  // time-series accumulation keyed on Date.now() (an impure call that must run
  // in an effect, not during render), so the set-state-in-effect rule is waived.
  useEffect(() => {
    if (!expanded || torrents.length === 0) return;
    const dl = torrents.reduce((s, t) => s + (t.download_speed ?? 0), 0);
    const ul = torrents.reduce((s, t) => s + (t.upload_speed ?? 0), 0);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHistory(prev =>
      [...prev, { t: Date.now(), down: dl, up: ul }].slice(-MAX_POINTS)
    );
  }, [torrents, expanded]);

  const isRunning = mule.status === 'running';
  const ip = mule.ip_info;

  // Derived torrent stats when expanded
  const activeCount   = torrents.filter(t => t.status === 'active').length;
  const pausedCount   = torrents.filter(t => t.status === 'paused').length;
  const completeCount = torrents.filter(t => t.status === 'complete').length;
  const totalDl = torrents.reduce((s, t) => s + (t.completed_length ?? 0), 0);
  const totalUl = torrents.reduce((s, t) => s + (t.uploaded_length ?? 0), 0);
  const liveDl  = torrents.reduce((s, t) => s + (t.download_speed ?? 0), 0);
  const liveUl  = torrents.reduce((s, t) => s + (t.upload_speed ?? 0), 0);

  return (
    <Card withBorder radius="lg" p={0} style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <Box p="md" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
        <Group justify="space-between" align="flex-start" gap="md" wrap="nowrap">
          <Group gap="sm" wrap="nowrap" miw={0}>
            <Box
              w={10} h={10} mt={6}
              bg={isRunning ? 'teal.5' : 'gray.6'}
              style={{ borderRadius: '50%', flexShrink: 0 }}
            />
            <Stack gap={0} miw={0}>
              <Text fw={600} truncate>{mule.name}</Text>
              <Text size="xs" c="dimmed" ff="monospace">{mule.id.slice(0, 12)}</Text>
            </Stack>
          </Group>
          <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
            <Badge variant="light" color={isRunning ? 'teal' : 'gray'} tt="capitalize" radius="sm">
              {mule.status}
            </Badge>
            {isRunning && (
              <ActionIcon
                variant="default"
                size="sm"
                onClick={() => setExpanded(v => !v)}
                title={expanded ? 'Collapse' : 'Expand stats'}
                aria-expanded={expanded}
              >
                {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </ActionIcon>
            )}
          </Group>
        </Group>
      </Box>

      {/* Body */}
      <Stack p="md" gap="sm" flex={1}>
        {/* Network info */}
        {ip && (
          <Paper withBorder radius="md" p="sm">
            <Stack gap={8}>
              <InfoRow icon={<Globe2 size={14} />} label="IP" value={ip.ip} mono />
              <InfoRow
                icon={<Shield size={14} />}
                label="Loc"
                value={[ip.city, ip.region, ip.country].filter(Boolean).join(', ')}
              />
              {ip.org && <InfoRow icon={<Radio size={14} />} label="ISP" value={ip.org} />}
            </Stack>
          </Paper>
        )}
        {!ip && isRunning && (
          <Paper withBorder radius="md" p="md">
            <Stack align="center" gap={8}>
              <Loader size="xs" color="teal" />
              <Text size="xs" fw={500} c="var(--smg-ok)">Establishing tunnel...</Text>
            </Stack>
          </Paper>
        )}

        {/* Config meta */}
        <Stack gap={6} mt="auto">
          <Paper radius="md" px="sm" py={8} bg="var(--mantine-color-default-hover)">
            <InfoRow label="Config" value={mule.vpn_config} mono />
          </Paper>
          <Paper radius="md" px="sm" py={8} bg="var(--mantine-color-default-hover)">
            <InfoRow icon={<TerminalSquare size={14} />} label="RPC Port" value={String(mule.rpc_port)} mono />
          </Paper>
        </Stack>
      </Stack>

      {/* Expanded stats panel */}
      <ExpandedStatsPanel
        history={history}
        torrents={torrents}
        liveDl={liveDl}
        liveUl={liveUl}
        activeCount={activeCount}
        pausedCount={pausedCount}
        completeCount={completeCount}
        totalDl={totalDl}
        totalUl={totalUl}
        expanded={expanded}
      />

      {/* Footer — actions */}
      <Box p="sm" mt="auto" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
        {showConfirm ? (
          <Paper
            radius="md"
            p={6}
            style={{
              background: 'var(--mantine-color-red-light)',
              border: '1px solid var(--mantine-color-red-light-color)',
            }}
          >
            <Group gap="xs" wrap="nowrap">
              <Text size="xs" fw={600} c="var(--smg-bad)" flex={1} ml={6}>
                {showConfirm === 'stop' ? 'Stop Gracefully?' : 'Kill Immediately?'}
              </Text>
              <Button
                size="compact-xs"
                color="red"
                onClick={() => {
                  if (showConfirm === 'stop') stop.mutate();
                  else kill.mutate();
                  setShowConfirm(null);
                }}
              >
                Yes
              </Button>
              <Button size="compact-xs" variant="default" onClick={() => setShowConfirm(null)}>
                Cancel
              </Button>
            </Group>
          </Paper>
        ) : (
          /*
           * Stop carries the width; Kill is demoted to an icon.
           *
           * They used to sit side by side at equal weight, so the destructive,
           * abrupt option was one slipped click from the graceful one. Both are
           * still one click plus a confirm — only the visual pull differs.
           */
          <Group gap="xs" wrap="nowrap">
            <Button
              variant="default"
              size="xs"
              flex={1}
              leftSection={<Power size={15} />}
              onClick={() => setShowConfirm('stop')}
              disabled={stop.isPending || kill.isPending}
            >
              Stop
            </Button>
            <Tooltip label="Kill immediately — no graceful shutdown" withArrow>
              <ActionIcon
                variant="subtle"
                color="red"
                size="lg"
                aria-label="Kill mule immediately"
                onClick={() => setShowConfirm('kill')}
                disabled={stop.isPending || kill.isPending}
              >
                <Trash2 size={15} />
              </ActionIcon>
            </Tooltip>
          </Group>
        )}
      </Box>
    </Card>
  );
}
