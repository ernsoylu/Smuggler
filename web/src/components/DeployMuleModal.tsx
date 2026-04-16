import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getConfigs, deployMuleFromConfig } from '../api/client';
import type { VpnConfig } from '../api/client';
import { X, Rocket, Shield, FileKey2 } from 'lucide-react';

interface Props {
  onClose: () => void;
  onDeployStart?: (configName: string) => void;
}

export function DeployMuleModal({ onClose, onDeployStart }: Props) {
  const qc = useQueryClient();
  const [deployingId, setDeployingId] = useState<number | null>(null);
  const [error, setError] = useState('');

  const { data: configs = [], isLoading } = useQuery({
    queryKey: ['configs'],
    queryFn: getConfigs,
  });

  const deploy = useMutation({
    mutationFn: (config: VpnConfig) => {
      setDeployingId(config.id);
      setError('');
      onDeployStart?.(config.name);
      return deployMuleFromConfig(config.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workers'] });
      setDeployingId(null);
      onClose();
    },
    onError: (e: Error) => {
      setError(e.message);
      setDeployingId(null);
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        role="presentation"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={deployingId ? undefined : onClose}
        onKeyDown={e => !deployingId && e.key === 'Escape' && onClose()}
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
          {isLoading ? (
            <div className="flex items-center justify-center gap-3 py-12 text-neutral-500">
              <div className="w-5 h-5 border-2 border-neutral-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm font-medium">Loading configs...</span>
            </div>
          ) : configs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileKey2 size={40} className="text-neutral-700 mb-3" strokeWidth={1} />
              <p className="text-neutral-400 font-medium text-sm">No VPN configurations stored.</p>
              <p className="text-neutral-500 text-xs mt-1">Go to the Configs tab to upload one.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {configs.map(cfg => (
                <div
                  key={cfg.id}
                  className={`flex items-center justify-between gap-4 p-4 rounded-xl border transition-all ${
                    deployingId === cfg.id
                      ? 'bg-blue-500/5 border-blue-500/20'
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
                    </div>
                  </div>

                  <button
                    className="shrink-0 py-2 px-4 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-xs text-white font-bold shadow-lg shadow-blue-500/15 transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none flex items-center gap-1.5"
                    onClick={() => deploy.mutate(cfg)}
                    disabled={!!deployingId}
                  >
                    {deployingId === cfg.id ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Deploying...
                      </>
                    ) : (
                      <>
                        <Rocket size={13} /> Deploy
                      </>
                    )}
                  </button>
                </div>
              ))}
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
