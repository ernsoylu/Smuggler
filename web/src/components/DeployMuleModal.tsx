import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getConfigs, deployMuleFromConfig } from '../api/client';
import type { VpnConfig } from '../api/client';
import { useNotifications } from '../context/NotificationContext';
import { X, Rocket, Shield, FileKey2 } from 'lucide-react';

interface Props {
  onClose: () => void;
  onDeployStart?: (configName: string, notificationId: string) => void;
}

export function DeployMuleModal({ onClose, onDeployStart }: Readonly<Props>) {
  const qc = useQueryClient();
  const [deployingId, setDeployingId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const { push: pushNotification, update: updateNotification } = useNotifications();
  const deployingNotifIdRef = useRef<string | null>(null);

  const { data: configs = [], isLoading } = useQuery({
    queryKey: ['configs'],
    queryFn: getConfigs,
  });

  const deploy = useMutation({
    mutationFn: (config: VpnConfig) => {
      setDeployingId(config.id);
      setError('');
      const notifId = pushNotification({
        type: 'info',
        title: `Deploying "${config.name}"`,
        message: 'Starting VPN mule…',
        progress: { current: 0, total: 4, label: 'STARTING' },
      });
      deployingNotifIdRef.current = notifId;
      onDeployStart?.(config.name, notifId);
      return deployMuleFromConfig(config.id);
    },
    onSuccess: (_, config) => {
      qc.invalidateQueries({ queryKey: ['workers'] });
      qc.invalidateQueries({ queryKey: ['configs'] });
      if (deployingNotifIdRef.current) {
        updateNotification(deployingNotifIdRef.current, {
          type: 'success',
          title: `"${config.name}" deployed`,
          message: 'Mule is live and VPN is connected.',
          progress: undefined,
        });
        deployingNotifIdRef.current = null;
      }
      setDeployingId(null);
      onClose();
    },
    onError: (e: Error, config) => {
      if (deployingNotifIdRef.current) {
        updateNotification(deployingNotifIdRef.current, {
          type: 'error',
          title: `Failed to deploy "${config.name}"`,
          message: e.message,
          progress: undefined,
        });
        deployingNotifIdRef.current = null;
      }
      setError(e.message);
      setDeployingId(null);
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close modal"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm border-0 p-0 cursor-default"
        onClick={deployingId ? undefined : onClose}
        disabled={!!deployingId}
      />

      {/* Modal */}
      <div className="relative bg-neutral-900 border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[80vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/5">
          <h2 className="text-white font-bold text-xl tracking-tight flex items-center gap-2">
            <Rocket size={22} className="text-blue-400" /> Deploy Mule
          </h2>
          <button
            className="p-1.5 text-neutral-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors disabled:opacity-50"
            onClick={onClose}
            disabled={!!deployingId}
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading && (
            <div className="flex items-center justify-center gap-3 py-12 text-neutral-500">
              <div className="w-5 h-5 border-2 border-neutral-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm font-medium">Loading configs...</span>
            </div>
          )}
          {!isLoading && configs.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileKey2 size={40} className="text-neutral-700 mb-3" strokeWidth={1} />
              <p className="text-neutral-400 font-medium text-sm">No VPN configurations stored.</p>
              <p className="text-neutral-500 text-xs mt-1">Go to the Configs tab to upload one.</p>
            </div>
          )}
          {!isLoading && configs.length > 0 && (
            <div className="space-y-2">
              {configs.map(cfg => {
                const inUse = !!cfg.in_use_by_mule;
                const disabled = !!deployingId || inUse;
                return (
                <div
                  key={cfg.id}
                  className={`flex items-center justify-between gap-4 p-4 rounded-xl border transition-all ${
                    deployingId === cfg.id
                      ? 'bg-blue-500/5 border-blue-500/20'
                      : inUse
                        ? 'bg-neutral-950/30 border-white/5 opacity-60'
                        : 'bg-neutral-950/50 border-white/5 hover:border-white/10'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400 shrink-0">
                      <Shield size={18} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{cfg.name}</p>
                      <p className="text-xs text-neutral-500 font-mono truncate">{cfg.filename}</p>
                      {inUse && (
                        <p className="text-[11px] text-amber-400/80 mt-0.5 truncate">
                          In use by mule <span className="font-mono">{cfg.in_use_by_mule}</span>
                        </p>
                      )}
                    </div>
                  </div>

                  <button
                    className="shrink-0 py-2 px-4 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-xs text-white font-bold shadow-lg shadow-blue-500/15 transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none flex items-center gap-1.5"
                    onClick={() => deploy.mutate(cfg)}
                    disabled={disabled}
                    title={inUse ? `Already deployed as ${cfg.in_use_by_mule}` : undefined}
                  >
                    {deployingId === cfg.id ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Deploying...
                      </>
                    ) : inUse ? (
                      <>In use</>
                    ) : (
                      <>
                        <Rocket size={13} /> Deploy
                      </>
                    )}
                  </button>
                </div>
                );
              })}
            </div>
          )}

          {error && (
            <div className="mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
              <p className="text-sm font-medium text-red-400">{error}</p>
            </div>
          )}
        </div>

        {/* Footer hint */}
        {deployingId && (
          <div className="p-4 border-t border-white/5 bg-blue-500/5">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              <p className="text-sm font-medium text-blue-400">Negotiating VPN handshake... (up to 90s)</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
