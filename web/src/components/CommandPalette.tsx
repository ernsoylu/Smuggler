import { useMemo, useRef, useState } from 'react';
import { useModalA11y, modalA11yProps } from '../hooks/useModalA11y';
import { PAGES, type Page } from '../lib/router';
import { useTheme } from '../context/ThemeContext';
import { fuzzyMatch } from '../lib/fuzzy';
import {
  Command, LayoutDashboard, Server, FileKey2, Settings, Plus, Rocket,
  Sun, Moon, Monitor, CornerDownLeft,
} from 'lucide-react';

/**
 * Ctrl/Cmd-K command palette.
 *
 * The app had no keyboard affordances at all — every action required reaching
 * for the mouse. This covers navigation, the two "create" actions and the
 * theme, which is everything reachable from the shell.
 */

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  run: () => void;
}

interface Props {
  onClose: () => void;
  onNavigate: (page: Page) => void;
  onAddTorrent: () => void;
  onDeployMule: () => void;
}

const PAGE_ICONS: Record<Page, React.ReactNode> = {
  torrents: <LayoutDashboard size={16} />,
  mules: <Server size={16} />,
  configs: <FileKey2 size={16} />,
  settings: <Settings size={16} />,
};

export function CommandPalette({ onClose, onNavigate, onAddTorrent, onDeployMule }: Readonly<Props>) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const { preference, cycle } = useTheme();
  const dialogRef = useModalA11y(onClose);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const actions: PaletteAction[] = useMemo(() => {
    const nav: PaletteAction[] = PAGES.map(p => ({
      id: `go-${p}`,
      label: `Go to ${p.charAt(0).toUpperCase()}${p.slice(1)}`,
      icon: PAGE_ICONS[p],
      run: () => onNavigate(p),
    }));
    const themeIcon =
      preference === 'light' ? <Sun size={16} /> :
      preference === 'dark' ? <Moon size={16} /> : <Monitor size={16} />;
    return [
      { id: 'add-torrent', label: 'Add torrent', hint: 'N', icon: <Plus size={16} />, run: onAddTorrent },
      { id: 'deploy-mule', label: 'Deploy mule', icon: <Rocket size={16} />, run: onDeployMule },
      ...nav,
      { id: 'theme', label: `Theme: ${preference} — switch`, icon: themeIcon, run: cycle },
    ];
  }, [preference, cycle, onNavigate, onAddTorrent, onDeployMule]);

  const results = useMemo(
    () => actions.filter(a => fuzzyMatch(a.label, query)),
    [actions, query],
  );

  // Derived rather than stored: typing can shrink the list under the cursor,
  // and clamping in an effect would be a cascading render.
  const active = Math.min(cursor, Math.max(0, results.length - 1));

  const choose = (action?: PaletteAction) => {
    if (!action) return;
    onClose();
    action.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor(c => (c + 1) % Math.max(1, results.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor(c => (c - 1 + results.length) % Math.max(1, results.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(results[active]);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center pt-[15vh]">
      <button
        type="button"
        aria-label="Close command palette"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm border-0 p-0 cursor-default"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        {...modalA11yProps}
        aria-label="Command palette"
        onKeyDown={onKeyDown}
        className="relative w-full max-w-lg mx-4 bg-neutral-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5">
          <Command size={16} className="text-neutral-500 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-list"
            aria-activedescendant={results[active] ? `cmd-${results[active].id}` : undefined}
            aria-label="Search commands"
            placeholder="Type a command…"
            value={query}
            onChange={e => { setQuery(e.target.value); setCursor(0); }}
            className="flex-1 bg-transparent text-sm text-neutral-100 placeholder:text-neutral-600 focus:outline-none"
          />
          <kbd className="text-[10px] font-mono text-neutral-600 border border-white/10 rounded px-1.5 py-0.5">ESC</kbd>
        </div>

        <ul id="command-palette-list" ref={listRef} role="listbox" aria-label="Commands" className="max-h-80 overflow-y-auto py-2">
          {results.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-neutral-500">No matching command</li>
          )}
          {results.map((a, i) => (
            <li key={a.id} id={`cmd-${a.id}`} role="option" aria-selected={i === active}>
              <button
                onClick={() => choose(a)}
                onMouseEnter={() => setCursor(i)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                  i === active ? 'bg-white/10 text-white' : 'text-neutral-300 hover:bg-white/5'
                }`}
              >
                <span className="text-neutral-500">{a.icon}</span>
                <span className="flex-1">{a.label}</span>
                {a.hint && (
                  <kbd className="text-[10px] font-mono text-neutral-500 border border-white/10 rounded px-1.5 py-0.5">
                    {a.hint}
                  </kbd>
                )}
                {i === active && <CornerDownLeft size={13} className="text-neutral-500" />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
