import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Box, Button, Code, Group, Loader, Paper, SimpleGrid, Stack, Text, TextInput, Title,
} from '@mantine/core';
import { getSettings, saveSettings } from '../api/client';
import { FolderOpen, Save, CheckCircle, AlertCircle, Gauge, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';

function FieldLabel({ icon, children }: Readonly<{ icon?: React.ReactNode; children: React.ReactNode }>) {
  return (
    <Text size="xs" fw={600} tt="uppercase" c="dimmed" lts={1}
      style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {icon} {children}
    </Text>
  );
}

export function SettingsPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    download_dir: '',
    max_concurrent_downloads: '5',
    max_download_speed: '0',
    max_upload_speed: '0',
  });
  const [saved, setSaved] = useState(false);

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: getSettings,
  });

  // Populate the form once the settings load / change — render-phase sync from
  // the fetched data avoids the extra render an effect would cause.
  const [prevSettings, setPrevSettings] = useState(settings);
  if (settings && settings !== prevSettings) {
    setPrevSettings(settings);
    setForm({
      download_dir: settings.download_dir || '',
      max_concurrent_downloads: settings.max_concurrent_downloads || '5',
      max_download_speed: settings.max_download_speed || '0',
      max_upload_speed: settings.max_upload_speed || '0',
    });
  }

  const save = useMutation({
    mutationFn: () => saveSettings(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  const hasChanges = settings && (
    settings.download_dir !== form.download_dir ||
    settings.max_concurrent_downloads !== form.max_concurrent_downloads ||
    settings.max_download_speed !== form.max_download_speed ||
    settings.max_upload_speed !== form.max_upload_speed
  );

  const updateField = (key: string, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const monoInput = { input: { fontFamily: 'var(--mantine-font-family-monospace)' } };

  return (
    <Box p="lg">
      <Box mb="xl">
        <Title order={2}>Settings</Title>
        <Text size="sm" c="dimmed" mt={2}>Configure global application preferences.</Text>
      </Box>

      <SimpleGrid type="container" cols={{ base: 1, '760px': 2 }} spacing="lg" maw={960}>
        {/* Storage Section */}
        <Paper withBorder radius="lg" p="lg">
          <Group gap="xs" mb="md">
            <FolderOpen size={20} color="var(--mantine-color-violet-4)" />
            <Text fw={600}>Storage</Text>
          </Group>

          {isLoading ? (
            <Group gap="sm" py="xl">
              <Loader size="sm" color="gray" />
              <Text size="sm" fw={500} c="dimmed">Loading...</Text>
            </Group>
          ) : (
            <Stack gap="md">
              <div>
                <FieldLabel>Download Directory</FieldLabel>
                <Text size="xs" c="dimmed" mt={4} mb={6}>
                  Absolute path where torrents are saved. Each torrent gets its own subfolder.
                </Text>
                <TextInput
                  id="setting-dl-dir"
                  placeholder="/path/to/downloads"
                  value={form.download_dir}
                  onChange={e => updateField('download_dir', e.currentTarget.value)}
                  styles={monoInput}
                />
              </div>
              <div>
                <FieldLabel icon={<Gauge size={12} />}>Max Simultaneous Downloads</FieldLabel>
                <Text size="xs" c="dimmed" mt={4} mb={6}>
                  Maximum number of active torrents downloading at once per mule.
                </Text>
                <TextInput
                  id="setting-max-concurrent"
                  type="number"
                  min={1}
                  max={100}
                  value={form.max_concurrent_downloads}
                  onChange={e => updateField('max_concurrent_downloads', e.currentTarget.value)}
                  styles={monoInput}
                />
              </div>
            </Stack>
          )}
        </Paper>

        {/* Speed Limits Section */}
        <Paper withBorder radius="lg" p="lg">
          <Group gap="xs" mb="md">
            <Gauge size={20} color="var(--mantine-color-blue-4)" />
            <Text fw={600}>Speed Limits</Text>
          </Group>

          {!isLoading && (
            <Stack gap="md">
              <div>
                <FieldLabel icon={<ArrowDownToLine size={12} />}>Max Download Speed</FieldLabel>
                <Text size="xs" c="dimmed" mt={4} mb={6}>
                  Global download rate limit in bytes/sec. Set to <Code>0</Code> for unlimited.
                </Text>
                <TextInput
                  id="setting-max-dl-speed"
                  type="number"
                  min={0}
                  value={form.max_download_speed}
                  onChange={e => updateField('max_download_speed', e.currentTarget.value)}
                  rightSection={<Text size="xs" c="dimmed" fw={500}>B/s</Text>}
                  rightSectionWidth={40}
                  styles={monoInput}
                />
              </div>
              <div>
                <FieldLabel icon={<ArrowUpFromLine size={12} />}>Max Upload Speed</FieldLabel>
                <Text size="xs" c="dimmed" mt={4} mb={6}>
                  Global upload rate limit in bytes/sec. Set to <Code>0</Code> for unlimited.
                </Text>
                <TextInput
                  id="setting-max-ul-speed"
                  type="number"
                  min={0}
                  value={form.max_upload_speed}
                  onChange={e => updateField('max_upload_speed', e.currentTarget.value)}
                  rightSection={<Text size="xs" c="dimmed" fw={500}>B/s</Text>}
                  rightSectionWidth={40}
                  styles={monoInput}
                />
              </div>
            </Stack>
          )}
        </Paper>
      </SimpleGrid>

      {/* Save Button */}
      <Group gap="md" pt="lg">
        <Button
          color="violet"
          leftSection={save.isPending ? undefined : <Save size={16} />}
          onClick={() => save.mutate()}
          disabled={!hasChanges}
          loading={save.isPending}
        >
          Save Changes
        </Button>

        {saved && (
          <Group gap={6} c="var(--smg-ok)">
            <CheckCircle size={16} />
            <Text size="sm" fw={500}>Settings saved</Text>
          </Group>
        )}

        {save.isError && (
          <Group gap={6} c="var(--smg-bad)">
            <AlertCircle size={16} />
            <Text size="sm" fw={500}>Failed to save</Text>
          </Group>
        )}
      </Group>
    </Box>
  );
}
