import { useMemo, useRef, useState } from 'react';
import { Group, Kbd, Paper, Text } from '@mantine/core';
import { useModalA11y, modalA11yProps } from '../hooks/useModalA11y';
import { PAGES, PAGE_LABELS, type Page } from '../lib/router';
import { useTheme } from '../context/ThemeContext';
import { fuzzyMatch } from '../lib/fuzzy';
import { PageIcon } from './PageIcon';
import {
  Command, Plus, Rocket, Sun, Moon, Monitor, CornerDownLeft,
} from 'lucide-react';

/**
 * Ctrl/Cmd-K command palette.
 *
 * The DOM keeps the raw combobox/listbox structure (input + ul/li/button) so
 * the existing keyboard and screen-reader behaviour survives the restyle —
 * Mantine only provides the chrome around it.
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
      label: `Go to ${PAGE_LABELS[p]}`,
      icon: <PageIcon page={p} size={16} />,
      run: () => onNavigate(p),
    }));
    const themeIcon =
      preference === 'light' ? <Sun size={16} /> :
      preference === 'dark' ? <Moon size={16} /> : <Monitor size={16} />;
    return [
      { id: 'add-torrent', label: 'Add Torrent', hint: 'N', icon: <Plus size={16} />, run: onAddTorrent },
      { id: 'deploy-mule', label: 'Deploy Mule', icon: <Rocket size={16} />, run: onDeployMule },
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
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 300,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '15vh',
      }}
    >
      <button
        type="button"
        aria-label="Close command palette"
        onClick={onClose}
        style={{
          position: 'absolute', inset: 0, border: 0, padding: 0, cursor: 'default',
          background: 'rgba(0, 0, 0, 0.55)', backdropFilter: 'blur(2px)',
        }}
      />
      <Paper
        ref={dialogRef}
        {...modalA11yProps}
        aria-label="Command palette"
        onKeyDown={onKeyDown}
        withBorder
        shadow="xl"
        radius="lg"
        w="100%"
        maw={520}
        mx="md"
        style={{ position: 'relative', overflow: 'hidden' }}
      >
        <Group gap="sm" px="md" py="sm" wrap="nowrap" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
          <Command size={16} color="var(--mantine-color-dimmed)" style={{ flexShrink: 0 }} />
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
            style={{
              flex: 1, background: 'transparent', border: 0, outline: 'none',
              fontSize: 'var(--mantine-font-size-sm)', color: 'var(--mantine-color-text)',
              fontFamily: 'inherit',
            }}
          />
          <Kbd size="xs">ESC</Kbd>
        </Group>

        <ul
          id="command-palette-list"
          ref={listRef}
          role="listbox"
          aria-label="Commands"
          style={{ maxHeight: 320, overflowY: 'auto', padding: '8px 0', margin: 0, listStyle: 'none' }}
        >
          {results.length === 0 && (
            <li>
              <Text size="sm" c="dimmed" ta="center" py="lg">No matching command</Text>
            </li>
          )}
          {results.map((a, i) => (
            <li key={a.id} id={`cmd-${a.id}`} role="option" aria-selected={i === active}>
              <button
                onClick={() => choose(a)}
                onMouseEnter={() => setCursor(i)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 16px', textAlign: 'left', border: 0, cursor: 'pointer',
                  fontSize: 'var(--mantine-font-size-sm)', fontFamily: 'inherit',
                  background: i === active ? 'var(--mantine-color-default-hover)' : 'transparent',
                  color: 'var(--mantine-color-text)',
                }}
              >
                <span style={{ color: 'var(--mantine-color-dimmed)', display: 'flex' }}>{a.icon}</span>
                <span style={{ flex: 1 }}>{a.label}</span>
                {a.hint && <Kbd size="xs">{a.hint}</Kbd>}
                {i === active && <CornerDownLeft size={13} color="var(--mantine-color-dimmed)" />}
              </button>
            </li>
          ))}
        </ul>
      </Paper>
    </div>
  );
}
