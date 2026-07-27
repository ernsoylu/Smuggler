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
  const allHealthy = unhealthy.length === 0;
  const mulesPlural = unhealthy.length > 1 ? 's' : '';
  const watchdogTitle = allHealthy ? 'All VPN connections secure' : `${unhealthy.length} mule${mulesPlural} compromised`;
  const panelColor = allHealthy ? 'teal' : 'red';

  return (
    /*
     * A status strip, not a panel. This was a full tinted card carrying a
     * two-line header plus a large badge per healthy mule — a big block whose
     * whole message, most of the time, is "nothing is wrong". The healthy list
     * is also pure duplication: every one of those mules is rendered with its
     * IP in Active Deployments immediately below. Only the failure case earns
     * vertical space, so only the failure case gets any.
     */
    /*
     * Accent border rather than a tinted fill. The tint was carrying `teal.4`
     * title text at 1.56:1 and `dimmed` meta at 3.42:1 — numbered shades are
     * calibrated for the dark surface, and `dimmed` for the page body, so both
     * collapse on a light-scheme tint. On the plain surface the semantic
     * variables hold their contract in both schemes.
     */
    <Paper
      withBorder
      radius="md"
      px="md"
      py={8}
      mb="md"
      style={{ boxShadow: `inset 3px 0 0 0 var(--mantine-color-${panelColor}-5)` }}
    >
      <Group justify="space-between" gap="sm" wrap="nowrap">
        <Group gap="sm" wrap="nowrap" miw={0}>
          {allHealthy
            ? <Shield size={15} color="var(--mantine-color-teal-5)" style={{ flexShrink: 0 }} />
            : <ShieldAlert size={15} color="var(--mantine-color-red-5)" style={{ flexShrink: 0 }} />}
          <Text
            size="sm"
            fw={600}
            c={allHealthy ? 'var(--smg-ok)' : 'var(--smg-bad)'}
            style={{ flexShrink: 0 }}
          >
            {watchdogTitle}
          </Text>
          {/* Sweep counters lose to the verdict when the strip runs out of room. */}
          <Text size="11px" c="dimmed" truncate visibleFrom="sm">
            {watchdog.config.interval_seconds}s · {watchdog.stats.total_sweeps} sweeps · {watchdog.stats.total_evacuations} evacuations
            {watchdog.stats.last_run_at && ` · ${new Date(watchdog.stats.last_run_at).toLocaleTimeString()}`}
          </Text>
        </Group>
        <Button
          size="compact-xs"
          variant="default"
          style={{ flexShrink: 0 }}
          leftSection={<RefreshCw size={12} className={sweep.isPending ? 'smuggler-spin' : undefined} />}
          onClick={() => sweep.mutate()}
          disabled={sweep.isPending}
        >
          Check now
        </Button>
      </Group>

      {/* Unhealthy mules — the only case that expands the strip */}
      {unhealthy.length > 0 && (
        <Stack gap="xs" mt="sm">
          {unhealthy.map(m => (
            <Paper
              key={m.name}
              withBorder
              radius="md"
              px="md"
              py="sm"
              style={{ boxShadow: 'inset 3px 0 0 0 var(--mantine-color-red-5)' }}
            >
              {/* The confirm state adds a sentence and two buttons to this row;
                  on a phone that has to be allowed to take a second line. */}
              <Group justify="space-between" gap="sm" wrap="wrap">
                <Group gap="sm" wrap="nowrap" miw={0} flex={1}>
                  <ShieldOff size={14} color="var(--mantine-color-red-5)" style={{ flexShrink: 0 }} />
                  <Stack gap={0} miw={0}>
                    <Text size="sm" fw={600} c="var(--smg-bad)" truncate>{m.name}</Text>
                    <Text size="11px" c="dimmed" truncate>{m.reason}</Text>
                  </Stack>
                  {(m.consecutive_failures ?? 0) > 0 && (
                    <Badge size="xs" color="red" variant="light" style={{ flexShrink: 0 }}>
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
    <Box p={{ base: 'sm', sm: 'lg' }}>
      <Group justify="space-between" align="flex-start" mb="md" gap="sm" wrap="nowrap">
        <Box miw={0}>
          <Title order={2} fz={{ base: 22, sm: 26 }}>Mules</Title>
          <Text size="sm" c="dimmed" mt={2} visibleFrom="sm">
            Deploy and manage isolated VPN containers for secure proxying.
          </Text>
        </Box>
        <Button leftSection={<Rocket size={16} />} onClick={openDeployMule} style={{ flexShrink: 0 }}>
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
      {/*
        Solid border, not dashed: a dashed rectangle reads as a drop target
        everywhere else in the OS, and nothing can be dropped here.
      */}
      {!isLoading && mules.length === 0 && (
        <Paper withBorder radius="md" p="lg">
          <Group justify="center" gap="sm">
            <ShieldCheck size={18} strokeWidth={1.5} color="var(--mantine-color-dimmed)" />
            <Text size="sm" c="dimmed" fw={500}>No mules running.</Text>
            <Button size="compact-sm" variant="default" leftSection={<Rocket size={13} />} onClick={openDeployMule}>
              Deploy Mule
            </Button>
          </Group>
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
