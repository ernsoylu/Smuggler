import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { startDeployment, getDeployment } from '../api/client';
import type { Deployment, DeployPhase } from '../api/types';
import { useNotifications } from './NotificationContext';

/**
 * Tracks in-flight mule deployments for the whole app.
 *
 * Progress comes from polling the backend, which reports the phase the mule
 * itself writes to /tmp/vpn_health.json. This replaces the per-page timers that
 * advanced STARTING → CONFIGURING → CONNECTING on hardcoded 3s/8s thresholds,
 * where a stalled deploy looked exactly like a healthy one.
 *
 * It lives in a provider rather than a hook because a deploy outlives the modal
 * that starts it — component-local state would stop polling the moment the
 * modal closed, freezing the notification mid-progress.
 */

const POLL_MS = 1_000;

// eslint-disable-next-line react-refresh/only-export-components
export const PHASE_LABELS: Record<DeployPhase, string> = {
  starting:    'Starting VPN mule…',
  configuring: 'Configuring VPN tunnel…',
  connecting:  'Establishing VPN connection…',
  deployed:    'Mule is live and VPN is connected.',
};

export interface DeploymentView extends Deployment {
  configName: string;
}

interface DeploymentContextValue {
  deployments: DeploymentView[];
  start: (configId: number, configName: string) => Promise<Deployment>;
  clearFinished: () => void;
}

const DeploymentContext = createContext<DeploymentContextValue | null>(null);

function errorText(err: unknown): string {
  return (
    (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
    (err as Error)?.message ??
    'Unknown error'
  );
}

export function DeploymentProvider({ children }: Readonly<{ children: ReactNode }>) {
  const qc = useQueryClient();
  const { push, update } = useNotifications();
  const [deployments, setDeployments] = useState<DeploymentView[]>([]);

  const notifIds = useRef<Record<string, string>>({});
  const lastPhase = useRef<Record<string, string>>({});

  const start = useCallback(async (configId: number, configName: string) => {
    const notificationId = push({
      type: 'info',
      title: `Deploying "${configName}"`,
      message: PHASE_LABELS.starting,
      progress: { current: 0, total: 4, label: 'STARTING' },
    });
    try {
      const job = await startDeployment(configId);
      notifIds.current[job.id] = notificationId;
      setDeployments(prev => [...prev, { ...job, configName }]);
      return job;
    } catch (err: unknown) {
      update(notificationId, {
        type: 'error',
        title: `Failed to deploy "${configName}"`,
        message: errorText(err),
        progress: undefined,
      });
      throw err;
    }
  }, [push, update]);

  const hasRunning = deployments.some(d => d.state === 'running');

  useEffect(() => {
    if (!hasRunning) return;

    const tick = () => {
      setDeployments(prev => {
        prev
          .filter(d => d.state === 'running')
          .forEach(d => {
            getDeployment(d.id)
              .then(job => {
                setDeployments(cur =>
                  cur.map(p => (p.id === job.id ? { ...p, ...job } : p)),
                );
                const notificationId = notifIds.current[job.id];
                if (!notificationId) return;

                if (job.state === 'succeeded') {
                  update(notificationId, {
                    type: 'success',
                    title: `"${d.configName}" deployed`,
                    message: job.mule
                      ? `${job.mule} is live and the VPN is connected.`
                      : PHASE_LABELS.deployed,
                    progress: undefined,
                  });
                  qc.invalidateQueries({ queryKey: ['mules'] });
                  qc.invalidateQueries({ queryKey: ['configs'] });
                } else if (job.state === 'failed') {
                  update(notificationId, {
                    type: 'error',
                    title: `Failed to deploy "${d.configName}"`,
                    message: job.error ?? 'Deployment failed.',
                    progress: undefined,
                  });
                  qc.invalidateQueries({ queryKey: ['configs'] });
                } else if (lastPhase.current[job.id] !== job.phase) {
                  lastPhase.current[job.id] = job.phase;
                  update(notificationId, {
                    message: job.detail || PHASE_LABELS[job.phase],
                    progress: {
                      current: job.phase_index,
                      total: job.phase_count,
                      label: job.phase.toUpperCase(),
                    },
                  });
                }
              })
              .catch(() => {
                /* transient poll failure — the next tick retries */
              });
          });
        return prev;
      });
    };

    const timer = setInterval(tick, POLL_MS);
    return () => clearInterval(timer);
  }, [hasRunning, update, qc]);

  const clearFinished = useCallback(() => {
    setDeployments(prev => prev.filter(d => d.state === 'running'));
  }, []);

  const value = useMemo(
    () => ({ deployments, start, clearFinished }),
    [deployments, start, clearFinished],
  );

  return (
    <DeploymentContext.Provider value={value}>
      {children}
    </DeploymentContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useDeployments(): DeploymentContextValue {
  const ctx = useContext(DeploymentContext);
  if (!ctx) throw new Error('useDeployments must be used within a DeploymentProvider');
  return ctx;
}
