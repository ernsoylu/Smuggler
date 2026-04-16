import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getMules, getWatchdogStatus, triggerWatchdogSweep, evacuateMule } from '../api/client';
import type { WatchdogStatus } from '../api/types';
import { WorkerCard } from '../components/MuleCard';
import { DeployMuleModal } from '../components/DeployMuleModal';
import { ShieldCheck, Rocket, Shield, ShieldAlert, ShieldOff, RefreshCw, LogOut } from 'lucide-react';

type DeployStage = 'STARTING' | 'CONFIGURING' | 'CONNECTING' | 'DEPLOYED';

interface DeployingMule {
  id: string;
  configName: string;
  stage: DeployStage;
  startedAt: number;
}

const STAGE_ORDER: DeployStage[] = ['STARTING', 'CONFIGURING', 'CONNECTING', 'DEPLOYED'];
const STAGE_TIMINGS: Record<DeployStage, number> = {
  STARTING: 0,
  CONFIGURING: 3000,
  CONNECTING: 8000,
  DEPLOYED: 0, // set by API completion
};

const STAGE_COLORS: Record<DeployStage, { bg: string; text: string; ring: string }> = {
  STARTING:     { bg: 'bg-amber-500/10',   text: 'text-amber-400',   ring: 'ring-amber-500/20' },
  CONFIGURING:  { bg: 'bg-orange-500/10',  text: 'text-orange-400',  ring: 'ring-orange-500/20' },
  CONNECTING:   { bg: 'bg-blue-500/10',    text: 'text-blue-400',    ring: 'ring-blue-500/20' },
  DEPLOYED:     { bg: 'bg-emerald-500/10', text: 'text-emerald-400', ring: 'ring-emerald-500/20' },
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

function WatchdogPanel({ watchdog }: { watchdog: WatchdogStatus | undefined }) {
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
              {allHealthy ? 'All VPN connections secure' : `${unhealthy.length} mule${unhealthy.length > 1 ? 's' : ''} compromised`}
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

  // When actual workers appear, clean up deploying placeholders
  useEffect(() => {
    if (deployingMules.length === 0) return;
    setDeployingMules(prev =>
      prev.filter(m => {
        if (m.stage === 'DEPLOYED') {
          return Date.now() - m.startedAt < 95000;
        }
        return true;
      })
    );
  }, [workers, deployingMules.length]);

  const handleDeployStart = (configName: string) => {
    const newMule: DeployingMule = {
      id: `deploying-${Date.now()}`,
      configName,
      stage: 'STARTING',
      startedAt: Date.now(),
    };
    setDeployingMules(prev => [...prev, newMule]);
  };

  const handleModalClose = () => {
    setShowModal(false);
    // Mark any remaining deploying mules as DEPLOYED when modal closes (API returned success)
    setDeployingMules(prev =>
      prev.map(m => m.stage !== 'DEPLOYED' ? { ...m, stage: 'DEPLOYED' as DeployStage } : m)
    );
    // Clean them up after 3 seconds
    setTimeout(() => {
      setDeployingMules([]);
    }, 3000);
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

      {/* Deploying mules progress cards */}
      {deployingMules.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mb-8">
          {deployingMules.map(m => {
            const sc = STAGE_COLORS[m.stage];
            const stageIdx = STAGE_ORDER.indexOf(m.stage);
            const progressPct = ((stageIdx + 1) / STAGE_ORDER.length) * 100;

            return (
              <div
                key={m.id}
                className="bg-neutral-900/40 backdrop-blur-sm border border-white/5 shadow-xl rounded-2xl flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300"
              >
                {/* Header */}
                <div className="p-5 border-b border-white/5 bg-neutral-900/50">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex gap-3 min-w-0">
                      <div className="mt-1 w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse shrink-0" />
                      <div className="min-w-0">
                        <p className="font-semibold text-white tracking-tight truncate text-base">{m.configName}</p>
                        <p className="text-xs text-neutral-500 font-mono tracking-tighter mt-0.5">deploying...</p>
                      </div>
                    </div>
                    <span className={`text-xs px-2.5 py-1 rounded-md font-semibold ring-1 inset-ring shrink-0 ${sc.text} ${sc.bg} ${sc.ring}`}>
                      {m.stage}
                    </span>
                  </div>
                </div>

                {/* Deployment progress */}
                <div className="p-5 flex flex-col gap-4">
                  {/* Progress bar */}
                  <div className="space-y-2">
                    <div className="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all duration-1000 ease-out"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </div>

                  {/* Stage indicators */}
                  <div className="flex flex-col gap-1.5">
                    {STAGE_ORDER.map((stage, i) => {
                      const isActive = i === stageIdx;
                      const isDone = i < stageIdx;
                      const isPending = i > stageIdx;
                      return (
                        <div key={stage} className={`flex items-center gap-2.5 text-xs transition-all ${isPending ? 'opacity-30' : ''}`}>
                          {isDone ? (
                            <div className="w-4 h-4 rounded-full bg-emerald-500/20 flex items-center justify-center">
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400"><polyline points="20 6 9 17 4 12" /></svg>
                            </div>
                          ) : isActive ? (
                            <div className="w-4 h-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
                          ) : (
                            <div className="w-4 h-4 rounded-full border border-neutral-700" />
                          )}
                          <span className={`font-medium ${isActive ? 'text-white' : isDone ? 'text-neutral-400' : 'text-neutral-600'}`}>
                            {stage.charAt(0) + stage.slice(1).toLowerCase()}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Watchdog security panel */}
      {watchdog && watchdog.mules.length > 0 && <WatchdogPanel watchdog={watchdog} />}

      {/* Active deployments */}
      <div className="flex items-center gap-3 mb-6">
        <h3 className="text-lg font-bold text-white tracking-tight">Active Deployments</h3>
        <span className="px-2.5 py-0.5 rounded-full bg-neutral-800 text-neutral-400 text-xs font-semibold">{workers.length}</span>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center p-12 text-neutral-500 gap-3">
          <div className="w-5 h-5 border-2 border-neutral-500 border-t-transparent rounded-full animate-spin" />
          <span className="font-medium text-sm">Querying active mules...</span>
        </div>
      ) : workers.length === 0 && deployingMules.length === 0 ? (
        <div className="border-2 border-dashed border-white/10 rounded-2xl p-16 text-center flex flex-col items-center justify-center">
          <ShieldCheck size={48} className="text-neutral-700 mx-auto mb-4" strokeWidth={1} />
          <p className="text-neutral-400 font-medium max-w-sm">No mules are currently running. Click "Deploy Mule" to get started.</p>
        </div>
      ) : (
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
