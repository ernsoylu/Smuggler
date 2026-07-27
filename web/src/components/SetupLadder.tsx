import { useQuery } from '@tanstack/react-query';
import { Button, Group, Paper, Stack, Text, ThemeIcon, VisuallyHidden } from '@mantine/core';
import { getConfigs, getMules } from '../api/client';
import { useUiActions } from '../context/UiActionsContext';
import { setupState, type SetupStepId } from '../lib/setup';
import { Check, FileKey2, Rocket, Plus } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * The first-run path, rendered in place of the Torrents empty state.
 *
 * Replaces "No torrents are currently added." — which was true, unhelpful, and
 * silent about the fact that adding one was impossible until two other things
 * happened on two other pages.
 */

const COPY: Record<SetupStepId, { title: string; detail: string; cta: string; icon: ReactNode }> = {
  config: {
    title: 'Upload a VPN config',
    detail: 'A WireGuard .conf or OpenVPN .ovpn file. Nothing leaves your machine unencrypted.',
    cta: 'Upload config',
    icon: <FileKey2 size={14} />,
  },
  mule: {
    title: 'Deploy a mule',
    detail: 'An isolated container that brings up the tunnel and arms its kill-switch before aria2 starts.',
    cta: 'Deploy mule',
    icon: <Rocket size={14} />,
  },
  torrent: {
    title: 'Add a torrent',
    detail: 'Paste a magnet link, or drop a .torrent anywhere in the window.',
    cta: 'Add torrent',
    icon: <Plus size={14} />,
  },
};

export function SetupLadder() {
  const { openAddTorrent, openDeployMule, navigate } = useUiActions();

  const { data: configs = [] } = useQuery({ queryKey: ['configs'], queryFn: getConfigs });
  const { data: mules = [] } = useQuery({ queryKey: ['mules'], queryFn: getMules });

  const runningMules = mules.filter(m => m.status === 'running').length;
  const { steps, current } = setupState(configs.length, runningMules);

  const run: Record<SetupStepId, () => void> = {
    config: () => navigate('configs'),
    mule: openDeployMule,
    torrent: openAddTorrent,
  };

  return (
    <Stack gap="xs" maw={620} mx="auto">
      <Text fw={600} ta="center">Set up your first secure download</Text>
      <Text size="sm" c="dimmed" ta="center" mb="xs">
        Each download runs inside its own VPN container. Nothing starts until the tunnel is verified.
      </Text>

      <Stack component="ol" gap="xs" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {steps.map((step, i) => {
          const copy = COPY[step.id];
          const isCurrent = current === step.id;
          return (
            <Paper
              key={step.id}
              component="li"
              withBorder
              px="md"
              py="sm"
              radius="md"
              style={isCurrent ? {
                background: 'var(--mantine-color-smuggler-light)',
                borderColor: 'var(--mantine-color-smuggler-light-color)',
              } : undefined}
            >
              <Group gap="md" wrap="nowrap">
                <ThemeIcon
                  size={28}
                  radius="xl"
                  variant="light"
                  color={step.done ? 'teal' : 'gray'}
                  aria-hidden
                >
                  {step.done ? <Check size={14} /> : <Text size="xs" fw={700}>{i + 1}</Text>}
                </ThemeIcon>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text size="sm" fw={500} c={step.done ? 'dimmed' : undefined}>
                    {copy.title}
                    {step.done && <VisuallyHidden> — done</VisuallyHidden>}
                  </Text>
                  <Text size="xs" c="dimmed" mt={2}>{copy.detail}</Text>
                </div>

                {!step.done && (
                  <Button
                    size="compact-sm"
                    variant={isCurrent ? 'filled' : 'default'}
                    disabled={!step.enabled}
                    leftSection={copy.icon}
                    onClick={run[step.id]}
                    title={step.enabled ? undefined : 'Finish the step above first'}
                  >
                    {copy.cta}
                  </Button>
                )}
              </Group>
            </Paper>
          );
        })}
      </Stack>
    </Stack>
  );
}
