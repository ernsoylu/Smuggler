import { useState } from 'react';
import { Button, Checkbox, Group, Modal, Paper, Stack, Text, ThemeIcon } from '@mantine/core';
import { Trash2 } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (deleteFiles: boolean) => void;
  isPending: boolean;
  torrentName: string;
}

export function DeleteTorrentModal({ isOpen, onClose, onConfirm, isPending, torrentName }: Readonly<Props>) {
  const [deleteFiles, setDeleteFiles] = useState(false);

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
            <Text fw={700} size="lg">Delete Torrent</Text>
            <Text size="xs" c="dimmed">Are you sure you want to remove this?</Text>
          </div>
        </Group>
      }
    >
      <Stack gap="md">
        <Paper withBorder p="sm" radius="md">
          <Text size="sm" lineClamp={2} style={{ wordBreak: 'break-all' }}>{torrentName}</Text>
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
            label={<Text size="sm" fw={500} c="red.4">Delete downloaded files too</Text>}
            description="This action cannot be undone."
          />
        </Paper>

        <Group grow>
          <Button variant="default" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button color="red" onClick={() => onConfirm(deleteFiles)} loading={isPending}>
            Delete
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
