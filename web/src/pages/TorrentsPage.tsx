import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ActionIcon, Badge, Box, Button, Checkbox, Group, Loader, Pagination, Paper,
  SegmentedControl, Select, Stack, Table, Text, Title, Tooltip, UnstyledButton,
} from '@mantine/core';
import { getAllTorrents, getMules, pauseTorrent, resumeTorrent, removeTorrent } from '../api/client';
import { TorrentRow } from '../components/TorrentRow';
import { DeleteTorrentModal } from '../components/DeleteTorrentModal';
import { SetupLadder } from '../components/SetupLadder';
import { needsSetup } from '../lib/setup';
import {
  filterTorrents, sortTorrents, nextSort, paginate, totalPages, statusCounts,
  torrentKey, PAGE_SIZE_OPTIONS, DEFAULT_PAGE_SIZE, categoriesOf,
  ALL_CATEGORIES, UNCATEGORISED, applyFrozenOrder,
  type FilterStatus, type SortKey, type SortState,
} from '../lib/torrentList';
import { useUiActions } from '../context/UiActionsContext';
import {
  Plus, Search, X, ArrowUp, ArrowDown, Pause, Play, Trash2, Tag, Rows2, Rows3,
} from 'lucide-react';
import { TextInput } from '@mantine/core';

const COLUMNS: { key: SortKey | null; label: string; align?: 'right' | 'center' }[] = [
  { key: 'name',     label: 'Name' },
  { key: 'status',   label: 'Status' },
  { key: 'progress', label: 'Progress' },
  { key: 'eta',      label: 'ETA',   align: 'right' },
  { key: 'speed',    label: 'Speed', align: 'right' },
  { key: 'peers',    label: 'Seeds / Peers', align: 'center' },
  { key: 'ratio',    label: 'Ratio', align: 'right' },
  { key: 'mule',     label: 'Mule' },
  { key: null,       label: 'Actions', align: 'right' },
];

const UNCAT_VALUE = '\u0000uncategorised';

const DENSITY_KEY = 'smuggler.torrents.density';

export function TorrentsPage() {
  const qc = useQueryClient();
  const { openAddTorrent } = useUiActions();
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortState | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [category, setCategory] = useState<string>(ALL_CATEGORIES);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Persisted: density is a workspace preference, not a per-visit choice.
  const [dense, setDense] = useState(() => localStorage.getItem(DENSITY_KEY) === 'compact');
  const [confirmBulkRemove, setConfirmBulkRemove] = useState(false);

  const { data: torrents = [], isLoading } = useQuery({
    queryKey: ['torrents'],
    queryFn: getAllTorrents,
    refetchInterval: 2_000,
  });

  // Only to decide which empty state to show. Shares the cache key the rest of
  // the app already polls, so this adds no request.
  const { data: mules = [] } = useQuery({ queryKey: ['mules'], queryFn: getMules });
  const runningMules = mules.filter(m => m.status === 'running').length;

  const counts = useMemo(() => statusCounts(torrents), [torrents]);
  const ordered = useMemo(
    () => sortTorrents(filterTorrents(torrents, filter, search, category), sort),
    [torrents, filter, search, category, sort],
  );

  // ── Order freeze ────────────────────────────────────────────────────────────
  // While the user has a selection or an open detail panel, hold the row order
  // still. Data refetches every 2s, so sorting by speed or ETA otherwise slides
  // rows out from under the cursor between deciding to act and clicking.
  // Render-phase "previous value" pattern, as elsewhere in this codebase — an
  // effect would cost an extra render and show one frame of the moved order.
  const interacting = selected.size > 0 || expanded.size > 0;
  const [frozenKeys, setFrozenKeys] = useState<string[] | null>(null);
  const [prevInteracting, setPrevInteracting] = useState(interacting);
  if (interacting !== prevInteracting) {
    setPrevInteracting(interacting);
    setFrozenKeys(interacting ? ordered.map(torrentKey) : null);
  }

  const visible = useMemo(
    () => applyFrozenOrder(ordered, frozenKeys),
    [ordered, frozenKeys],
  );
  const categories = useMemo(() => categoriesOf(torrents), [torrents]);
  const hasUncategorised = useMemo(
    () => torrents.some(x => !(x.category ?? '').trim()),
    [torrents],
  );
  const pageCount = totalPages(visible.length, pageSize);
  const rows = paginate(visible, page, pageSize);

  const resetPage = () => setPage(1);
  const handleFilterChange = (f: FilterStatus) => { setFilter(f); resetPage(); };
  const handleSearch = (q: string) => { setSearch(q); resetPage(); };
  const handleSort = (key: SortKey) => { setSort(s => nextSort(s, key)); resetPage(); };
  const handlePageSize = (n: number) => { setPageSize(n); resetPage(); };
  const handleCategory = (c: string) => { setCategory(c); resetPage(); };

  // ── Bulk selection ──────────────────────────────────────────────────────────
  // Selection is keyed by mule:gid and intersected with what is currently
  // visible, so a torrent that finishes and drops out of the filter cannot be
  // silently acted on by a later bulk operation.
  const selectedVisible = useMemo(
    () => visible.filter(t => selected.has(torrentKey(t))),
    [visible, selected],
  );
  const allPageSelected = rows.length > 0 && rows.every(t => selected.has(torrentKey(t)));

  const toggleOne = (key: string) =>
    setSelected(prev => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const togglePage = () =>
    setSelected(prev => {
      const next = new Set(prev);
      for (const t of rows) {
        const k = torrentKey(t);
        if (allPageSelected) next.delete(k); else next.add(k);
      }
      return next;
    });

  const clearSelection = () => setSelected(new Set());

  const toggleExpanded = (key: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  type BulkAction =
    | { kind: 'pause' }
    | { kind: 'resume' }
    | { kind: 'remove'; deleteFiles: boolean };

  const bulk = useMutation({
    mutationFn: async (action: BulkAction) => {
      const targets = selectedVisible;
      // Settled, not all: one failing torrent should not abandon the rest.
      await Promise.allSettled(
        targets.map(t => {
          if (action.kind === 'pause') return pauseTorrent(t.mule, t.gid);
          if (action.kind === 'resume') return resumeTorrent(t.mule, t.gid);
          return removeTorrent(t.mule, t.gid, action.deleteFiles);
        }),
      );
    },
    onSettled: () => {
      setConfirmBulkRemove(false);
      clearSelection();
      qc.invalidateQueries({ queryKey: ['torrents'] });
    },
  });

  const filters: FilterStatus[] = ['all', 'active', 'paused', 'complete', 'error'];

  // A narrowed-to-nothing view is a different problem from an empty system:
  // only the latter gets the setup path.
  const narrowed = !!search || category !== ALL_CATEGORIES || filter !== 'all';

  const narrowedMessage = (() => {
    if (search) return `No torrents match "${search}".`;
    if (category !== ALL_CATEGORIES) {
      return category !== UNCATEGORISED
        ? `No torrents in "${category}".`
        : 'No uncategorised torrents.';
    }
    return `No ${filter} torrents found.`;
  })();

  const categoryData = [
    { value: ALL_CATEGORIES, label: 'All categories' },
    ...categories.map(c => ({ value: c, label: c })),
    ...(hasUncategorised ? [{ value: UNCAT_VALUE, label: 'Uncategorised' }] : []),
  ];

  return (
    <Box p="lg">
      <Group justify="space-between" align="flex-start" mb="lg" gap="md">
        <div>
          <Title order={2}>Torrents</Title>
          <Text size="sm" c="dimmed" mt={2}>Manage active downloads across all routing mules.</Text>
        </div>
        <Button leftSection={<Plus size={16} strokeWidth={2.5} />} onClick={openAddTorrent}>
          Add Torrent
        </Button>
      </Group>

      <Stack gap="md">
        {/* Filters + search */}
        <Group gap="sm" align="center">
          <SegmentedControl
            value={filter}
            onChange={v => handleFilterChange(v as FilterStatus)}
            data={filters.map(f => ({
              value: f,
              label: (
                <Group gap={6} wrap="nowrap">
                  <Text size="sm" tt="capitalize" component="span">{f}</Text>
                  {counts[f] > 0 && <Badge size="xs" variant="default" circle={counts[f] < 10}>{counts[f]}</Badge>}
                </Group>
              ),
            }))}
          />

          {(categories.length > 0 || category !== ALL_CATEGORIES) && (
            <Select
              aria-label="Filter by category"
              leftSection={<Tag size={14} />}
              data={categoryData}
              value={category === UNCATEGORISED ? UNCAT_VALUE : category}
              onChange={v => handleCategory(v === UNCAT_VALUE ? UNCATEGORISED : (v ?? ALL_CATEGORIES))}
              w={200}
              ml="auto"
              comboboxProps={{ withinPortal: true }}
            />
          )}

          <TextInput
            type="search"
            aria-label="Search torrents by name or mule"
            placeholder="Search name or mule…"
            value={search}
            onChange={e => handleSearch(e.currentTarget.value)}
            leftSection={<Search size={15} />}
            rightSection={search ? (
              <ActionIcon variant="subtle" color="gray" size="sm" aria-label="Clear search" onClick={() => handleSearch('')}>
                <X size={14} />
              </ActionIcon>
            ) : null}
            w={{ base: '100%', md: 280 }}
            ml={categories.length > 0 || category !== ALL_CATEGORIES ? undefined : 'auto'}
          />
        </Group>

        {/* Bulk action bar — only present when something is selected */}
        {selectedVisible.length > 0 && (
          <Paper
            withBorder
            px="md"
            py="sm"
            radius="md"
            style={{
              background: 'var(--mantine-color-blue-light)',
              borderColor: 'var(--mantine-color-blue-light-color)',
            }}
          >
            <Group gap="sm">
              <Text size="sm" fw={600} c="var(--smg-info)">{selectedVisible.length} selected</Text>
              <Group gap="xs" ml="auto">
                <Button size="compact-xs" variant="default" leftSection={<Pause size={13} />}
                  onClick={() => bulk.mutate({ kind: 'pause' })} disabled={bulk.isPending}>
                  Pause
                </Button>
                <Button size="compact-xs" variant="default" leftSection={<Play size={13} />}
                  onClick={() => bulk.mutate({ kind: 'resume' })} disabled={bulk.isPending}>
                  Resume
                </Button>
                <Button size="compact-xs" variant="light" color="red" leftSection={<Trash2 size={13} />}
                  onClick={() => setConfirmBulkRemove(true)} disabled={bulk.isPending}
                  title="Remove the selected torrents">
                  Remove
                </Button>
                <Button size="compact-xs" variant="subtle" color="gray" onClick={clearSelection}>
                  Clear
                </Button>
              </Group>
            </Group>
          </Paper>
        )}

        {/* Table */}
        <Paper withBorder radius="lg" style={{ overflow: 'hidden' }}>
          <Table.ScrollContainer minWidth={960}>
            <Table verticalSpacing={dense ? 4 : 'sm'} highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={40} pl="md">
                    <Checkbox
                      size="xs"
                      aria-label="Select all torrents on this page"
                      checked={allPageSelected}
                      onChange={togglePage}
                      disabled={rows.length === 0}
                    />
                  </Table.Th>
                  {COLUMNS.map(col => {
                    const active = col.key && sort?.key === col.key;
                    let ariaSort: 'ascending' | 'descending' | 'none' = 'none';
                    if (active) ariaSort = sort?.direction === 'asc' ? 'ascending' : 'descending';
                    return (
                      <Table.Th
                        key={col.label}
                        ta={col.align}
                        aria-sort={ariaSort}
                        style={{ whiteSpace: 'nowrap' }}
                      >
                        {col.key ? (
                          <UnstyledButton
                            onClick={() => handleSort(col.key as SortKey)}
                            fz="xs"
                            fw={600}
                            tt="uppercase"
                            c={active ? undefined : 'dimmed'}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, letterSpacing: 1 }}
                          >
                            {col.label}
                            {active && (sort?.direction === 'asc'
                              ? <ArrowUp size={12} />
                              : <ArrowDown size={12} />)}
                          </UnstyledButton>
                        ) : (
                          <Text fz="xs" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: 1 }}>
                            {col.label}
                          </Text>
                        )}
                      </Table.Th>
                    );
                  })}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {isLoading && (
                  <Table.Tr>
                    <Table.Td colSpan={10} py="xl">
                      <Group justify="center" gap="sm">
                        <Loader size="xs" />
                        <Text size="sm" c="dimmed">Loading torrents...</Text>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                )}
                {!isLoading && visible.length === 0 && (
                  <Table.Tr>
                    <Table.Td colSpan={10} py={48}>
                      {(() => {
                        if (narrowed) {
                          return <Text ta="center" c="dimmed" fw={500}>{narrowedMessage}</Text>;
                        }
                        if (needsSetup(runningMules)) return <SetupLadder />;
                        return (
                          <Stack align="center" gap="md">
                            <Text ta="center" c="dimmed" fw={500}>
                              No torrents yet. Paste a magnet link, or drop a{' '}
                              <Text component="span" ff="monospace">.torrent</Text> anywhere in the window.
                            </Text>
                            <Button leftSection={<Plus size={16} strokeWidth={2.5} />} onClick={openAddTorrent}>
                              Add Torrent
                            </Button>
                          </Stack>
                        );
                      })()}
                    </Table.Td>
                  </Table.Tr>
                )}
                {!isLoading && rows.map(t => (
                  <TorrentRow
                    key={torrentKey(t)}
                    torrent={t}
                    selected={selected.has(torrentKey(t))}
                    onToggleSelected={() => toggleOne(torrentKey(t))}
                    expanded={expanded.has(torrentKey(t))}
                    onToggleExpanded={() => toggleExpanded(torrentKey(t))}
                  />
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>

          <Group
            justify="space-between"
            px="md"
            py="sm"
            style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}
          >
            <Group gap="sm">
              <Text size="xs" c="dimmed">
                {visible.length === 0
                  ? 'No torrents'
                  : `Showing ${(Math.min(page, pageCount) - 1) * pageSize + 1}–${Math.min(page * pageSize, visible.length)} of ${visible.length}`}
              </Text>
              <Tooltip label={dense ? 'Comfortable rows' : 'Compact rows'} withArrow>
                <ActionIcon
                  variant="default"
                  size="md"
                  aria-label={dense ? 'Switch to comfortable rows' : 'Switch to compact rows'}
                  aria-pressed={dense}
                  onClick={() => {
                    const next = !dense;
                    setDense(next);
                    localStorage.setItem(DENSITY_KEY, next ? 'compact' : 'comfortable');
                  }}
                >
                  {dense ? <Rows3 size={14} /> : <Rows2 size={14} />}
                </ActionIcon>
              </Tooltip>
              <Select
                aria-label="Torrents per page"
                size="xs"
                w={110}
                data={PAGE_SIZE_OPTIONS.map(n => ({ value: String(n), label: `${n} / page` }))}
                value={String(pageSize)}
                onChange={v => handlePageSize(Number(v ?? DEFAULT_PAGE_SIZE))}
                comboboxProps={{ withinPortal: true }}
              />
            </Group>

            {pageCount > 1 && (
              <Pagination
                size="xs"
                total={pageCount}
                value={Math.min(page, pageCount)}
                onChange={setPage}
              />
            )}
          </Group>
        </Paper>
      </Stack>

      <DeleteTorrentModal
        // Selection is intersected with visibility, so it can empty out from a
        // refetch while this is open — don't offer to remove nothing.
        isOpen={confirmBulkRemove && selectedVisible.length > 0}
        onClose={() => setConfirmBulkRemove(false)}
        onConfirm={deleteFiles => bulk.mutate({ kind: 'remove', deleteFiles })}
        isPending={bulk.isPending}
        torrentName={selectedVisible[0]?.name ?? ''}
        count={selectedVisible.length}
      />
    </Box>
  );
}
