import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, Button, Group, Modal, SegmentedControl, Select, Stack, Text, Textarea, ThemeIcon,
  UnstyledButton,
} from '@mantine/core';
import { getMules, getAllTorrents, addMagnet, addTorrentFile } from '../api/client';
import { leastLoadedMule, resolveRoutingTarget, AUTO_MULE } from '../lib/torrentList';
import { useUiActions } from '../context/UiActionsContext';
import { useNotifications } from '../context/NotificationContext';
import { UploadCloud, Link as LinkIcon, AlertCircle, Rocket } from 'lucide-react';

interface Props {
  onClose: () => void;
}

export function AddTorrentModal({ onClose }: Readonly<Props>) {
  const qc = useQueryClient();
  const { openDeployMule } = useUiActions();
  const { push } = useNotifications();
  const [mode, setMode] = useState<'magnet' | 'file'>('magnet');
  const [magnet, setMagnet] = useState('');
  // Defaults to auto-routing. Dropping a .torrent already picks the
  // least-loaded mule without asking; making the button path demand the one
  // decision a user cannot make well ("which container is least loaded?") made
  // the same action harder through the more obvious entry point.
  const [mule, setMule] = useState<string>(AUTO_MULE);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: mules = [] } = useQuery({
    queryKey: ['mules'],
    queryFn: getMules,
    staleTime: 10_000,
  });

  // Load only matters for the auto choice; the cache is already warm.
  const { data: torrents = [] } = useQuery({
    queryKey: ['torrents'],
    queryFn: getAllTorrents,
  });

  const runningMules = mules.filter(w => w.status === 'running');
  const autoTarget = leastLoadedMule(mules, torrents);

  const add = useMutation({
    mutationFn: async () => {
      const target = resolveRoutingTarget(mule, mules, torrents);
      if (!target) throw new Error('No running mule to receive the torrent');
      if (mode === 'magnet') {
        if (!magnet.trim()) throw new Error('Paste a magnet link');
        await addMagnet(target, magnet.trim());
      } else {
        if (!file) throw new Error('Choose a .torrent file');
        await addTorrentFile(target, file);
      }
      return target;
    },
    onSuccess: (target) => {
      // The drop path already confirms; the button path used to just close,
      // leaving the user to find the new row in a paginated, filtered list.
      push({
        type: 'success',
        title: mode === 'magnet' ? 'Magnet added' : `Added ${file?.name}`,
        message: `Routed to ${target}.`,
      });
      qc.invalidateQueries({ queryKey: ['torrents'] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal
      opened
      onClose={onClose}
      centered
      radius="lg"
      title={<Text fw={700} size="xl">Add Torrent</Text>}
      // Escape is disabled mid-submit so a stray keypress cannot orphan the request.
      closeOnEscape={!add.isPending}
      closeOnClickOutside={!add.isPending}
    >
      <Stack gap="md">
        {/* Mode toggle */}
        <SegmentedControl
          fullWidth
          value={mode}
          onChange={v => { setMode(v as 'magnet' | 'file'); setError(''); }}
          data={[
            {
              value: 'magnet',
              label: (
                <Group gap={8} justify="center" wrap="nowrap">
                  <LinkIcon size={16} /> Magnet Link
                </Group>
              ),
            },
            {
              value: 'file',
              label: (
                <Group gap={8} justify="center" wrap="nowrap">
                  <UploadCloud size={16} /> .torrent File
                </Group>
              ),
            },
          ]}
        />

        {/* Input area */}
        {mode === 'magnet' ? (
          <Textarea
            id="add-torrent-magnet"
            label="Magnet URI"
            rows={4}
            placeholder="magnet:?xt=urn:btih:..."
            value={magnet}
            onChange={e => { setMagnet(e.currentTarget.value); setError(''); }}
            styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
          />
        ) : (
          <div>
            <Text size="sm" fw={500} mb={6}>Torrent File</Text>
            <UnstyledButton
              component="label"
              htmlFor="add-torrent-file"
              w="100%"
              p="xl"
              style={{
                border: '2px dashed var(--mantine-color-default-border)',
                borderRadius: 'var(--mantine-radius-lg)',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 12,
                cursor: 'pointer',
              }}
            >
              <ThemeIcon variant="default" size={48} radius="xl">
                <UploadCloud size={24} />
              </ThemeIcon>
              <input
                id="add-torrent-file"
                ref={fileRef}
                type="file"
                accept=".torrent"
                style={{ display: 'none' }}
                onChange={e => { setFile(e.target.files?.[0] ?? null); setError(''); }}
              />
              {file ? (
                <Text size="sm" fw={500} c="var(--smg-info)">{file.name}</Text>
              ) : (
                <Text size="sm" c="dimmed">Click to choose a .torrent file — or drop one anywhere</Text>
              )}
            </UnstyledButton>
          </div>
        )}

        {/* Mule selector */}
        <div>
          <Select
            id="add-torrent-mule"
            label="Routing Mule"
            allowDeselect={false}
            value={mule}
            onChange={v => { setMule(v ?? AUTO_MULE); setError(''); }}
            data={[
              {
                value: AUTO_MULE,
                label: autoTarget
                  ? `Auto — least loaded (${autoTarget.name})`
                  : 'Auto — least loaded',
              },
              ...runningMules.map(w => ({
                value: w.name,
                label: `${w.name}${w.ip_info ? ` (${w.ip_info.country})` : ''}`,
              })),
            ]}
            comboboxProps={{ withinPortal: true }}
          />
          {/* Used to be a sentence. A dead end that names its own fix should
              perform it, not describe it. */}
          {runningMules.length === 0 && (
            <Group gap="xs" mt={6}>
              <Group gap={6} wrap="nowrap">
                <AlertCircle size={14} color="var(--mantine-color-orange-4)" />
                <Text size="xs" fw={500} c="var(--smg-warn)">No running mules.</Text>
              </Group>
              <Button
                size="compact-xs"
                variant="default"
                leftSection={<Rocket size={12} />}
                onClick={() => { onClose(); openDeployMule(); }}
              >
                Deploy one
              </Button>
            </Group>
          )}
        </div>

        {error && (
          <Alert color="red" radius="md" p="sm">
            <Text size="sm" fw={500} c="var(--smg-bad)">{error}</Text>
          </Alert>
        )}

        {/* Footer */}
        <Group grow pt="xs">
          <Button variant="default" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => add.mutate()}
            loading={add.isPending}
            disabled={runningMules.length === 0}
          >
            Add Torrent
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
