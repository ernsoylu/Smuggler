import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge, Box, Button, Checkbox, Group, Loader, NumberInput, Paper,
  Progress, SimpleGrid, Stack, Table, Tabs, Text, TextInput,
} from '@mantine/core';
import {
  getTorrentPeers, getTorrentOptions, setTorrentOptions, setFileSelection,
  setTorrentCategory,
} from '../api/client';
import type { Torrent, Peer, TorrentOptions } from '../api/types';
import { File as FileIcon, Users, Settings2, Info, HardDrive } from 'lucide-react';
import { SpeedLimitInput } from './SpeedLimitInput';
import { formatBytes, formatSpeed, formatEta, statusColor } from '../lib/format';

/**
 * The five-tab detail panel for one torrent.
 *
 * Lifted out of TorrentRow so the phone card list can reach the same thing. The
 * card is not a table row, so it cannot host the panel the way the row does
 * (a second `<tr>` spanning every column) — but files, peers and per-torrent
 * options are not desktop luxuries, and a mobile layout that silently dropped
 * them would be a functional regression rather than a responsive one.
 *
 * Every sub-panel below moved verbatim; only the shared formatters changed, and
 * those went to lib/format.ts.
 */

export type DetailTab = 'status' | 'details' | 'files' | 'peers' | 'options';

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
    // Five columns of file metadata do not fit a phone; scroll rather than crush.
    <Table.ScrollContainer minWidth={560} type="native">
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
    </Table.ScrollContainer>
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
    <Table.ScrollContainer minWidth={560} type="native">
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
    </Table.ScrollContainer>
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
        <SpeedLimitInput
          id="opt-max-dl"
          label="Max Download"
          size="xs"
          value={localOpts.max_download_speed ?? current.max_download_speed ?? 0}
          onChange={v => setLocalOpts(o => ({ ...o, max_download_speed: v }))}
        />
        <SpeedLimitInput
          id="opt-max-ul"
          label="Max Upload"
          size="xs"
          value={localOpts.max_upload_speed ?? current.max_upload_speed ?? 0}
          onChange={v => setLocalOpts(o => ({ ...o, max_upload_speed: v }))}
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

// ── Panel ─────────────────────────────────────────────────────────────────────

interface Props {
  torrent: Torrent;
  /** Horizontal padding — the table row insets further than the phone drawer. */
  px?: string | number;
  /** Cap on the body's own scroll; omit inside a container that already scrolls. */
  mah?: string | number;
}

export function TorrentDetails({ torrent, px = 'xl', mah = 420 }: Readonly<Props>) {
  const [activeTab, setActiveTab] = useState<DetailTab>('status');

  return (
    <>
      <Tabs
        value={activeTab}
        onChange={v => setActiveTab((v ?? 'status') as DetailTab)}
        px={px}
        pt="xs"
      >
        {/*
          Five tabs overflow a phone. Scrolling the strip keeps every tab
          reachable and keeps the roles identical at every width, which a
          collapse-into-a-Select would not.
        */}
        <Tabs.List className="smuggler-hscroll" style={{ flexWrap: 'nowrap' }}>
          {TABS.map(tab => (
            <Tabs.Tab key={tab.id} value={tab.id} leftSection={tab.icon} fz="xs">
              {tab.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>
      <Box px={px} py="md" mah={mah} style={{ overflowY: 'auto' }}>
        {activeTab === 'status'  && <StatusTab torrent={torrent} />}
        {activeTab === 'details' && <DetailsTab torrent={torrent} />}
        {activeTab === 'files'   && <FilesTab torrent={torrent} />}
        {activeTab === 'peers'   && <PeersTab torrent={torrent} isVisible={activeTab === 'peers'} />}
        {activeTab === 'options' && <OptionsTab torrent={torrent} isVisible={activeTab === 'options'} />}
      </Box>
    </>
  );
}
