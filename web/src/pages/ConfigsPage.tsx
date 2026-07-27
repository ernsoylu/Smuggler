import { useRef, useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ActionIcon, Alert, Badge, Box, Button, Card, Group, Loader, Paper, PasswordInput,
  Progress, SimpleGrid, Stack, Text, TextInput, ThemeIcon, Title, UnstyledButton,
} from '@mantine/core';
import { getConfigs, getMules, uploadConfig, deleteConfig } from '../api/client';
import type { VpnConfig, DeployPhase } from '../api/types';
import { useNotifications } from '../context/NotificationContext';
import { useDeployments, type DeploymentView } from '../context/DeploymentContext';
import {
  FileUp, Trash2, Rocket, Shield, Plus, FileKey2, Lock, KeyRound, Check,
} from 'lucide-react';

type VpnType = 'wireguard' | 'openvpn';

const PHASE_COLORS: Record<DeployPhase, string> = {
  starting: 'yellow',
  configuring: 'orange',
  connecting: 'blue',
  deployed: 'teal',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function detectVpnType(filename: string): VpnType {
  return filename.toLowerCase().endsWith('.ovpn') ? 'openvpn' : 'wireguard';
}

async function detectRequiresAuth(file: File): Promise<boolean> {
  const text = await file.text();
  return text.split('\n').some(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) return false;
    const parts = trimmed.split(/\s+/);
    return parts[0].toLowerCase() === 'auth-user-pass' && parts.length === 1;
  });
}

function tinted(color: string): React.CSSProperties {
  return {
    background: `var(--mantine-color-${color}-light)`,
    borderColor: `var(--mantine-color-${color}-light-color)`,
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function VpnTypeBadge({ type }: Readonly<{ type: VpnType }>) {
  const isOvpn = type === 'openvpn';
  return (
    <Badge
      variant="light"
      color={isOvpn ? 'violet' : 'teal'}
      size="sm"
      radius="sm"
      leftSection={isOvpn ? <Lock size={10} /> : <Shield size={10} />}
    >
      {isOvpn ? 'OpenVPN' : 'WireGuard'}
    </Badge>
  );
}

/**
 * One fact, as a label/value line.
 *
 * Was a filled `Paper` per fact, so a config card rendered Type / Auth / Added
 * as three stacked boxes inside a fourth. The card is the container.
 */
function MetaRow({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <Group justify="space-between" gap="sm" wrap="nowrap">
      <Text size="10px" fw={600} tt="uppercase" c="dimmed" lts={0.8}>{label}</Text>
      {children}
    </Group>
  );
}

function ConfigCard({
  cfg,
  onDeploy,
  onDelete,
  isDeploying,
  isDeleting,
  isInUse,
}: Readonly<{
  cfg: VpnConfig;
  onDeploy: () => void;
  onDelete: () => void;
  isDeploying: boolean;
  isDeleting: boolean;
  isInUse: boolean;
}>) {
  const isOvpn = cfg.vpn_type === 'openvpn';

  return (
    <Card withBorder radius="md" p="sm" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Group gap="sm" wrap="nowrap" align="center">
        <ThemeIcon variant="light" color={isOvpn ? 'violet' : 'teal'} size={28} radius="md">
          {isOvpn ? <Lock size={14} /> : <Shield size={14} />}
        </ThemeIcon>
        <Stack gap={0} miw={0} flex={1}>
          <Text size="sm" fw={600} truncate>{cfg.name}</Text>
          <Text size="10px" c="dimmed" ff="monospace" truncate>{cfg.filename}</Text>
        </Stack>
        <VpnTypeBadge type={cfg.vpn_type ?? 'wireguard'} />
      </Group>

      {/* Type moved up beside the name; only what is left needs a row. */}
      <Stack gap={4}>
        {cfg.vpn_type === 'openvpn' && (
          <MetaRow label="Auth">
            <Text size="xs" fw={600} c={cfg.requires_auth ? 'var(--smg-attention)' : 'dimmed'}>
              {cfg.requires_auth ? 'Credentials stored' : 'Not required'}
            </Text>
          </MetaRow>
        )}
        <MetaRow label="Added">
          <Text size="xs">{new Date(cfg.created_at).toLocaleDateString()}</Text>
        </MetaRow>
      </Stack>

      <Group gap={6} mt="auto" wrap="nowrap">
        <Button
          flex={1}
          size="compact-sm"
          leftSection={isDeploying ? undefined : (isInUse ? <Shield size={13} /> : <Rocket size={13} />)}
          onClick={onDeploy}
          disabled={isInUse}
          loading={isDeploying}
          title={isInUse ? 'Config is already in use by an active mule' : undefined}
        >
          {isInUse ? 'In Use' : 'Deploy Mule'}
        </Button>
        <ActionIcon
          size="md"
          variant="subtle"
          color="red"
          onClick={onDelete}
          disabled={isDeleting}
          aria-label={`Delete ${cfg.name}`}
          title="Delete configuration"
        >
          <Trash2 size={14} />
        </ActionIcon>
      </Group>
    </Card>
  );
}

function ConfigSection({
  title,
  configs,
  deployments,
  inUseConfigIds,
  onDeploy,
  onDelete,
  deletingId,
}: Readonly<{
  title: string;
  configs: VpnConfig[];
  deployments: DeploymentView[];
  inUseConfigIds: Set<number>;
  onDeploy: (id: number, name: string) => void;
  onDelete: (id: number) => void;
  deletingId: number | null;
}>) {
  if (configs.length === 0) return null;
  return (
    <Box mb="lg">
      <Text size="sm" fw={700} tt="uppercase" c="dimmed" lts={1} mb="sm">{title}</Text>
      <SimpleGrid type="container" cols={{ base: 1, '560px': 2, '960px': 3 }} spacing="md">
        {configs.map(cfg => (
          <ConfigCard
            key={cfg.id}
            cfg={cfg}
            onDeploy={() => onDeploy(cfg.id, cfg.name)}
            onDelete={() => onDelete(cfg.id)}
            isDeploying={deployments.some(
              d => d.config_id === cfg.id && d.state === 'running'
            )}
            isDeleting={deletingId === cfg.id}
            isInUse={inUseConfigIds.has(cfg.id)}
          />
        ))}
      </SimpleGrid>
    </Box>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function ConfigsPage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const { push: pushNotification } = useNotifications();

  // Upload form state
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [vpnType, setVpnType] = useState<VpnType>('wireguard');
  const [requiresAuth, setRequiresAuth] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  // Deploy progress state
  const { deployments, start, clearFinished } = useDeployments();
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const { data: configs = [], isLoading } = useQuery({
    queryKey: ['configs'],
    queryFn: getConfigs,
  });

  const { data: mules = [] } = useQuery({
    queryKey: ['mules'],
    queryFn: getMules,
    refetchInterval: 5000,
  });

  const inUseConfigIds = new Set(
    mules.flatMap(m => m.config_id != null ? [m.config_id] : [])
  );

  const wireguardConfigs = configs.filter(c => (c.vpn_type ?? 'wireguard') === 'wireguard');
  const openvpnConfigs   = configs.filter(c => c.vpn_type === 'openvpn');

  // ── File selection ──────────────────────────────────────────────────────────

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setError('');
    setRequiresAuth(false);
    setUsername('');
    setPassword('');
    if (!f) { setVpnType('wireguard'); return; }

    const type = detectVpnType(f.name);
    setVpnType(type);

    if (type === 'openvpn') {
      const needsAuth = await detectRequiresAuth(f);
      setRequiresAuth(needsAuth);
    }
  };

  // ── Upload mutation ─────────────────────────────────────────────────────────

  const upload = useMutation({
    mutationFn: () => {
      if (!file) throw new Error('Select a config file');
      if (vpnType === 'openvpn' && requiresAuth && (!username || !password)) {
        throw new Error('Username and password are required for this config');
      }
      return uploadConfig(file, name.trim() || undefined, username || undefined, password || undefined);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['configs'] });
      pushNotification({ type: 'success', title: 'Config uploaded', message: name.trim() || file?.name || 'Configuration stored successfully.' });
      setFile(null);
      setName('');
      setVpnType('wireguard');
      setRequiresAuth(false);
      setUsername('');
      setPassword('');
      setError('');
      if (fileRef.current) fileRef.current.value = '';
    },
    onError: (e: Error) => setError(e.message),
  });

  // ── Delete mutation ─────────────────────────────────────────────────────────

  const remove = useMutation({
    mutationFn: (id: number) => { setDeletingId(id); return deleteConfig(id); },
    onSettled: () => setDeletingId(null),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['configs'] }),
  });

  // ── Deploy logic ────────────────────────────────────────────────────────────

  // Clear finished cards a few seconds after the last one settles. Progress and
  // notifications are owned by DeploymentProvider, which polls the mule's real
  // phase rather than guessing from elapsed time.
  useEffect(() => {
    const settled = deployments.filter(d => d.state !== 'running');
    if (settled.length === 0) return;
    const timer = setTimeout(clearFinished, 4000);
    return () => clearTimeout(timer);
  }, [deployments, clearFinished]);

  const handleDeploy = (configId: number, configName: string) => {
    start(configId, configName).catch(() => {
      /* the provider has already surfaced this as a notification */
    });
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  let fileColor = 'dimmed';
  if (file) fileColor = vpnType === 'openvpn' ? 'violet.4' : 'teal.4';

  return (
    <Box p={{ base: 'sm', sm: 'lg' }}>
      <Box mb={{ base: 'lg', sm: 'xl' }}>
        <Title order={2} fz={{ base: 22, sm: 26 }}>VPN Configurations</Title>
        <Text size="sm" c="dimmed" mt={2}>
          Upload WireGuard (.conf) or OpenVPN (.ovpn) configs. Deploy mules directly from stored configurations.
        </Text>
      </Box>

      {/*
        ── Upload Form ──
        One row of controls at a single height, rather than a titled card
        wrapping a tall picker, a labelled input and a button on three different
        baselines. The heading is gone: the placeholder text already says what
        the control takes.
      */}
      <Paper withBorder radius="md" p="sm" mb="lg" maw={760}>
        {/*
          One row on a laptop, three stacked controls on a phone: the picker
          alone wants 200px, and a `nowrap` row squeezed the name field to about
          40 and pushed Upload off the edge.
        */}
        <Group align="center" gap="sm" wrap="wrap">
          <UnstyledButton
            component="label"
            htmlFor="config-file-input"
            flex={1}
            miw={{ base: '100%', xs: 200 }}
            px="sm"
            py={6}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              border: '1px solid var(--mantine-color-default-border)',
              borderRadius: 'var(--mantine-radius-sm)',
              cursor: 'pointer',
              minHeight: 36,
            }}
          >
            <FileUp
              size={15}
              color={file
                ? `var(--mantine-color-${vpnType === 'openvpn' ? 'violet' : 'teal'}-5)`
                : 'var(--mantine-color-dimmed)'}
              style={{ flexShrink: 0 }}
            />
            <input
              id="config-file-input"
              ref={fileRef}
              type="file"
              accept=".conf,.ovpn"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
            <Text size="sm" fw={500} c={fileColor} truncate>
              {file ? file.name : 'Select .conf or .ovpn'}
            </Text>
            {file && (
              <Text size="10px" c="dimmed" style={{ flexShrink: 0, marginLeft: 'auto' }}>
                {vpnType === 'openvpn' ? 'OpenVPN' : 'WireGuard'}
              </Text>
            )}
          </UnstyledButton>

          <TextInput
            id="config-name-input"
            aria-label="Configuration name (optional)"
            placeholder="Name (optional)"
            size="sm"
            value={name}
            onChange={e => setName(e.currentTarget.value)}
            flex={0.5}
            miw={140}
          />

          <Button
            size="sm"
            color="teal"
            leftSection={<Plus size={14} />}
            onClick={() => upload.mutate()}
            disabled={!file}
            loading={upload.isPending}
            flex={{ base: 1, xs: 'unset' }}
          >
            Upload
          </Button>
        </Group>

        {/* Row 2: OpenVPN credentials (shown when auth required) */}
        {vpnType === 'openvpn' && requiresAuth && (
          <Paper withBorder radius="md" p="md" mt="md" style={tinted('violet')}>
            <Group gap={6} mb="sm">
              <KeyRound size={12} color="var(--mantine-color-violet-4)" />
              <Text size="xs" fw={600} tt="uppercase" c="violet.4" lts={1}>
                OpenVPN Credentials Required
              </Text>
            </Group>
            <Group gap="sm" grow>
              <TextInput
                id="config-ovpn-username"
                label="Username"
                placeholder="VPN username"
                autoComplete="off"
                value={username}
                onChange={e => setUsername(e.currentTarget.value)}
              />
              <PasswordInput
                id="config-ovpn-password"
                label="Password"
                placeholder="VPN password"
                autoComplete="new-password"
                value={password}
                onChange={e => setPassword(e.currentTarget.value)}
              />
            </Group>
          </Paper>
        )}

        {/* Hint when openvpn but no auth required */}
        {vpnType === 'openvpn' && !requiresAuth && file && (
          <Group gap={6} mt="sm">
            <Lock size={12} color="var(--mantine-color-violet-4)" />
            <Text size="xs" c="dimmed">OpenVPN config detected — no credentials required.</Text>
          </Group>
        )}

        {error && (
          <Alert color="red" radius="md" p="sm" mt="md">
            <Text size="sm" fw={500} c="var(--smg-bad)">{error}</Text>
          </Alert>
        )}
      </Paper>

      {/* ── Deploying Mule Cards ── */}
      {deployments.length > 0 && (
        <Box mb="lg" maw={760}>
          <Group gap="xs" mb="sm">
            <Rocket size={14} color="var(--mantine-color-blue-4)" />
            <Text size="sm" fw={700}>Deploying</Text>
          </Group>
          <Stack gap="sm">
            {deployments.map((m) => {
              const failed = m.state === 'failed';
              const done = m.state === 'succeeded';
              const color = failed ? 'red' : PHASE_COLORS[m.phase];
              const progressPct = failed
                ? 0
                : ((m.phase_index + 1) / m.phase_count) * 100;
              return (
                <Paper key={m.id} withBorder radius="md" p="md" style={tinted(color)}>
                  <Group justify="space-between" gap="md" mb="sm">
                    <Group gap="sm">
                      {!failed && !done && <Loader size="xs" color="blue" />}
                      {failed && (
                        <ThemeIcon variant="light" color="red" size={20} radius="xl">
                          <Text size="xs" fw={700}>!</Text>
                        </ThemeIcon>
                      )}
                      {!failed && done && (
                        <ThemeIcon variant="light" color="teal" size={20} radius="xl">
                          <Check size={12} strokeWidth={3} />
                        </ThemeIcon>
                      )}
                      <Text size="sm" fw={600}>{m.configName}</Text>
                    </Group>
                    <Text size="xs" fw={700} tt="uppercase" lts={1} c={`${color}.4`}>
                      {failed ? 'FAILED' : m.phase}
                    </Text>
                  </Group>
                  {!failed && <Progress size="xs" value={progressPct} color="blue" />}
                  {failed && <Text size="xs" c="var(--smg-bad)" mt={4}>{m.error}</Text>}
                  {!failed && !done && <Text size="xs" c="dimmed" mt={8}>{m.detail}</Text>}
                </Paper>
              );
            })}
          </Stack>
        </Box>
      )}

      {/* ── Configs List ── */}
      <Group gap="sm" mb="md">
        <Title order={4}>Stored Configurations</Title>
        <Badge variant="default" radius="xl">{configs.length}</Badge>
      </Group>

      {isLoading && (
        <Group justify="center" p="xl" gap="sm">
          <Loader size="sm" color="gray" />
          <Text size="sm" fw={500} c="dimmed">Loading configurations...</Text>
        </Group>
      )}
      {!isLoading && configs.length === 0 && (
        <Paper
          radius="lg"
          p={48}
          maw={760}
          style={{ border: '2px dashed var(--mantine-color-default-border)', textAlign: 'center' }}
        >
          <Stack align="center" gap="sm">
            <FileKey2 size={48} strokeWidth={1} color="var(--mantine-color-dimmed)" />
            <Text c="dimmed" fw={500} maw={380}>
              No VPN configurations stored yet. Upload a WireGuard (.conf) or OpenVPN (.ovpn) config above.
            </Text>
          </Stack>
        </Paper>
      )}
      {!isLoading && configs.length > 0 && (
        <Box maw={1080}>
          <ConfigSection
            title="WireGuard"
            configs={wireguardConfigs}
            deployments={deployments}
            inUseConfigIds={inUseConfigIds}
            onDeploy={handleDeploy}
            onDelete={id => remove.mutate(id)}
            deletingId={deletingId}
          />
          <ConfigSection
            title="OpenVPN"
            configs={openvpnConfigs}
            deployments={deployments}
            inUseConfigIds={inUseConfigIds}
            onDeploy={handleDeploy}
            onDelete={id => remove.mutate(id)}
            deletingId={deletingId}
          />
        </Box>
      )}
    </Box>
  );
}
