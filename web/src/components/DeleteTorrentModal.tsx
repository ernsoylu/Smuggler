import { useState } from 'react';
import { Button, Checkbox, Group, Modal, Paper, Stack, Text, ThemeIcon } from '@mantine/core';
import { Trash2 } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (deleteFiles: boolean) => void;
  isPending: boolean;
  /** Shown when a single torrent is targeted; ignored once count > 1. */
  torrentName: string;
  /**
   * How many torrents this confirmation covers. The bulk bar used to remove
   * its whole selection with no confirmation and no delete-files option, while
   * removing a single torrent opened this dialog — the caution was inverted,
   * since the batch is the dangerous one. Both paths come through here now.
   */
  count?: number;
}

export function DeleteTorrentModal({ isOpen, onClose, onConfirm, isPending, torrentName, count = 1 }: Readonly<Props>) {
  const [deleteFiles, setDeleteFiles] = useState(false);
  const bulk = count > 1;

  // Reset the checkbox when the modal (re)opens — the render-phase "previous
  // prop" pattern avoids an extra render cycle from doing this in an effect.
  const [prevOpen, setPrevOpen] = useState(isOpen);
  if (isOpen !== prevOpen) {
    setPrevOpen(isOpen);
    if (isOpen) setDeleteFiles(false);
  }

  return (
    <Modal
      opened={isOpen}
      onClose={onClose}
      centered
      radius="lg"
      // A stray Escape or backdrop click must not orphan an in-flight delete.
      closeOnEscape={!isPending}
      closeOnClickOutside={!isPending}
      withCloseButton={!isPending}
      title={
        <Group gap="sm">
          <ThemeIcon variant="light" color="red" size={40} radius="md">
            <Trash2 size={20} />
          </ThemeIcon>
          <div>
            <Text fw={700} size="lg">{bulk ? `Remove ${count} torrents` : 'Remove torrent'}</Text>
            <Text size="xs" c="dimmed">
              {bulk
                ? 'This removes every torrent in the current selection.'
                : 'Are you sure you want to remove this?'}
            </Text>
          </div>
        </Group>
      }
    >
      <Stack gap="md">
        <Paper withBorder p="sm" radius="md">
          <Text size="sm" lineClamp={2} style={{ wordBreak: 'break-all' }}>
            {bulk ? `${count} torrents selected` : torrentName}
          </Text>
        </Paper>

        <Paper
          withBorder
          p="sm"
          radius="md"
          style={{
            background: 'var(--mantine-color-red-light)',
            borderColor: 'var(--mantine-color-red-light-color)',
          }}
        >
          <Checkbox
            id="delete-files-checkbox"
            color="red"
            checked={deleteFiles}
            onChange={e => setDeleteFiles(e.currentTarget.checked)}
            label={
              <Text size="sm" fw={500} c="var(--smg-bad)">
                {bulk ? 'Delete downloaded files too, for all of them' : 'Delete downloaded files too'}
              </Text>
            }
            description="This action cannot be undone."
          />
        </Paper>

        <Group grow>
          <Button variant="default" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button color="red" onClick={() => onConfirm(deleteFiles)} loading={isPending}>
            Remove
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
