import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ActionIcon, Badge, Box, Button, Checkbox, Group, Loader, NumberInput, Paper,
  Progress, SimpleGrid, Stack, Table, Tabs, Text, TextInput,
} from '@mantine/core';
import {
  removeTorrent, pauseTorrent, resumeTorrent,
  getTorrentPeers, getTorrentOptions, setTorrentOptions, setFileSelection,
  setTorrentCategory,
} from '../api/client';
import type { Torrent, Peer, TorrentOptions } from '../api/types';
import {
  Play, Pause, Trash2, ChevronDown, ChevronRight,
  File as FileIcon, Users, Settings2, Info, HardDrive,
} from 'lucide-react';
import { DeleteTorrentModal } from './DeleteTorrentModal';

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec >= 1_048_576) return `${(bytesPerSec / 1_048_576).toFixed(1)} MB/s`;
  if (bytesPerSec >= 1_024) return `${(bytesPerSec / 1_024).toFixed(0)} KB/s`;
  return bytesPerSec > 0 ? `${bytesPerSec} B/s` : '—';
}

function formatEta(seconds: number): string {
  if (seconds < 0) return '∞';
  if (seconds === 0) return '—';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

/** Mantine color per aria2 status — badges, progress bars, accents. */
const STATUS_COLORS: Record<string, string> = {
  active: 'teal',
  waiting: 'orange',
  paused: 'blue',
  error: 'red',
  complete: 'gray',
  removed: 'dark',
};

function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? 'dark';
}

type DetailTab = 'status' | 'details' | 'files' | 'peers' | 'options';

const TABS: { id: DetailTab; label: string; icon: React.ReactNode }[] = [
  { id: 'status',  label: 'Status',  icon: <Info size={13} /> },
  { id: 'details', label: 'Details', icon: <HardDrive size={13} /> },
  { id: 'files',   label: 'Files',   icon: <FileIcon size={13} /> },
  { id: 'peers',   label: 'Peers',   icon: <Users size={13} /> },
  { id: 'options', label: 'Options', icon: <Settings2 size={13} /> },
];

// ── Sub-panels ────────────────────────────────────────────────────────────────

function StatCell({ label, value, color, span }: Readonly<{
  label: string; value: string | number; color?: string; span?: boolean;
}>) {
  return (
    <Paper withBorder radius="md" px="sm" py={6} style={span ? { gridColumn: '1 / -1' } : undefined}>
      <Text size="10px" tt="uppercase" fw={600} c="dimmed" lts={1}>{label}</Text>
      <Text size="xs" ff="monospace" c={color} style={{ wordBreak: 'break-all' }}>{value}</Text>
    </Paper>
  );
}

function StatusTab({ torrent }: Readonly<{ torrent: Torrent }>) {
  const color = statusColor(torrent.status);
  const progress = Math.min(100, torrent.progress);
  const remaining = torrent.total_length - torrent.completed_length;
  return (
    <Stack gap="md">
      <div>
        <Group justify="space-between" mb={6}>
          <Text size="xs" c="dimmed">{progress.toFixed(2)}% complete</Text>
          {torrent.eta >= 0 && torrent.status === 'active' && (
            <Text size="xs" c="dimmed">ETA: {formatEta(torrent.eta)}</Text>
          )}
        </Group>
        <Progress value={progress} color={color} size="md" radius="xl" />
      </div>
      <SimpleGrid type="container" cols={{ base: 2, '700px': 4 }} spacing="sm">
        <StatCell label="Downloaded" value={formatBytes(torrent.completed_length)} color="teal.4" />
        <StatCell label="Uploaded" value={formatBytes(torrent.uploaded_length)} color="blue.4" />
        <StatCell label="Remaining" value={remaining > 0 ? formatBytes(remaining) : '—'} />
        <StatCell label="Ratio" value={torrent.ratio.toFixed(3)} />
        <StatCell label="DL Speed" value={formatSpeed(torrent.download_speed)} color="teal.4" />
        <StatCell label="UL Speed" value={formatSpeed(torrent.upload_speed)} color="blue.4" />
        <StatCell label="Seeds" value={torrent.num_seeders} />
        <StatCell label="Peers" value={torrent.connections} />
        {torrent.is_seed && <StatCell label="State" value="Seeding" color="teal.4" />}
        {torrent.tracker && <StatCell label="Tracker" value={torrent.tracker} span />}
        {torrent.error_message && (
          <StatCell label={`Error (${torrent.error_code})`} value={torrent.error_message} color="red.4" span />
        )}
      </SimpleGrid>
    </Stack>
  );
}

function CategoryEditor({ torrent }: Readonly<{ torrent: Torrent }>) {
  const qc = useQueryClient();
  const [value, setValue] = useState(torrent.category ?? '');
  const save = useMutation({
    mutationFn: () => setTorrentCategory(torrent.info_hash, value.trim()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['torrents'] }),
  });
  const dirty = value.trim() !== (torrent.category ?? '');

  return (
    <Group align="flex-end" gap="xs">
      <TextInput
        id={`cat-${torrent.gid}`}
        label="Category"
        size="xs"
        flex={1}
        value={value}
        maxLength={64}
        placeholder="Uncategorised"
        onChange={e => setValue(e.currentTarget.value)}
        onKeyDown={e => { if (e.key === 'Enter' && dirty) save.mutate(); }}
      />
      <Button size="xs" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
        {save.isPending ? 'Saving…' : 'Set'}
      </Button>
    </Group>
  );
}

function DetailsTab({ torrent }: Readonly<{ torrent: Torrent }>) {
  return (
    <Stack gap="sm">
      <CategoryEditor torrent={torrent} />
      <SimpleGrid type="container" cols={{ base: 2, '700px': 4 }} spacing="sm">
        <StatCell label="Total Size" value={formatBytes(torrent.total_length)} />
        {torrent.mode && <StatCell label="Mode" value={torrent.mode} />}
        {torrent.num_pieces > 0 && (
          <StatCell label="Pieces" value={`${torrent.num_pieces} × ${formatBytes(torrent.piece_length)}`} />
        )}
        {torrent.creation_date > 0 && (
          <StatCell label="Created" value={new Date(torrent.creation_date * 1000).toLocaleDateString()} />
        )}
        {torrent.info_hash && <StatCell label="Info Hash" value={torrent.info_hash} span />}
        {torrent.save_path && <StatCell label="Save Path" value={torrent.save_path} span />}
        {torrent.comment && <StatCell label="Comment" value={torrent.comment} span />}
      </SimpleGrid>
    </Stack>
  );
}

function FilesTab({ torrent }: Readonly<{ torrent: Torrent }>) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<Set<number>>(new Set());

  const toggleFile = useMutation({
    mutationFn: async (fileIndex: number) => {
      const selected = torrent.files.filter(f => f.selected).map(f => f.index);
      let next: number[];
      if (selected.includes(fileIndex)) {
        next = selected.filter(i => i !== fileIndex);
      } else {
        next = [...selected, fileIndex];
      }
      await setFileSelection(torrent.mule, torrent.gid, next);
      return { fileIndex, next };
    },
    onMutate: (fileIndex) => setPending(prev => new Set([...prev, fileIndex])),
    onSettled: (_data, _err, fileIndex) =>
      setPending(prev => { const s = new Set(prev); s.delete(fileIndex); return s; }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['torrents'] }),
  });

  if (!torrent.files || torrent.files.length === 0) {
    return <Text size="xs" c="dimmed" py="xs">No file information available.</Text>;
  }

  return (
    <Table fz="xs" verticalSpacing={6}>
      <Table.Thead>
        <Table.Tr>
          <Table.Th w={40} ta="center">#</Table.Th>
          <Table.Th>Filename</Table.Th>
          <Table.Th w={100} ta="right">Size</Table.Th>
          <Table.Th w={160}>Progress</Table.Th>
          <Table.Th w={90} ta="center">Priority</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {torrent.files.map((file) => (
          <Table.Tr key={file.index} opacity={file.selected ? 1 : 0.5}>
            <Table.Td ta="center" c="dimmed" ff="monospace">{file.index}</Table.Td>
            <Table.Td>
              <Group gap={6} wrap="nowrap">
                <FileIcon size={13} color="var(--mantine-color-dimmed)" style={{ flexShrink: 0 }} />
                <Text size="xs" truncate maw={320} title={file.name}>{file.name}</Text>
              </Group>
            </Table.Td>
            <Table.Td ta="right" c="dimmed" ff="monospace">{formatBytes(file.total_length)}</Table.Td>
            <Table.Td>
              <Stack gap={4}>
                <Group justify="space-between">
                  <Text size="10px" c="dimmed">{formatBytes(file.completed_length)}</Text>
                  <Text size="10px" c="dimmed">{file.progress.toFixed(1)}%</Text>
                </Group>
                <Progress size="xs" value={file.progress} color={file.progress === 100 ? 'gray' : 'blue'} />
              </Stack>
            </Table.Td>
            <Table.Td ta="center">
              <Button
                size="compact-xs"
                variant={file.selected ? 'light' : 'default'}
                color={file.selected ? 'teal' : 'gray'}
                onClick={() => toggleFile.mutate(file.index)}
                disabled={pending.has(file.index)}
                title={file.selected ? 'Click to skip this file' : 'Click to download this file'}
              >
                {file.selected ? 'Normal' : 'Skip'}
              </Button>
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

/*
 * Peer country flags used to be resolved here by fetching
 * https://get.geojs.io/v1/ip/country/<ip> once per visible peer, from the
 * browser, over clearnet.
 *
 * That inverted the product's entire premise. The backend exists so torrent
 * traffic only ever leaves through a kill-switched tunnel; the UI was then
 * handing the peer list — the precise correlation data that architecture
 * suppresses — to a third-party geolocation service, tagged with the user's
 * real IP. It is metadata rather than payload, but it is exactly the metadata
 * the threat model is about.
 *
 * Removed rather than relocated: doing the same lookup from the API container
 * would move the leak, not close it, since the API is not behind the tunnel
 * either. Restoring flags means resolving offline from a local MMDB (DB-IP
 * Lite or similar) shipped in the API image — until that lands, no flag.
 */

function PeersTab({ torrent, isVisible }: Readonly<{ torrent: Torrent; isVisible: boolean }>) {
  const { data: peers = [], isLoading } = useQuery<Peer[]>({
    queryKey: ['peers', torrent.mule, torrent.gid],
    queryFn: () => getTorrentPeers(torrent.mule, torrent.gid),
    enabled: isVisible,
    refetchInterval: isVisible ? 3_000 : false,
  });

  if (isLoading) {
    return (
      <Group gap="xs" py="md">
        <Loader size="xs" />
        <Text size="xs" c="dimmed">Loading peers…</Text>
      </Group>
    );
  }

  if (peers.length === 0) {
    return <Text size="xs" c="dimmed" py="xs">No active peers connected.</Text>;
  }

  return (
    <Table fz="xs" verticalSpacing={6}>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>IP Address</Table.Th>
          <Table.Th ta="right">DL Speed</Table.Th>
          <Table.Th ta="right">UL Speed</Table.Th>
          <Table.Th ta="center">Progress</Table.Th>
          <Table.Th ta="center">Type</Table.Th>
          <Table.Th ta="center">Choked</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {peers.map((peer) => (
          <Table.Tr key={`${peer.ip}:${peer.port}`}>
            <Table.Td ff="monospace">
                    {peer.ip}:{peer.port}
            </Table.Td>
            <Table.Td ta="right" c="var(--smg-ok)" ff="monospace">{formatSpeed(peer.download_speed)}</Table.Td>
            <Table.Td ta="right" c="var(--smg-info)" ff="monospace">{formatSpeed(peer.upload_speed)}</Table.Td>
            <Table.Td>
              <Group gap={4} justify="center" wrap="nowrap">
                <Progress size="xs" value={peer.progress * 100} color="gray" w={64} />
                <Text size="10px" c="dimmed" ff="monospace">{(peer.progress * 100).toFixed(0)}%</Text>
              </Group>
            </Table.Td>
            <Table.Td ta="center">
              <Badge size="xs" variant="light" color={peer.seeder ? 'teal' : 'gray'}>
                {peer.seeder ? 'Seed' : 'Peer'}
              </Badge>
            </Table.Td>
            <Table.Td ta="center">
              <Text size="10px" c={peer.peer_choking ? 'orange.4' : 'dimmed'}>
                {peer.peer_choking ? 'Choked' : '—'}
              </Text>
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

function OptionsTab({ torrent, isVisible }: Readonly<{ torrent: Torrent; isVisible: boolean }>) {
  const qc = useQueryClient();
  const [localOpts, setLocalOpts] = useState<Partial<TorrentOptions>>({});
  const [saved, setSaved] = useState(false);

  const { data: options, isLoading } = useQuery<TorrentOptions>({
    queryKey: ['torrent-options', torrent.mule, torrent.gid],
    queryFn: () => getTorrentOptions(torrent.mule, torrent.gid),
    enabled: isVisible,
  });

  const save = useMutation({
    mutationFn: () => setTorrentOptions(torrent.mule, torrent.gid, localOpts),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['torrent-options', torrent.mule, torrent.gid] });
      setLocalOpts({});
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  if (isLoading) {
    return (
      <Group gap="xs" py="md">
        <Loader size="xs" />
        <Text size="xs" c="dimmed">Loading options…</Text>
      </Group>
    );
  }

  const current = { ...options, ...localOpts } as TorrentOptions;
  const isDirty = Object.keys(localOpts).length > 0;

  return (
    <Stack gap="md" maw={520}>
      <Text size="xs" c="dimmed">
        Override global bandwidth limits for this torrent.
        Set to <Text component="span" ff="monospace" size="xs">0</Text> to use the global limit.
      </Text>
      <SimpleGrid type="container" cols={{ base: 1, '520px': 3 }} spacing="md">
        <NumberInput
          id="opt-max-dl"
          label="Max Download (B/s)"
          size="xs"
          min={0}
          value={localOpts.max_download_speed ?? current.max_download_speed ?? 0}
          onChange={v => setLocalOpts(o => ({ ...o, max_download_speed: Number(v) || 0 }))}
        />
        <NumberInput
          id="opt-max-ul"
          label="Max Upload (B/s)"
          size="xs"
          min={0}
          value={localOpts.max_upload_speed ?? current.max_upload_speed ?? 0}
          onChange={v => setLocalOpts(o => ({ ...o, max_upload_speed: Number(v) || 0 }))}
        />
        <NumberInput
          id="opt-max-conn"
          label="Max Connections"
          size="xs"
          min={1}
          max={16}
          value={localOpts.max_connections ?? current.max_connections ?? 1}
          onChange={v => setLocalOpts(o => ({ ...o, max_connections: Number(v) || 1 }))}
        />
      </SimpleGrid>
      <Checkbox
        size="xs"
        checked={localOpts.prioritize_first_last ?? current.prioritize_first_last ?? false}
        onChange={e => setLocalOpts(o => ({ ...o, prioritize_first_last: e.currentTarget.checked }))}
        label="Prioritise first & last pieces"
        description="Fetches the ends of each file first, so a partial download can be previewed. aria2 has no true sequential mode; this is the equivalent it supports."
      />
      <Group gap="sm">
        <Button size="xs" onClick={() => save.mutate()} disabled={!isDirty || save.isPending}>
          {save.isPending ? 'Saving…' : 'Apply'}
        </Button>
        {saved && <Text size="xs" c="var(--smg-ok)">Saved!</Text>}
        {save.isError && <Text size="xs" c="var(--smg-bad)">Failed to save</Text>}
      </Group>
    </Stack>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props {
  torrent: Torrent;
  selected?: boolean;
  onToggleSelected?: () => void;
  /**
   * Expansion is owned by the page, not the row. Local state was destroyed
   * whenever pagination, sorting or filtering unmounted the row, so an open
   * detail panel silently closed itself; the page also needs to know a row is
   * open so it can stop the list reordering underneath it.
   */
  expanded?: boolean;
  onToggleExpanded?: () => void;
}

export function TorrentRow({
  torrent, selected = false, onToggleSelected, expanded, onToggleExpanded,
}: Readonly<Props>) {
  const qc = useQueryClient();
  const [showConfirm, setShowConfirm] = useState(false);
  // Uncontrolled fallback keeps the component usable on its own (and in tests)
  // when a caller does not lift the state.
  const [localExpanded, setLocalExpanded] = useState(false);
  const isExpanded = expanded ?? localExpanded;
  const toggleExpanded = onToggleExpanded ?? (() => setLocalExpanded(v => !v));
  const [activeTab, setActiveTab] = useState<DetailTab>('status');

  const pause = useMutation({
    mutationFn: () => pauseTorrent(torrent.mule, torrent.gid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['torrents'] }),
  });

  const resume = useMutation({
    mutationFn: () => resumeTorrent(torrent.mule, torrent.gid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['torrents'] }),
  });

  const remove = useMutation({
    mutationFn: (deleteFiles: boolean) => removeTorrent(torrent.mule, torrent.gid, deleteFiles),
    onSuccess: () => {
      setShowConfirm(false);
      qc.invalidateQueries({ queryKey: ['torrents'] });
    },
  });

  const progress = Math.min(100, torrent.progress);

  const startDisabled = torrent.status === 'active' || torrent.status === 'waiting';
  const stopDisabled = torrent.status === 'paused' || torrent.status === 'complete' || torrent.status === 'error' || torrent.status === 'removed';

  const color = statusColor(torrent.status);

  return (
    <React.Fragment>
      <Table.Tr bg={selected ? 'var(--mantine-color-blue-light)' : undefined}>
        {/* Bulk selection */}
        <Table.Td w={40} pl="md">
          <Checkbox
            size="xs"
            checked={selected}
            onChange={onToggleSelected}
            aria-label={`Select ${torrent.name}`}
          />
        </Table.Td>

        {/* Name */}
        <Table.Td maw={280}>
          <Group gap={6} wrap="nowrap" align="flex-start">
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              mt={2}
              onClick={toggleExpanded}
              title={isExpanded ? 'Collapse' : 'Expand details'}
              aria-expanded={isExpanded}
            >
              {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </ActionIcon>
            <Stack gap={2} miw={0}>
              <Text size="sm" fw={500} truncate title={torrent.name}>
                {torrent.name || torrent.gid}
              </Text>
              <Text size="11px" c="dimmed" ff="monospace" truncate>
                {torrent.mule} • {torrent.gid}
              </Text>
            </Stack>
          </Group>
        </Table.Td>

        {/* Status */}
        <Table.Td style={{ whiteSpace: 'nowrap' }}>
          <Badge variant="light" color={color} tt="capitalize" radius="sm">
            {torrent.status}
            {torrent.is_metadata && ' (Meta)'}
          </Badge>
        </Table.Td>

        {/* Progress */}
        <Table.Td miw={180}>
          <Stack gap={6}>
            <Group justify="space-between">
              <Text size="xs" c="dimmed" fw={500}>
                {formatBytes(torrent.completed_length)} / {formatBytes(torrent.total_length)}
              </Text>
              <Text size="xs" fw={600}>{progress.toFixed(1)}%</Text>
            </Group>
            <Progress size="sm" value={progress} color={color} radius="xl" />
          </Stack>
        </Table.Td>

        {/* ETA */}
        <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>
          <Text size="xs" c="dimmed" ff="monospace">
            {torrent.status === 'active' && torrent.eta !== 0 ? formatEta(torrent.eta) : '—'}
          </Text>
        </Table.Td>

        {/* Speed */}
        <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>
          <Stack gap={2}>
            <Text size="xs" fw={500} c="var(--smg-ok)">{formatSpeed(torrent.download_speed)} ↓</Text>
            <Text size="xs" fw={500} c="var(--smg-info)">{formatSpeed(torrent.upload_speed)} ↑</Text>
          </Stack>
        </Table.Td>

        {/* Seeds / Peers */}
        <Table.Td ta="center" style={{ whiteSpace: 'nowrap' }}>
          <Group gap={6} justify="center" wrap="nowrap">
            <Badge variant="default" radius="sm" ff="monospace" title="Seeders">{torrent.num_seeders}</Badge>
            <Badge variant="default" radius="sm" ff="monospace" title="Peers">{torrent.connections}</Badge>
          </Group>
        </Table.Td>

        {/* Ratio */}
        <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>
          <Text size="xs" ff="monospace" c={torrent.ratio >= 1 ? 'teal.4' : 'dimmed'}>
            {torrent.ratio.toFixed(3)}
          </Text>
        </Table.Td>

        {/* Mule */}
        <Table.Td style={{ whiteSpace: 'nowrap' }}>
          <Badge variant="default" radius="sm" ff="monospace" tt="none">{torrent.mule}</Badge>
        </Table.Td>

        {/* Actions */}
        <Table.Td ta="right" pr="md" style={{ whiteSpace: 'nowrap' }}>
          <Group gap={6} justify="flex-end" wrap="nowrap">
            <ActionIcon
              variant="light"
              color="blue"
              onClick={() => resume.mutate()}
              disabled={startDisabled}
              loading={resume.isPending}
              title="Start"
            >
              <Play size={15} />
            </ActionIcon>
            <ActionIcon
              variant="default"
              onClick={() => pause.mutate()}
              disabled={stopDisabled}
              loading={pause.isPending}
              title="Stop"
            >
              <Pause size={15} />
            </ActionIcon>
            <ActionIcon
              variant="light"
              color="red"
              onClick={() => setShowConfirm(true)}
              title="Remove"
            >
              <Trash2 size={15} />
            </ActionIcon>
          </Group>
        </Table.Td>
      </Table.Tr>

      {/* Expanded Detail Panel with Tabs */}
      {isExpanded && (
        <Table.Tr>
          <Table.Td colSpan={10} p={0} style={{ background: 'var(--mantine-color-default-hover)' }}>
            <Tabs
              value={activeTab}
              onChange={v => setActiveTab((v ?? 'status') as DetailTab)}
              px="xl"
              pt="xs"
            >
              <Tabs.List>
                {TABS.map(tab => (
                  <Tabs.Tab key={tab.id} value={tab.id} leftSection={tab.icon} fz="xs">
                    {tab.label}
                  </Tabs.Tab>
                ))}
              </Tabs.List>
            </Tabs>
            <Box px="xl" py="md" mah={420} style={{ overflowY: 'auto' }}>
              {activeTab === 'status'  && <StatusTab torrent={torrent} />}
              {activeTab === 'details' && <DetailsTab torrent={torrent} />}
              {activeTab === 'files'   && <FilesTab torrent={torrent} />}
              {activeTab === 'peers'   && <PeersTab torrent={torrent} isVisible={isExpanded && activeTab === 'peers'} />}
              {activeTab === 'options' && <OptionsTab torrent={torrent} isVisible={isExpanded && activeTab === 'options'} />}
            </Box>
          </Table.Td>
        </Table.Tr>
      )}

      {/* Delete Confirmation Modal */}
      <DeleteTorrentModal
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={(deleteFiles) => remove.mutate(deleteFiles)}
        isPending={remove.isPending}
        torrentName={torrent.name || torrent.gid}
      />
    </React.Fragment>
  );
}
