import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
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

  useEffect(() => {
    if (isOpen) setDeleteFiles(false);
  }, [isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close modal"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm border-0 p-0 cursor-default"
        onClick={isPending ? undefined : onClose}
        disabled={isPending}
      />

      {/* Modal */}
      <div className="relative bg-neutral-900 border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl flex flex-col gap-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center text-red-500 shrink-0">
              <Trash2 size={20} />
            </div>
            <div>
              <h2 className="text-white font-bold text-lg tracking-tight">Delete Torrent</h2>
              <p className="text-xs text-neutral-400 mt-0.5">Are you sure you want to remove this?</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isPending}
            className="p-1.5 text-neutral-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        <div className="bg-neutral-950/50 p-3 rounded-lg border border-white/5 text-sm text-neutral-300 break-all line-clamp-2">
          {torrentName}
        </div>

        <label
          htmlFor="delete-files-checkbox"
          className="flex items-center gap-3 p-3 rounded-lg bg-red-500/5 border border-red-500/10 cursor-pointer hover:bg-red-500/10 transition-colors text-sm font-medium text-red-400"
        >
          <input
            id="delete-files-checkbox"
            type="checkbox"
            checked={deleteFiles}
            onChange={(e) => setDeleteFiles(e.target.checked)}
            className="w-4 h-4 text-red-500 bg-neutral-950 border-white/10 rounded focus:ring-red-500 focus:ring-offset-neutral-900 shrink-0"
          />
          <span>Delete downloaded files too</span>
          <span className="text-xs font-normal text-neutral-500 ml-auto">This action cannot be undone.</span>
        </label>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={isPending}
            className="flex-1 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-sm font-semibold text-neutral-300 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(deleteFiles)}
            disabled={isPending}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-sm text-white font-bold shadow-lg shadow-red-500/20 transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
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
    </div>,
    document.body
  );
}
