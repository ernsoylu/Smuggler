import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getMules, getWatchdogStatus, triggerWatchdogSweep, evacuateMule } from '../api/client';
import type { WatchdogStatus } from '../api/types';
import { WorkerCard } from '../components/MuleCard';
import { DeployMuleModal } from '../components/DeployMuleModal';
import { useNotifications } from '../context/NotificationContext';
import { ShieldCheck, Rocket, Shield, ShieldAlert, ShieldOff, RefreshCw, LogOut } from 'lucide-react';

type DeployStage = 'STARTING' | 'CONFIGURING' | 'CONNECTING' | 'DEPLOYED';

interface DeployingMule {
  id: string;
  configName: string;
  stage: DeployStage;
  startedAt: number;
  notificationId: string;
}

const STAGE_ORDER: DeployStage[] = ['STARTING', 'CONFIGURING', 'CONNECTING', 'DEPLOYED'];
const STAGE_TIMINGS: Record<DeployStage, number> = {
  STARTING: 0,
  CONFIGURING: 3000,
  CONNECTING: 8000,
  DEPLOYED: 0, // set by API completion
};

const STAGE_MESSAGES: Record<DeployStage, string> = {
  STARTING:    'Starting VPN mule…',
  CONFIGURING: 'Configuring VPN tunnel…',
  CONNECTING:  'Establishing VPN connection…',
  DEPLOYED:    'Mule is live and VPN is connected.',
};

function stepWorkersPageStages(prev: DeployingMule[]): DeployingMule[] {
  const now = Date.now();
  return prev.map(m => {
    if (m.stage === 'DEPLOYED') return m;
    const elapsed = now - m.startedAt;
    if (elapsed >= STAGE_TIMINGS.CONNECTING) return { ...m, stage: 'CONNECTING' as DeployStage };
    if (elapsed >= STAGE_TIMINGS.CONFIGURING) return { ...m, stage: 'CONFIGURING' as DeployStage };
    return { ...m, stage: 'STARTING' as DeployStage };
  });
}

function WatchdogPanel({ watchdog }: Readonly<{ watchdog: WatchdogStatus | undefined }>) {
  const qc = useQueryClient();

  const sweep = useMutation({
    mutationFn: triggerWatchdogSweep,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['watchdog'] }),
  });

  const evac = useMutation({
    mutationFn: (name: string) => evacuateMule(name, true),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['watchdog'] });
      qc.invalidateQueries({ queryKey: ['workers'] });
    },
  });

  if (!watchdog) return null;

  const unhealthy = watchdog.mules.filter(m => !m.healthy);
  const healthy   = watchdog.mules.filter(m => m.healthy);
  const allHealthy = unhealthy.length === 0;
  const mulesPlural = unhealthy.length > 1 ? 's' : '';
  const watchdogTitle = allHealthy ? 'All VPN connections secure' : `${unhealthy.length} mule${mulesPlural} compromised`;

  return (
    <div className={`rounded-2xl border shadow-xl p-5 mb-8 ${
      allHealthy
        ? 'bg-emerald-500/5 border-emerald-500/15'
        : 'bg-red-500/5 border-red-500/20'
    }`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          {allHealthy
            ? <Shield size={18} className="text-emerald-400" />
            : <ShieldAlert size={18} className="text-red-400" />}
          <div>
            <h3 className={`text-sm font-bold ${allHealthy ? 'text-emerald-300' : 'text-red-300'}`}>
              {watchdogTitle}
            </h3>
            <p className="text-[11px] text-neutral-500 mt-0.5">
              Watchdog · interval {watchdog.config.interval_seconds}s · {watchdog.stats.total_sweeps} sweeps · {watchdog.stats.total_evacuations} evacuations
              {watchdog.stats.last_run_at && ` · last check ${new Date(watchdog.stats.last_run_at).toLocaleTimeString()}`}
            </p>
          </div>
        </div>
        <button
          onClick={() => sweep.mutate()}
          disabled={sweep.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-300 text-xs font-medium transition-colors"
        >
          <RefreshCw size={13} className={sweep.isPending ? 'animate-spin' : ''} />
          Check now
        </button>
      </div>

      {/* Unhealthy mules */}
      {unhealthy.length > 0 && (
        <div className="space-y-2 mb-3">
          {unhealthy.map(m => (
            <div key={m.name} className="flex items-center justify-between bg-red-500/10 rounded-xl px-4 py-3 border border-red-500/20 gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <ShieldOff size={14} className="text-red-400 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-red-300 truncate">{m.name}</p>
                  <p className="text-[11px] text-red-400/70 truncate">{m.reason}</p>
                </div>
                {(m.consecutive_failures ?? 0) > 0 && (
                  <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded bg-red-500/20 text-red-300">
                    {m.consecutive_failures} fail{(m.consecutive_failures ?? 0) > 1 ? 's' : ''}
                  </span>
                )}
              </div>
              {!m.evacuated && (
                <button
                  onClick={() => evac.mutate(m.name)}
                  disabled={evac.isPending}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-300 text-xs font-semibold transition-colors"
                >
                  <LogOut size={12} /> Evacuate
                </button>
              )}
              {m.evacuated && (
                <span className="shrink-0 text-[11px] font-bold px-2.5 py-1 rounded bg-neutral-700 text-neutral-400">Evacuated</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Healthy mule mini-list */}
      {healthy.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {healthy.map(m => (
            <div key={m.name} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/15 text-xs text-emerald-400">
              <Shield size={11} />
              <span className="font-mono font-medium">{m.name}</span>
              {m.ip && <span className="text-emerald-500/60 font-mono">{m.ip}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function WorkersPage() {
  const [showModal, setShowModal] = useState(false);
  const [deployingMules, setDeployingMules] = useState<DeployingMule[]>([]);
  const { push: pushNotification, update: updateNotification } = useNotifications();
  const prevUnhealthyRef = useRef<Set<string>>(new Set());
  const prevDeployingRef = useRef<DeployingMule[]>([]);

  const { data: workers = [], isLoading } = useQuery({
    queryKey: ['workers'],
    queryFn: getMules,
    refetchInterval: 3_000,
  });

  const { data: watchdog } = useQuery({
    queryKey: ['watchdog'],
    queryFn: getWatchdogStatus,
    refetchInterval: 15_000,
  });

  // Progress deploying mules through stages based on elapsed time
  useEffect(() => {
    if (deployingMules.length === 0) return;
    const timer = setInterval(() => {
      setDeployingMules(stepWorkersPageStages);
    }, 1000);
    return () => clearInterval(timer);
  }, [deployingMules.length]);

  // Update notification progress when a mule advances to a new stage
  useEffect(() => {
    const prev = prevDeployingRef.current;
    for (const m of deployingMules) {
      const prevMule = prev.find(p => p.id === m.id);
      if (!prevMule || prevMule.stage !== m.stage) {
        const stageIdx = STAGE_ORDER.indexOf(m.stage);
        updateNotification(m.notificationId, {
          message: STAGE_MESSAGES[m.stage],
          progress: { current: stageIdx, total: STAGE_ORDER.length, label: m.stage },
        });
      }
    }
    prevDeployingRef.current = deployingMules;
  }, [deployingMules, updateNotification]);

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

  const handleDeployStart = (configName: string, notificationId: string) => {
    const newMule: DeployingMule = {
      id: `deploying-${Date.now()}`,
      configName,
      stage: 'STARTING',
      startedAt: Date.now(),
      notificationId,
    };
    setDeployingMules(prev => [...prev, newMule]);
  };

  const handleModalClose = () => {
    setShowModal(false);
    setDeployingMules([]);
  };

  return (
    <div className="p-6 md:p-8">
      <div className="flex items-start justify-between mb-10 gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Mules</h1>
          <p className="text-neutral-400 text-sm mt-1">Deploy and manage isolated VPN containers for secure proxying.</p>
        </div>
        <button
          className="flex items-center gap-2 py-2.5 px-6 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-sm text-white font-semibold shadow-lg shadow-blue-500/20 transition-all active:scale-95"
          onClick={() => setShowModal(true)}
        >
          <Rocket size={16} /> Deploy Mule
        </button>
      </div>

      {/* Watchdog security panel */}
      {watchdog && watchdog.mules.length > 0 && <WatchdogPanel watchdog={watchdog} />}

      {/* Active deployments */}
      <div className="flex items-center gap-3 mb-6">
        <h3 className="text-lg font-bold text-white tracking-tight">Active Deployments</h3>
        <span className="px-2.5 py-0.5 rounded-full bg-neutral-800 text-neutral-400 text-xs font-semibold">{workers.length}</span>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center p-12 text-neutral-500 gap-3">
          <div className="w-5 h-5 border-2 border-neutral-500 border-t-transparent rounded-full animate-spin" />
          <span className="font-medium text-sm">Querying active mules...</span>
        </div>
      )}
      {!isLoading && workers.length === 0 && (
        <div className="border-2 border-dashed border-white/10 rounded-2xl p-16 text-center flex flex-col items-center justify-center">
          <ShieldCheck size={48} className="text-neutral-700 mx-auto mb-4" strokeWidth={1} />
          <p className="text-neutral-400 font-medium max-w-sm">No mules are currently running. Click "Deploy Mule" to get started.</p>
        </div>
      )}
      {!isLoading && workers.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {workers.map(w => (
            <WorkerCard key={w.name} worker={w} />
          ))}
        </div>
      )}

      {showModal && (
        <DeployMuleModal
          onClose={handleModalClose}
          onDeployStart={handleDeployStart}
        />
      )}
    </div>
  );
}
