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
    cta: 'Upload Config',
    icon: <FileKey2 size={14} />,
  },
  mule: {
    title: 'Deploy a mule',
    // A mule is the app's one coined term and the first-run card is where it is
    // met; define it here rather than assuming the metaphor lands. `aria2` was
    // an implementation detail leaking into the promise — what the user is
    // being told is *when* downloading starts, not which engine does it.
    detail: 'A sealed container running one VPN tunnel. It arms its kill-switch and verifies the tunnel before any download starts.',
    cta: 'Deploy Mule',
    icon: <Rocket size={14} />,
  },
  torrent: {
    title: 'Add a torrent',
    detail: 'Paste a magnet link, or drop a .torrent anywhere in the window.',
    cta: 'Add Torrent',
    icon: <Plus size={14} />,
  },
};

export function SetupLadder() {
  const { openAddTorrent, openDeployMule, navigate } = useUiActions();

  const { data: configs = [] } = useQuery({ queryKey: ['configs'], queryFn: getConfigs });
  const { data: mules = [] } = useQuery({ queryKey: ['mules'], queryFn: getMules });

  const runningMules = mules.filter(m => m.status === 'running').length;
  const { steps, current } = setupState(configs.length, runningMules);

  /*
   * A ticked step 1 and a populated Configs panel were two facts the user had
   * to join up themselves — the tick asserted "done" without ever saying what
   * satisfied it. Name the count instead. Guarded on configs.length because a
   * mule can be running after its config was deleted, in which case the step is
   * still done (see setupState) but there is nothing to point at.
   */
  const detailFor = (id: SetupStepId, done: boolean): string => {
    if (id === 'config' && done && configs.length > 0) {
      const n = configs.length;
      return `${n} config${n === 1 ? '' : 's'} stored, ready to deploy from.`;
    }
    return COPY[id].detail;
  };

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
              /*
               * The current step used to be filled with `smuggler-light` and
               * bordered with `smuggler-light-color`. On the dark surface that
               * resolves to a maroon fill (#3e1709) behind a near-white border
               * — Mantine's `-light-color` is a *content* colour, not a border
               * one — so the active step read as a danger callout sitting under
               * a green tick. An orange left accent says "you are here" without
               * colouring the whole row, and leaving the surface alone keeps
               * c="dimmed" on the background it was calibrated against (any
               * fill, even a neutral one, drops it under AA).
               */
              style={isCurrent ? {
                boxShadow: 'inset 3px 0 0 0 var(--mantine-color-smuggler-5)',
              } : undefined}
            >
              <Group gap="md" wrap="nowrap">
                {/* One badge, three states: done, current, still to come. */}
                <ThemeIcon
                  size={28}
                  radius="xl"
                  variant={isCurrent ? 'filled' : 'light'}
                  color={(() => {
                    if (step.done) return 'teal';
                    return isCurrent ? 'smuggler' : 'gray';
                  })()}
                  aria-hidden
                >
                  {step.done ? <Check size={14} /> : <Text size="xs" fw={700}>{i + 1}</Text>}
                </ThemeIcon>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text size="sm" fw={500} c={step.done ? 'dimmed' : undefined}>
                    {copy.title}
                    {step.done && <VisuallyHidden> — done</VisuallyHidden>}
                  </Text>
                  <Text size="xs" c="dimmed" mt={2}>{detailFor(step.id, step.done)}</Text>
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
