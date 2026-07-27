import { useState } from 'react';
import {
  ActionIcon, Box, Group, Indicator, Popover, Progress, ScrollArea, Stack, Text, UnstyledButton,
} from '@mantine/core';
import { Bell, X, Trash2 } from 'lucide-react';
import { useNotifications, type AppNotification, type NotificationType } from '../context/NotificationContext';

/** Mantine color base per notification type — dot, progress and unread tint. */
const TYPE_COLORS: Record<NotificationType, string> = {
  info: 'blue',
  success: 'teal',
  error: 'red',
  warning: 'yellow',
};

function timeAgo(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return 'just now';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}

function NotificationItem({ n, onDismiss }: Readonly<{ n: AppNotification; onDismiss: () => void }>) {
  const color = TYPE_COLORS[n.type];
  return (
    <Group
      align="flex-start"
      gap="sm"
      px="md"
      py="sm"
      wrap="nowrap"
      style={{
        borderBottom: '1px solid var(--mantine-color-default-border)',
        background: n.read ? undefined : `var(--mantine-color-${color}-light)`,
      }}
    >
      <Box w={8} h={8} mt={6} bg={`${color}.5`} style={{ borderRadius: '50%', flexShrink: 0 }} />
      <Stack gap={2} flex={1} miw={0}>
        <Text size="sm" fw={500} lh={1.3}>{n.title}</Text>
        {n.message && <Text size="xs" c="dimmed" lh={1.3}>{n.message}</Text>}
        {n.progress && (
          <Stack gap={4} mt={4}>
            <Group justify="space-between">
              <Text size="10px" fw={600} c={`${color}.4`}>{n.progress.label}</Text>
              <Text size="10px" c="dimmed">{n.progress.current + 1}/{n.progress.total}</Text>
            </Group>
            <Progress
              size="xs"
              color={color}
              value={((n.progress.current + 1) / n.progress.total) * 100}
            />
          </Stack>
        )}
        <Text size="11px" c="dimmed" mt={2}>{timeAgo(n.timestamp)}</Text>
      </Stack>
      <ActionIcon variant="subtle" color="gray" size="sm" onClick={onDismiss} aria-label="Dismiss notification">
        <X size={14} />
      </ActionIcon>
    </Group>
  );
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { notifications, unreadCount, markAllRead, dismiss, clearAll } = useNotifications();

  const handleToggle = () => {
    setOpen(v => !v);
    if (!open && unreadCount > 0) markAllRead();
  };

  return (
    <Popover
      width={320}
      position="bottom-end"
      shadow="xl"
      opened={open}
      onChange={setOpen}
    >
      <Popover.Target>
        <Indicator
          label={unreadCount > 9 ? '9+' : unreadCount}
          size={16}
          color="blue"
          disabled={unreadCount === 0}
          offset={4}
        >
          <ActionIcon variant="subtle" color="gray" size="lg" onClick={handleToggle} aria-label="Notifications">
            <Bell size={18} />
          </ActionIcon>
        </Indicator>
      </Popover.Target>

      <Popover.Dropdown p={0}>
        <Group justify="space-between" px="md" py="sm" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
          <Text size="sm" fw={600}>Notifications</Text>
          {notifications.length > 0 && (
            <UnstyledButton onClick={clearAll} c="dimmed" fz="xs" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Trash2 size={12} /> Clear all
            </UnstyledButton>
          )}
        </Group>

        <ScrollArea.Autosize mah={384}>
          {notifications.length === 0 ? (
            <Stack align="center" py="xl" gap={6} c="dimmed">
              <Bell size={28} strokeWidth={1.5} />
              <Text size="sm">No notifications</Text>
            </Stack>
          ) : (
            notifications.map(n => (
              <NotificationItem key={n.id} n={n} onDismiss={() => dismiss(n.id)} />
            ))
          )}
        </ScrollArea.Autosize>
      </Popover.Dropdown>
    </Popover>
  );
}
