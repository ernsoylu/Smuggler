import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Badge, Box, Button, Group, Loader, Paper, SimpleGrid, Stack, Text, Title,
} from '@mantine/core';
import { getMules, getWatchdogStatus, triggerWatchdogSweep, evacuateMule } from '../api/client';
import type { WatchdogStatus } from '../api/types';
import { MuleCard } from '../components/MuleCard';
import { useNotifications } from '../context/NotificationContext';
import { useUiActions } from '../context/UiActionsContext';
import { ShieldCheck, Rocket, Shield, ShieldAlert, ShieldOff, RefreshCw, LogOut } from 'lucide-react';

function tinted(color: string): React.CSSProperties {
  return {
    background: `var(--mantine-color-${color}-light)`,
    borderColor: `var(--mantine-color-${color}-light-color)`,
  };
}

function WatchdogPanel({ watchdog }: Readonly<{ watchdog: WatchdogStatus | undefined }>) {
  const qc = useQueryClient();
  const [confirmEvac, setConfirmEvac] = useState<string | null>(null);

  const sweep = useMutation({
    mutationFn: triggerWatchdogSweep,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['watchdog'] }),
  });

  const evac = useMutation({
    mutationFn: (name: string) => evacuateMule(name, true),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['watchdog'] });
      qc.invalidateQueries({ queryKey: ['mules'] });
    },
  });

  if (!watchdog) return null;

  const unhealthy = watchdog.mules.filter(m => !m.healthy);
  const healthy   = watchdog.mules.filter(m => m.healthy);
  const allHealthy = unhealthy.length === 0;
  const mulesPlural = unhealthy.length > 1 ? 's' : '';
  const watchdogTitle = allHealthy ? 'All VPN connections secure' : `${unhealthy.length} mule${mulesPlural} compromised`;
  const panelColor = allHealthy ? 'teal' : 'red';

  return (
    <Paper withBorder radius="lg" p="md" mb="lg" style={tinted(panelColor)}>
      <Group justify="space-between" mb="sm">
        <Group gap="sm">
          {allHealthy
            ? <Shield size={18} color="var(--mantine-color-teal-4)" />
            : <ShieldAlert size={18} color="var(--mantine-color-red-4)" />}
          <div>
            <Text size="sm" fw={700} c={`${panelColor}.4`}>{watchdogTitle}</Text>
            <Text size="11px" c="dimmed" mt={2}>
              Watchdog · interval {watchdog.config.interval_seconds}s · {watchdog.stats.total_sweeps} sweeps · {watchdog.stats.total_evacuations} evacuations
              {watchdog.stats.last_run_at && ` · last check ${new Date(watchdog.stats.last_run_at).toLocaleTimeString()}`}
            </Text>
          </div>
        </Group>
        <Button
          size="compact-xs"
          variant="default"
          leftSection={<RefreshCw size={13} className={sweep.isPending ? 'smuggler-spin' : undefined} />}
          onClick={() => sweep.mutate()}
          disabled={sweep.isPending}
        >
          Check now
        </Button>
      </Group>

      {/* Unhealthy mules */}
      {unhealthy.length > 0 && (
        <Stack gap="xs" mb="sm">
          {unhealthy.map(m => (
            <Paper key={m.name} withBorder radius="md" px="md" py="sm" style={tinted('red')}>
              <Group justify="space-between" gap="sm" wrap="nowrap">
                <Group gap="sm" wrap="nowrap" miw={0}>
                  <ShieldOff size={14} color="var(--mantine-color-red-4)" style={{ flexShrink: 0 }} />
                  <Stack gap={0} miw={0}>
                    <Text size="sm" fw={600} c="var(--smg-bad)" truncate>{m.name}</Text>
                    <Text size="11px" c="red.5" truncate>{m.reason}</Text>
                  </Stack>
                  {(m.consecutive_failures ?? 0) > 0 && (
                    <Badge size="xs" color="red" variant="light">
                      {m.consecutive_failures} fail{(m.consecutive_failures ?? 0) > 1 ? 's' : ''}
                    </Badge>
                  )}
                </Group>
                {/* Confirmed like every other destructive action. This was
                    the one that killed a container on a single click. */}
                {!m.evacuated && confirmEvac !== m.name && (
                  <Button
                    size="compact-xs"
                    color="red"
                    variant="light"
                    leftSection={<LogOut size={12} />}
                    onClick={() => setConfirmEvac(m.name)}
                    disabled={evac.isPending}
                  >
                    Evacuate
                  </Button>
                )}
                {!m.evacuated && confirmEvac === m.name && (
                  <Group gap={6} wrap="nowrap">
                    <Text size="xs" fw={600} c="var(--smg-bad)">Evacuate and kill?</Text>
                    <Button
                      size="compact-xs"
                      color="red"
                      onClick={() => { setConfirmEvac(null); evac.mutate(m.name); }}
                      disabled={evac.isPending}
                    >
                      Yes
                    </Button>
                    <Button size="compact-xs" variant="default" onClick={() => setConfirmEvac(null)}>
                      Cancel
                    </Button>
                  </Group>
                )}
                {m.evacuated && <Badge size="sm" color="gray" variant="filled">Evacuated</Badge>}
              </Group>
            </Paper>
          ))}
        </Stack>
      )}

      {/* Healthy mule mini-list */}
      {healthy.length > 0 && (
        <Group gap="xs">
          {healthy.map(m => (
            <Badge
              key={m.name}
              variant="light"
              color="teal"
              size="lg"
              radius="md"
              tt="none"
              leftSection={<Shield size={11} />}
              styles={{ label: { fontFamily: 'var(--mantine-font-family-monospace)', fontWeight: 500 } }}
            >
              {m.name}{m.ip ? ` ${m.ip}` : ''}
            </Badge>
          ))}
        </Group>
      )}
    </Paper>
  );
}

export function MulesPage() {
  const { openDeployMule } = useUiActions();
  const { push: pushNotification } = useNotifications();
  const prevUnhealthyRef = useRef<Set<string>>(new Set());

  const { data: mules = [], isLoading } = useQuery({
    queryKey: ['mules'],
    queryFn: getMules,
    refetchInterval: 3_000,
  });

  const { data: watchdog } = useQuery({
    queryKey: ['watchdog'],
    queryFn: getWatchdogStatus,
    refetchInterval: 15_000,
  });

  // Notify when watchdog detects newly compromised mules
  useEffect(() => {
    if (!watchdog) return;
    const unhealthy = watchdog.mules.filter(m => !m.healthy);
    const prev = prevUnhealthyRef.current;
    for (const m of unhealthy) {
      if (!prev.has(m.name)) {
        pushNotification({ type: 'warning', title: `VPN compromised: ${m.name}`, message: m.reason ?? 'Watchdog detected an issue.' });
      }
    }
    prevUnhealthyRef.current = new Set(unhealthy.map(m => m.name));
  }, [watchdog, pushNotification]);

  return (
    <Box p="lg">
      <Group justify="space-between" align="flex-start" mb="xl" gap="md">
        <div>
          <Title order={2}>Mules</Title>
          <Text size="sm" c="dimmed" mt={2}>Deploy and manage isolated VPN containers for secure proxying.</Text>
        </div>
        <Button leftSection={<Rocket size={16} />} onClick={openDeployMule}>
          Deploy Mule
        </Button>
      </Group>

      {/* Watchdog security panel */}
      {watchdog && watchdog.mules.length > 0 && <WatchdogPanel watchdog={watchdog} />}

      {/* Active deployments */}
      <Group gap="sm" mb="md">
        <Title order={4}>Active Deployments</Title>
        <Badge variant="default" radius="xl">{mules.length}</Badge>
      </Group>

      {isLoading && (
        <Group justify="center" p="xl" gap="sm">
          <Loader size="sm" color="gray" />
          <Text size="sm" fw={500} c="dimmed">Querying active mules...</Text>
        </Group>
      )}
      {!isLoading && mules.length === 0 && (
        <Paper
          radius="lg"
          p={48}
          style={{ border: '2px dashed var(--mantine-color-default-border)', textAlign: 'center' }}
        >
          <Stack align="center" gap="sm">
            <ShieldCheck size={48} strokeWidth={1} color="var(--mantine-color-dimmed)" />
            <Text c="dimmed" fw={500} maw={380}>
              No mules are currently running. Click "Deploy Mule" to get started.
            </Text>
          </Stack>
        </Paper>
      )}
      {!isLoading && mules.length > 0 && (
        <SimpleGrid type="container" cols={{ base: 1, '640px': 2, '1024px': 3, '1440px': 4 }} spacing="md">
          {mules.map(w => (
            <MuleCard key={w.name} mule={w} />
          ))}
        </SimpleGrid>
      )}
    </Box>
  );
}
