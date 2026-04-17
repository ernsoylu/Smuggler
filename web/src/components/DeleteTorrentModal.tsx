import { useState, useEffect } from 'react';
import { Trash2, X } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (deleteFiles: boolean) => void;
  isPending: boolean;
  torrentName: string;
}

export function DeleteTorrentModal({ isOpen, onClose, onConfirm, isPending, torrentName }: Readonly<Props>) {
  const [deleteFiles, setDeleteFiles] = useState(false);

  // Reset state when opened
  useEffect(() => {
    if (isOpen) setDeleteFiles(false);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-neutral-900 border border-white/10 rounded-xl w-full max-w-md shadow-2xl overflow-hidden p-6 animate-in fade-in zoom-in-95 duration-200">
        
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center text-red-500">
              <Trash2 size={20} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Delete Torrent</h2>
              <p className="text-xs text-neutral-400 mt-0.5">Are you sure you want to remove this?</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-neutral-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="bg-neutral-950/50 p-3 rounded-lg border border-white/5 mb-6 text-sm text-neutral-300 break-all line-clamp-2">
          {torrentName}
        </div>

        <div className="mb-6">
          <label
            htmlFor="delete-files-checkbox"
            className="flex items-center gap-3 p-3 rounded-lg bg-red-500/5 border border-red-500/10 cursor-pointer hover:bg-red-500/10 transition-colors text-sm font-medium text-red-400"
          >
            <input
              id="delete-files-checkbox"
              type="checkbox"
              aria-label="Delete downloaded files too"
              checked={deleteFiles}
              onChange={(e) => setDeleteFiles(e.target.checked)}
              className="w-4 h-4 text-red-500 bg-neutral-950 border-white/10 rounded focus:ring-red-500 focus:ring-offset-neutral-900"
            />
            Delete downloaded files too
            <span className="text-xs font-normal text-neutral-500 ml-auto">This action cannot be undone.</span>
          </label>
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={isPending}
            className="px-4 py-2 text-sm font-medium text-neutral-300 bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(deleteFiles)}
            disabled={isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors disabled:opacity-50"
          >
            {isPending ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Deleting...
              </>
            ) : (
              'Delete'
            )}
          </button>
        </div>

      </div>
    </div>
  );
}
