import { useState } from 'react';
import {
  ActionIcon, Badge, Box, Card, Checkbox, Collapse, Group, Menu, Progress, Stack, Text,
  UnstyledButton,
} from '@mantine/core';
import type { Torrent } from '../api/types';
import {
  Play, Pause, Trash2, MoreVertical, ChevronDown, ChevronRight,
  Download, Upload, Clock,
} from 'lucide-react';
import { DeleteTorrentModal } from './DeleteTorrentModal';
import { TorrentDetails } from './TorrentDetails';
import { useTorrentActions } from '../hooks/useTorrentActions';
import { formatBytes, formatSpeed, displayEta, statusColor } from '../lib/format';

/**
 * One torrent as a stacked card — the layout used below `md`.
 *
 * The table needs 960px, so on a phone it became a sideways swipe to reach
 * anything past Progress: speed, ETA, ratio and the action buttons all lived
 * off-screen. This carries the same facts down the screen instead of across it,
 * and the three actions move into a menu so each is a full-height tap target
 * rather than a 26px icon.
 *
 * Nothing here is a mobile-only reimplementation: the formatters, the mutations
 * and the detail panel are the same modules the table row uses.
 */

interface Props {
  torrent: Torrent;
  selected?: boolean;
  onToggleSelected?: () => void;
  /** Lifted for the same reason as the row's — see TorrentRow. */
  expanded?: boolean;
  onToggleExpanded?: () => void;
}

/** One labelled figure in the stats strip. */
function Stat({ icon, value, color, label }: Readonly<{
  icon: React.ReactNode; value: string; color?: string; label: string;
}>) {
  return (
    <Group gap={4} wrap="nowrap" title={label}>
      {icon}
      <Text size="xs" fw={500} c={color} ff="monospace">{value}</Text>
    </Group>
  );
}

export function TorrentCard({
  torrent, selected = false, onToggleSelected, expanded, onToggleExpanded,
}: Readonly<Props>) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [localExpanded, setLocalExpanded] = useState(false);
  const isExpanded = expanded ?? localExpanded;
  const toggleExpanded = onToggleExpanded ?? (() => setLocalExpanded(v => !v));

  const { pause, resume, remove, resumeDisabled, pauseDisabled } = useTorrentActions(torrent);

  const progress = Math.min(100, torrent.progress);
  const color = statusColor(torrent.status);
  const eta = displayEta(torrent.status, torrent.eta);

  return (
    <Card
      withBorder
      radius="md"
      p="sm"
      // Selection is a tint on the row; keep the same signal on the card, and
      // an accent border so it survives a colour-blind read.
      style={selected
        ? {
          background: 'var(--mantine-color-blue-light)',
          borderColor: 'var(--mantine-color-blue-light-color)',
        }
        : undefined}
    >
      <Stack gap={8}>
        {/* Name, selection and the action menu */}
        <Group gap="xs" wrap="nowrap" align="flex-start">
          <Checkbox
            size="sm"
            mt={2}
            checked={selected}
            onChange={onToggleSelected}
            aria-label={`Select ${torrent.name}`}
          />
          <Stack gap={2} miw={0} flex={1}>
            <Text size="sm" fw={600} lineClamp={2} title={torrent.name}>
              {torrent.name || torrent.gid}
            </Text>
            <Text size="10px" c="dimmed" ff="monospace" truncate>
              {torrent.gid}
            </Text>
          </Stack>

          <Menu position="bottom-end" withinPortal shadow="md" width={180}>
            <Menu.Target>
              <ActionIcon
                variant="subtle"
                color="gray"
                size={36}
                aria-label={`Actions for ${torrent.name}`}
              >
                <MoreVertical size={18} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                leftSection={<Play size={15} />}
                disabled={resumeDisabled || resume.isPending}
                onClick={() => resume.mutate()}
              >
                Resume
              </Menu.Item>
              <Menu.Item
                leftSection={<Pause size={15} />}
                disabled={pauseDisabled || pause.isPending}
                onClick={() => pause.mutate()}
              >
                Pause
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item
                color="red"
                leftSection={<Trash2 size={15} />}
                onClick={() => setShowConfirm(true)}
              >
                Remove
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>

        {/* Status and routing mule */}
        <Group gap={6} wrap="wrap">
          <Badge variant="light" color={color} tt="capitalize" radius="sm" size="sm">
            {torrent.status}
            {torrent.is_metadata && ' (Meta)'}
          </Badge>
          <Badge variant="default" radius="sm" size="sm" ff="monospace" tt="none">
            {torrent.mule}
          </Badge>
        </Group>

        {/* Progress */}
        <Box>
          <Group justify="space-between" gap="xs" mb={4} wrap="nowrap">
            <Text size="11px" c="dimmed" fw={500} truncate>
              {formatBytes(torrent.completed_length)} / {formatBytes(torrent.total_length)}
            </Text>
            <Text size="11px" fw={700} style={{ flexShrink: 0 }}>{progress.toFixed(1)}%</Text>
          </Group>
          <Progress size="sm" value={progress} color={color} radius="xl" />
        </Box>

        {/* Speeds, ETA and ratio — the columns the table hid off-screen */}
        <Group gap="md" wrap="wrap">
          <Stat
            icon={<Download size={13} color="var(--mantine-color-teal-5)" />}
            value={formatSpeed(torrent.download_speed)}
            color="var(--smg-ok)"
            label="Download speed"
          />
          <Stat
            icon={<Upload size={13} color="var(--mantine-color-blue-5)" />}
            value={formatSpeed(torrent.upload_speed)}
            color="var(--smg-info)"
            label="Upload speed"
          />
          {eta !== '—' && (
            <Stat
              icon={<Clock size={13} color="var(--mantine-color-dimmed)" />}
              value={eta}
              color="dimmed"
              label="Estimated time remaining"
            />
          )}
          <Text size="xs" c="dimmed" ff="monospace" title="Seeds / peers">
            {torrent.num_seeders}S / {torrent.connections}P
          </Text>
          <Text
            size="xs"
            ff="monospace"
            c={torrent.ratio >= 1 ? 'var(--smg-ok)' : 'dimmed'}
            title="Share ratio"
          >
            ↕ {torrent.ratio.toFixed(2)}
          </Text>
        </Group>

        {/* Details */}
        <UnstyledButton
          onClick={toggleExpanded}
          aria-expanded={isExpanded}
          aria-label={isExpanded ? 'Collapse' : 'Expand details'}
          c="dimmed"
          // 32px of height rather than the text's 16: this is a touch target.
          style={{ display: 'flex', alignItems: 'center', gap: 4, minHeight: 32 }}
        >
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Text size="xs" fw={500} c="dimmed">Details</Text>
        </UnstyledButton>
      </Stack>

      <Collapse expanded={isExpanded}>
        {/*
          Mounted only while open, so a list of collapsed cards is not quietly
          polling peers for every one of them.
        */}
        {isExpanded && (
          <Box
            mt="xs"
            mx="calc(var(--mantine-spacing-sm) * -1)"
            mb="calc(var(--mantine-spacing-sm) * -1)"
            style={{ background: 'var(--mantine-color-default-hover)' }}
          >
            <TorrentDetails torrent={torrent} px="sm" mah={360} />
          </Box>
        )}
      </Collapse>

      <DeleteTorrentModal
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={(deleteFiles) => {
          remove.mutate(deleteFiles, { onSuccess: () => setShowConfirm(false) });
        }}
        isPending={remove.isPending}
        torrentName={torrent.name || torrent.gid}
      />
    </Card>
  );
}
