import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSettings, saveSettings } from '../api/client';
import { FolderOpen, Save, CheckCircle, AlertCircle, Gauge, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';

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

  useEffect(() => {
    if (settings) {
      setForm({
        download_dir: settings.download_dir || '',
        max_concurrent_downloads: settings.max_concurrent_downloads || '5',
        max_download_speed: settings.max_download_speed || '0',
        max_upload_speed: settings.max_upload_speed || '0',
      });
    }
  }, [settings]);

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

  return (
    <div className="p-6 md:p-8">
      <div className="mb-10">
        <h1 className="text-2xl font-bold tracking-tight text-white">Settings</h1>
        <p className="text-neutral-400 text-sm mt-1">Configure global application preferences.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-4xl">
        {/* Storage Section */}
        <div className="bg-neutral-900/40 backdrop-blur-md border border-white/5 shadow-2xl rounded-2xl p-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-48 h-48 bg-violet-500/5 blur-[80px] rounded-full pointer-events-none"></div>
          <h2 className="text-base font-semibold text-white mb-6 flex items-center gap-2">
            <FolderOpen size={20} className="text-violet-400" /> Storage
          </h2>

          {isLoading ? (
            <div className="flex items-center gap-3 text-neutral-500 py-8">
              <div className="w-5 h-5 border-2 border-neutral-500 border-t-transparent rounded-full animate-spin"></div>
              <span className="font-medium text-sm">Loading...</span>
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <label htmlFor="setting-dl-dir" className="block text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-2">Download Directory</label>
                <p className="text-xs text-neutral-500 mb-2">Absolute path where torrents are saved. Each torrent gets its own subfolder.</p>
                <input
                  id="setting-dl-dir"
                  type="text"
                  placeholder="/path/to/downloads"
                  className="w-full bg-neutral-950 border border-white/10 rounded-xl text-sm text-white px-4 py-3 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition-all placeholder:text-neutral-600 font-mono"
                  value={form.download_dir}
                  onChange={e => updateField('download_dir', e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="setting-max-concurrent" className="block text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-2">
                  <span className="flex items-center gap-1.5"><Gauge size={12} /> Max Simultaneous Downloads</span>
                </label>
                <p className="text-xs text-neutral-500 mb-2">Maximum number of active torrents downloading at once per mule.</p>
                <input
                  id="setting-max-concurrent"
                  type="number"
                  min="1"
                  max="100"
                  className="w-full bg-neutral-950 border border-white/10 rounded-xl text-sm text-white px-4 py-3 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition-all font-mono"
                  value={form.max_concurrent_downloads}
                  onChange={e => updateField('max_concurrent_downloads', e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        {/* Speed Limits Section */}
        <div className="bg-neutral-900/40 backdrop-blur-md border border-white/5 shadow-2xl rounded-2xl p-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-48 h-48 bg-blue-500/5 blur-[80px] rounded-full pointer-events-none"></div>
          <h2 className="text-base font-semibold text-white mb-6 flex items-center gap-2">
            <Gauge size={20} className="text-blue-400" /> Speed Limits
          </h2>

          {!isLoading && (
            <div className="space-y-5">
              <div>
                <label htmlFor="setting-max-dl-speed" className="block text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-2">
                  <span className="flex items-center gap-1.5"><ArrowDownToLine size={12} /> Max Download Speed</span>
                </label>
                <p className="text-xs text-neutral-500 mb-2">Global download rate limit in bytes/sec. Set to <code className="text-neutral-400 bg-neutral-800 px-1 py-0.5 rounded">0</code> for unlimited.</p>
                <div className="flex items-center gap-3">
                  <input
                    id="setting-max-dl-speed"
                    type="number"
                    min="0"
                    className="flex-1 bg-neutral-950 border border-white/10 rounded-xl text-sm text-white px-4 py-3 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all font-mono"
                    value={form.max_download_speed}
                    onChange={e => updateField('max_download_speed', e.target.value)}
                  />
                  <span className="text-xs text-neutral-500 font-medium shrink-0">B/s</span>
                </div>
              </div>
              <div>
                <label htmlFor="setting-max-ul-speed" className="block text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-2">
                  <span className="flex items-center gap-1.5"><ArrowUpFromLine size={12} /> Max Upload Speed</span>
                </label>
                <p className="text-xs text-neutral-500 mb-2">Global upload rate limit in bytes/sec. Set to <code className="text-neutral-400 bg-neutral-800 px-1 py-0.5 rounded">0</code> for unlimited.</p>
                <div className="flex items-center gap-3">
                  <input
                    id="setting-max-ul-speed"
                    type="number"
                    min="0"
                    className="flex-1 bg-neutral-950 border border-white/10 rounded-xl text-sm text-white px-4 py-3 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all font-mono"
                    value={form.max_upload_speed}
                    onChange={e => updateField('max_upload_speed', e.target.value)}
                  />
                  <span className="text-xs text-neutral-500 font-medium shrink-0">B/s</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Save Button */}
      <div className="flex items-center gap-4 pt-6 max-w-4xl">
        <button
          className="py-3 px-8 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-sm text-white font-bold shadow-lg shadow-violet-500/20 transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none flex items-center gap-2"
          onClick={() => save.mutate()}
          disabled={save.isPending || !hasChanges}
        >
          {save.isPending ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
              Saving...
            </>
          ) : (
            <>
              <Save size={16} />
              Save Changes
            </>
          )}
        </button>

        {saved && (
          <div className="flex items-center gap-2 text-emerald-400 text-sm font-medium animate-pulse">
            <CheckCircle size={16} />
            Settings saved
          </div>
        )}

        {save.isError && (
          <div className="flex items-center gap-2 text-red-400 text-sm font-medium">
            <AlertCircle size={16} />
            Failed to save
          </div>
        )}
      </div>
    </div>
  );
}
