import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Button, Center, Paper, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
  /** Shown instead of the default panel, if supplied. */
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Stops one bad render from blanking the whole app.
 *
 * Without this a single throw — a malformed torrent payload, an unexpected
 * null — unmounts everything and leaves a white page with no way back short of
 * a manual reload. "Try again" clears the error and re-renders; the polling
 * queries pick straight back up.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the component stack in the console — the panel deliberately shows
    // only the message, since it may be read over someone's shoulder.
    console.error('Unhandled render error:', error, info.componentStack);
  }

  private readonly reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    return (
      <Center p="xl" h="100%">
        <Paper
          withBorder
          p="lg"
          radius="lg"
          maw={420}
          w="100%"
          style={{
            textAlign: 'center',
            borderColor: 'var(--mantine-color-red-light-color)',
            background: 'var(--mantine-color-red-light)',
          }}
        >
          <Stack align="center" gap="xs">
            <ThemeIcon variant="light" color="red" size={48} radius="xl">
              <AlertTriangle size={22} />
            </ThemeIcon>
            <Title order={3}>Something broke rendering this view</Title>
            <Text size="sm" c="dimmed">
              The rest of Smuggler is still running — your downloads are unaffected.
            </Text>
            <Text size="xs" ff="monospace" c="red.4" style={{ wordBreak: 'break-word' }}>
              {error.message}
            </Text>
            <Button
              mt="sm"
              variant="default"
              leftSection={<RotateCcw size={15} />}
              onClick={this.reset}
            >
              Try again
            </Button>
          </Stack>
        </Paper>
      </Center>
    );
  }
}
