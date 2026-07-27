import React, { useState } from 'react';
import {
  ActionIcon, Badge, Checkbox, Group, Progress, Stack, Table, Text,
} from '@mantine/core';
import type { Torrent } from '../api/types';
import { Play, Pause, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { DeleteTorrentModal } from './DeleteTorrentModal';
import { TorrentDetails } from './TorrentDetails';
import { useTorrentActions } from '../hooks/useTorrentActions';
import { formatBytes, formatSpeed, displayEta, statusColor } from '../lib/format';

/**
 * One torrent as a table row — the layout used from `md` up.
 *
 * Below `md` the page renders TorrentCard instead: nine columns need 960px, and
 * the pair share their formatters (lib/format.ts), their mutations
 * (useTorrentActions) and their detail panel (TorrentDetails), so the two
 * layouts cannot drift apart in behaviour.
 */

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
  const [showConfirm, setShowConfirm] = useState(false);
  // Uncontrolled fallback keeps the component usable on its own (and in tests)
  // when a caller does not lift the state.
  const [localExpanded, setLocalExpanded] = useState(false);
  const isExpanded = expanded ?? localExpanded;
  const toggleExpanded = onToggleExpanded ?? (() => setLocalExpanded(v => !v));

  const { pause, resume, remove, resumeDisabled, pauseDisabled } = useTorrentActions(torrent);

  const progress = Math.min(100, torrent.progress);
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
            {displayEta(torrent.status, torrent.eta)}
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
              disabled={resumeDisabled}
              loading={resume.isPending}
              title="Resume"
            >
              <Play size={15} />
            </ActionIcon>
            <ActionIcon
              variant="default"
              onClick={() => pause.mutate()}
              disabled={pauseDisabled}
              loading={pause.isPending}
              title="Pause"
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
            <TorrentDetails torrent={torrent} />
          </Table.Td>
        </Table.Tr>
      )}

      {/* Delete Confirmation Modal */}
      <DeleteTorrentModal
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={(deleteFiles) => {
          remove.mutate(deleteFiles, { onSuccess: () => setShowConfirm(false) });
        }}
        isPending={remove.isPending}
        torrentName={torrent.name || torrent.gid}
      />
    </React.Fragment>
  );
}
