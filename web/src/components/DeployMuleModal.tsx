import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Alert, Box, Button, Group, Loader, Modal, Paper, ScrollArea, Stack, Text, ThemeIcon,
} from '@mantine/core';
import { getConfigs } from '../api/client';
import type { VpnConfig } from '../api/client';
import { useDeployments } from '../context/DeploymentContext';
import { useUiActions } from '../context/UiActionsContext';
import { useBelow } from '../hooks/useBreakpoint';
import { Rocket, Shield, FileKey2, FileUp } from 'lucide-react';

interface Props {
  onClose: () => void;
}

export function DeployMuleModal({ onClose }: Readonly<Props>) {
  const [deployingId, setDeployingId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const { start } = useDeployments();
  const { navigate } = useUiActions();
  const fullScreen = useBelow('sm');

  const { data: configs = [], isLoading } = useQuery({
    queryKey: ['configs'],
    queryFn: getConfigs,
  });

  // Kicks off the deployment and returns as soon as the job is accepted — the
  // provider owns progress reporting from there, so closing this modal no
  // longer abandons an in-flight deploy.
  const deploy = useMutation({
    mutationFn: async (config: VpnConfig) => {
      setDeployingId(config.id);
      setError('');
      return start(config.id, config.name);
    },
    onSuccess: () => {
      setDeployingId(null);
      onClose();
    },
    onError: (e: Error) => {
      setError(e.message);
      setDeployingId(null);
    },
  });

  return (
    <Modal
      opened
      onClose={onClose}
      centered
      radius={fullScreen ? 0 : 'lg'}
      size="lg"
      // Same reason as Add Torrent: the config list plus its credential fields
      // do not fit what a phone leaves above the keyboard.
      fullScreen={fullScreen}
      title={
        <Group gap="xs">
          <Rocket size={22} color="var(--mantine-color-blue-4)" />
          <Text fw={700} size="xl">Deploy Mule</Text>
        </Group>
      }
      // Deployment is irreversible once started, so Escape is disabled while it runs.
      closeOnEscape={!deployingId}
      closeOnClickOutside={!deployingId}
      withCloseButton={!deployingId}
    >
      <ScrollArea.Autosize mah="60vh">
        {isLoading && (
          <Group justify="center" gap="sm" py="xl">
            <Loader size="sm" color="gray" />
            <Text size="sm" fw={500} c="dimmed">Loading configs...</Text>
          </Group>
        )}
        {!isLoading && configs.length === 0 && (
          /* "Go to the Configs tab" was static text in a modal that covers the
             tab bar. It routes now. */
          <Stack align="center" py="xl" gap={4}>
            <FileKey2 size={40} strokeWidth={1} color="var(--mantine-color-dimmed)" />
            <Text size="sm" fw={500} c="dimmed" mt="xs">No VPN configurations stored.</Text>
            <Text size="xs" c="dimmed" mb="sm">
              A mule needs a WireGuard or OpenVPN config to build its tunnel from.
            </Text>
            <Button
              size="compact-sm"
              variant="default"
              leftSection={<FileUp size={13} />}
              onClick={() => { onClose(); navigate('configs'); }}
            >
              Upload a config
            </Button>
          </Stack>
        )}
        {!isLoading && configs.length > 0 && (
          <Stack gap="xs">
            {configs.map(cfg => {
              const inUse = !!cfg.in_use_by_mule;
              const disabled = !!deployingId || inUse;
              return (
                <Paper
                  key={cfg.id}
                  withBorder
                  radius="md"
                  p="md"
                  opacity={inUse ? 0.6 : 1}
                  style={deployingId === cfg.id ? {
                    background: 'var(--mantine-color-blue-light)',
                    borderColor: 'var(--mantine-color-blue-light-color)',
                  } : undefined}
                >
                  <Group justify="space-between" gap="md" wrap="nowrap">
                    <Group gap="sm" wrap="nowrap" miw={0}>
                      <ThemeIcon variant="light" color="teal" size={36} radius="md">
                        <Shield size={18} />
                      </ThemeIcon>
                      <Stack gap={0} miw={0}>
                        <Text size="sm" fw={600} truncate>{cfg.name}</Text>
                        <Text size="xs" c="dimmed" ff="monospace" truncate>{cfg.filename}</Text>
                        {inUse && (
                          <Text size="11px" c="var(--smg-attention)" truncate>
                            In use by mule <Text component="span" ff="monospace" size="11px">{cfg.in_use_by_mule}</Text>
                          </Text>
                        )}
                      </Stack>
                    </Group>

                    <Button
                      size="xs"
                      leftSection={deployingId === cfg.id || inUse ? undefined : <Rocket size={13} />}
                      onClick={() => deploy.mutate(cfg)}
                      disabled={disabled && deployingId !== cfg.id}
                      loading={deployingId === cfg.id}
                      title={inUse ? `Already deployed as ${cfg.in_use_by_mule}` : undefined}
                      style={{ flexShrink: 0 }}
                    >
                      {inUse ? 'In use' : 'Deploy'}
                    </Button>
                  </Group>
                </Paper>
              );
            })}
          </Stack>
        )}

        {error && (
          <Alert color="red" radius="md" p="sm" mt="md">
            <Text size="sm" fw={500} c="var(--smg-bad)">{error}</Text>
          </Alert>
        )}
      </ScrollArea.Autosize>

      {/* Footer hint */}
      {deployingId && (
        <Paper mt="md" p="sm" radius="md" style={{ background: 'var(--mantine-color-blue-light)' }}>
          <Group gap="sm">
            <Box w={8} h={8} bg="blue.5" style={{ borderRadius: '50%' }} className="smuggler-pulse" />
            <Text size="sm" fw={500} c="var(--smg-info)">Negotiating VPN handshake... (up to 90s)</Text>
          </Group>
        </Paper>
      )}
    </Modal>
  );
}
