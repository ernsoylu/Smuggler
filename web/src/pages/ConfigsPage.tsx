import { useRef, useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getConfigs, uploadConfig, deleteConfig, deployMuleFromConfig } from '../api/client';
import { FileUp, Trash2, Rocket, Shield, Plus, FileKey2 } from 'lucide-react';

type DeployStage = 'STARTING' | 'CONFIGURING' | 'CONNECTING' | 'DEPLOYED';

interface DeployingMule {
  configId: number;
  configName: string;
  stage: DeployStage;
  startedAt: number;
  error?: string;
}

const STAGE_ORDER: DeployStage[] = ['STARTING', 'CONFIGURING', 'CONNECTING', 'DEPLOYED'];

const STAGE_COLORS: Record<DeployStage, { bg: string; text: string; ring: string }> = {
  STARTING:     { bg: 'bg-amber-500/10',   text: 'text-amber-400',   ring: 'ring-amber-500/20' },
  CONFIGURING:  { bg: 'bg-orange-500/10',  text: 'text-orange-400',  ring: 'ring-orange-500/20' },
  CONNECTING:   { bg: 'bg-blue-500/10',    text: 'text-blue-400',    ring: 'ring-blue-500/20' },
  DEPLOYED:     { bg: 'bg-emerald-500/10', text: 'text-emerald-400', ring: 'ring-emerald-500/20' },
};

export function ConfigsPage() {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [deployingMules, setDeployingMules] = useState<DeployingMule[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: configs = [], isLoading } = useQuery({
    queryKey: ['configs'],
    queryFn: getConfigs,
  });

  const upload = useMutation({
    mutationFn: () => {
      if (!file) throw new Error('Select a config file');
      return uploadConfig(file, name.trim() || undefined);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['configs'] });
      setFile(null);
      setName('');
      setError('');
      if (fileRef.current) fileRef.current.value = '';
    },
    onError: (e: Error) => setError(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: number) => deleteConfig(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['configs'] }),
  });

  // Progress deploying mules through stages
  useEffect(() => {
    if (deployingMules.length === 0) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setDeployingMules(prev =>
        prev.map(m => {
          if (m.stage === 'DEPLOYED' || m.error) return m;
          const elapsed = now - m.startedAt;
          let newStage: DeployStage = 'STARTING';
          if (elapsed >= 8000) newStage = 'CONNECTING';
          else if (elapsed >= 3000) newStage = 'CONFIGURING';
          return { ...m, stage: newStage };
        })
      );
    }, 1000);
    return () => clearInterval(timer);
  }, [deployingMules.length]);

  // Clean up deployed mules after 4 seconds
  useEffect(() => {
    const deployed = deployingMules.filter(m => m.stage === 'DEPLOYED');
    if (deployed.length === 0) return;
    const timer = setTimeout(() => {
      setDeployingMules(prev => prev.filter(m => m.stage !== 'DEPLOYED'));
    }, 4000);
    return () => clearTimeout(timer);
  }, [deployingMules]);

  const handleDeploy = async (configId: number, configName: string) => {
    const newMule: DeployingMule = {
      configId,
      configName,
      stage: 'STARTING',
      startedAt: Date.now(),
    };
    setDeployingMules(prev => [...prev, newMule]);

    try {
      await deployMuleFromConfig(configId);
      qc.invalidateQueries({ queryKey: ['workers'] });
      setDeployingMules(prev =>
        prev.map(m => m.configId === configId && m.startedAt === newMule.startedAt
          ? { ...m, stage: 'DEPLOYED' as DeployStage }
          : m
        )
      );
    } catch (e: any) {
      setDeployingMules(prev =>
        prev.map(m => m.configId === configId && m.startedAt === newMule.startedAt
          ? { ...m, error: e.message || 'Deploy failed' }
          : m
        )
      );
    }
  };

  const isDeployingConfig = (configId: number) =>
    deployingMules.some(m => m.configId === configId && !m.error && m.stage !== 'DEPLOYED');

  return (
    <div className="p-6 md:p-8">
      <div className="mb-10">
        <h1 className="text-2xl font-bold tracking-tight text-white">VPN Configurations</h1>
        <p className="text-neutral-400 text-sm mt-1">Upload and manage WireGuard configs. Deploy mules directly from stored configurations.</p>
      </div>

      {/* Upload Form */}
      <div className="bg-neutral-900/40 backdrop-blur-md border border-white/5 shadow-2xl rounded-2xl p-6 md:p-8 mb-8 relative overflow-hidden max-w-3xl">
        <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/5 blur-[100px] rounded-full pointer-events-none"></div>

        <h2 className="text-base font-semibold text-white mb-6 flex items-center gap-2">
          <Plus size={20} className="text-emerald-400" /> Upload Configuration
        </h2>

        <div className="flex flex-col sm:flex-row gap-4 items-end">
          <div className="flex-1 w-full group">
            <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-2">Config File</label>
            <div
              className="w-full flex items-center gap-3 bg-neutral-950 hover:bg-neutral-900 border border-white/10 hover:border-emerald-500/50 transition-all rounded-xl px-4 py-3 cursor-pointer ring-4 ring-transparent focus-within:ring-emerald-500/10"
              onClick={() => fileRef.current?.click()}
            >
              <div className="w-8 h-8 rounded-md bg-white/5 flex items-center justify-center text-neutral-400 group-hover:text-emerald-400 transition-colors">
                <FileUp size={16} />
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".conf"
                className="hidden"
                onChange={e => { setFile(e.target.files?.[0] ?? null); setError(''); }}
              />
              <span className={`text-sm truncate font-medium ${file ? 'text-emerald-400' : 'text-neutral-500'}`}>
                {file ? file.name : 'Select WireGuard .conf'}
              </span>
            </div>
          </div>

          <div className="flex-[0.6] w-full">
            <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-2">Name <span className="text-neutral-600 font-normal normal-case">(Optional)</span></label>
            <input
              type="text"
              placeholder="e.g. US West"
              className="w-full bg-neutral-950 border border-white/10 rounded-xl text-sm text-white px-4 py-3.5 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all placeholder:text-neutral-600"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>

          <button
            className="w-full sm:w-auto py-3.5 px-8 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-sm text-white font-bold shadow-lg shadow-emerald-500/20 transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2"
            onClick={() => upload.mutate()}
            disabled={upload.isPending || !file}
          >
            {upload.isPending ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                Uploading...
              </>
            ) : 'Upload'}
          </button>
        </div>

        {error && (
          <div className="mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
            <p className="text-sm font-medium text-red-400">{error}</p>
          </div>
        )}
      </div>

      {/* Deploying Mule Cards */}
      {deployingMules.length > 0 && (
        <div className="mb-8 max-w-3xl">
          <h3 className="text-sm font-bold text-white tracking-tight mb-3 flex items-center gap-2">
            <Rocket size={14} className="text-blue-400" /> Deploying
          </h3>
          <div className="space-y-3">
            {deployingMules.map((m, i) => {
              const sc = m.error ? { bg: 'bg-red-500/10', text: 'text-red-400', ring: 'ring-red-500/20' } : STAGE_COLORS[m.stage];
              const stageIdx = STAGE_ORDER.indexOf(m.stage);
              const progressPct = m.error ? 0 : ((stageIdx + 1) / STAGE_ORDER.length) * 100;

              return (
                <div key={i} className={`p-4 rounded-xl border transition-all ${sc.bg} ${sc.ring} ring-1`}>
                  <div className="flex items-center justify-between gap-4 mb-3">
                    <div className="flex items-center gap-3">
                      {!m.error && m.stage !== 'DEPLOYED' ? (
                        <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                      ) : m.error ? (
                        <div className="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center text-red-400 text-xs font-bold">!</div>
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400"><polyline points="20 6 9 17 4 12" /></svg>
                        </div>
                      )}
                      <span className="text-sm font-semibold text-white">{m.configName}</span>
                    </div>
                    <span className={`text-xs font-bold uppercase tracking-wider ${sc.text}`}>
                      {m.error ? 'FAILED' : m.stage}
                    </span>
                  </div>
                  {!m.error && (
                    <div className="w-full h-1 bg-black/20 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all duration-1000 ease-out"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  )}
                  {m.error && (
                    <p className="text-xs text-red-300 mt-1">{m.error}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Configs List */}
      <div className="flex items-center gap-3 mb-6">
        <h3 className="text-lg font-bold text-white tracking-tight">Stored Configurations</h3>
        <span className="px-2.5 py-0.5 rounded-full bg-neutral-800 text-neutral-400 text-xs font-semibold">{configs.length}</span>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center p-12 text-neutral-500 gap-3">
          <div className="w-5 h-5 border-2 border-neutral-500 border-t-transparent rounded-full animate-spin"></div>
          <span className="font-medium text-sm">Loading configurations...</span>
        </div>
      ) : configs.length === 0 ? (
        <div className="border-2 border-dashed border-white/10 rounded-2xl p-16 text-center flex flex-col items-center justify-center max-w-3xl">
          <FileKey2 size={48} className="text-neutral-700 mx-auto mb-4" strokeWidth={1} />
          <p className="text-neutral-400 font-medium max-w-sm">No VPN configurations stored yet. Upload a WireGuard config above to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl">
          {configs.map(cfg => (
            <div key={cfg.id} className="bg-neutral-900/40 backdrop-blur-sm border border-white/5 hover:border-white/10 rounded-2xl p-5 flex flex-col gap-4 transition-all group">
              {/* Header */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex gap-3 min-w-0">
                  <div className="mt-0.5 w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400 shrink-0">
                    <Shield size={18} />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-white text-sm truncate">{cfg.name}</p>
                    <p className="text-xs text-neutral-500 font-mono truncate mt-0.5">{cfg.filename}</p>
                  </div>
                </div>
              </div>

              {/* Meta */}
              <div className="flex justify-between items-center bg-white/5 px-3 py-2 rounded-lg">
                <span className="text-neutral-500 font-medium text-xs">Added</span>
                <span className="text-neutral-300 text-xs">{new Date(cfg.created_at).toLocaleDateString()}</span>
              </div>

              {/* Actions */}
              <div className="flex gap-2 mt-auto">
                <button
                  className="flex items-center justify-center gap-1.5 flex-1 text-sm font-semibold py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-lg shadow-blue-500/10 transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
                  onClick={() => handleDeploy(cfg.id, cfg.name)}
                  disabled={isDeployingConfig(cfg.id)}
                >
                  {isDeployingConfig(cfg.id) ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      Deploying...
                    </>
                  ) : (
                    <>
                      <Rocket size={14} /> Deploy Mule
                    </>
                  )}
                </button>
                <button
                  className="p-2.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors disabled:opacity-50"
                  onClick={() => remove.mutate(cfg.id)}
                  disabled={remove.isPending}
                  title="Delete configuration"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
