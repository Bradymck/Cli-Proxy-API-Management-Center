import { describe, expect, test } from 'bun:test';
import {
  buildLedgerColumns,
  buildLedgerSummary,
  extractLedgerPlan,
  maskCredentialName,
  pickNextUpKeys,
  sortLedgerEntries,
} from '@/features/quota/ledger';
import type { QuotaFileEntry } from '@/features/quota/logic';

const NOW = 1_000_000;
const DAY = 86_400_000;

const claude = (opts: {
  model?: [number, number];
  five?: [number, number];
  seven?: [number, number];
  plan?: string;
}) => ({
  status: 'success',
  planType: opts.plan ?? 'plan_max',
  windows: [
    opts.model && {
      id: 'seven-day-fable',
      label: 'Fable',
      usedPercent: 100 - opts.model[0],
      resetAtMs: opts.model[1],
    },
    opts.five && {
      id: 'five-hour',
      label: '5h',
      usedPercent: 100 - opts.five[0],
      resetAtMs: opts.five[1],
    },
    opts.seven && {
      id: 'seven-day',
      label: '7d',
      usedPercent: 100 - opts.seven[0],
      resetAtMs: opts.seven[1],
    },
  ].filter(Boolean),
});

const entry = (name: string, type: QuotaFileEntry['type'] = 'claude'): QuotaFileEntry =>
  ({ file: { name }, type }) as QuotaFileEntry;

describe('maskCredentialName', () => {
  test('masks local part and host, keeps prefix and suffix', () => {
    expect(maskCredentialName('claude-trevor@example.dev.json')).toBe('claude-t•••@e•••.dev.json');
  });
  test('leaves names without an email alone', () => {
    expect(maskCredentialName('codex-account-1.json')).toBe('codex-account-1.json');
  });
});

describe('buildLedgerColumns', () => {
  test('claude: model 7-day, 5-hour, then plain 7-day as the grey bucket', () => {
    const cols = buildLedgerColumns(
      'claude',
      claude({ model: [58, 5], five: [100, 6], seven: [79, 7] })
    );
    expect(cols.primary?.id).toBe('seven-day-fable');
    expect(cols.primary?.remainingPercent).toBe(58);
    expect(cols.secondary?.id).toBe('five-hour');
    expect(cols.tertiary?.id).toBe('seven-day');
  });
  test('claude without a model window falls back to the plain 7-day', () => {
    const cols = buildLedgerColumns('claude', claude({ five: [90, 6], seven: [79, 7] }));
    expect(cols.primary?.id).toBe('seven-day');
    expect(cols.tertiary).toBeNull();
  });
  test('idle state yields no columns', () => {
    expect(buildLedgerColumns('claude', { status: 'idle', windows: [] }).primary).toBeNull();
  });
  test('codex leads with the longest window', () => {
    const cols = buildLedgerColumns('codex', {
      status: 'success',
      windows: [
        { id: 'five-hour', label: '5h', usedPercent: 10, periodHours: 5 },
        { id: 'weekly', label: 'Weekly', usedPercent: 83, periodHours: 168 },
      ],
    });
    expect(cols.primary?.id).toBe('weekly');
    expect(cols.primary?.remainingPercent).toBe(17);
    expect(cols.secondary?.id).toBe('five-hour');
  });
});

describe('next up and ordering', () => {
  const a = entry('a');
  const b = entry('b');
  const c = entry('c');
  const quotas: Record<string, unknown> = {
    a: claude({ model: [100, NOW + 4 * DAY] }),
    b: claude({ model: [51, NOW + 1 * DAY] }),
    c: claude({ model: [58, NOW + 2 * DAY] }),
  };
  const columnsOf = (e: QuotaFileEntry) => buildLedgerColumns(e.type, quotas[e.file.name]);

  test('sorts the soonest 7-day reset first', () => {
    const sorted = sortLedgerEntries(
      [a, b, c],
      (e) => columnsOf(e).primary?.resetAtMs ?? null,
      NOW
    );
    expect(sorted.map((e) => e.file.name)).toEqual(['b', 'c', 'a']);
  });
  test('unloaded credentials sink and keep order', () => {
    const d = entry('d');
    const sorted = sortLedgerEntries(
      [d, a, b],
      (e) => columnsOf(e).primary?.resetAtMs ?? null,
      NOW
    );
    expect(sorted.map((e) => e.file.name)).toEqual(['b', 'a', 'd']);
  });
  test('marks only the soonest usable credential', () => {
    const keys = pickNextUpKeys([a, b, c], (e) => e.file.name, columnsOf, NOW);
    expect([...keys]).toEqual(['b']);
  });
  test('skips exhausted credentials and lone candidates', () => {
    quotas.b = claude({ model: [0, NOW + 1 * DAY] });
    expect([...pickNextUpKeys([a, b, c], (e) => e.file.name, columnsOf, NOW)]).toEqual(['c']);
    expect(pickNextUpKeys([a], (e) => e.file.name, columnsOf, NOW).size).toBe(0);
  });
});

describe('buildLedgerSummary', () => {
  test('sums remaining across accounts out of N x 100%', () => {
    const items = [
      { key: 'a', columns: buildLedgerColumns('claude', claude({ model: [58, NOW + DAY] })) },
      { key: 'b', columns: buildLedgerColumns('claude', claude({ model: [100, NOW + 4 * DAY] })) },
      { key: 'c', columns: buildLedgerColumns('claude', { status: 'idle', windows: [] }) },
    ];
    const summary = buildLedgerSummary('claude', items, NOW);
    expect(summary.primaryTotal).toBe(158);
    expect(summary.primaryMax).toBe(300);
    expect(summary.loadedCount).toBe(2);
    expect(summary.segments.map((s) => s.remaining)).toEqual([58, 100, null]);
    expect(summary.soonestResetMs).toBe(NOW + DAY);
  });
  test('nothing loaded renders as unknown', () => {
    const summary = buildLedgerSummary(
      'codex',
      [{ key: 'a', columns: buildLedgerColumns('codex', undefined) }],
      NOW
    );
    expect(summary.primaryTotal).toBeNull();
    expect(summary.soonestResetMs).toBeNull();
  });
});

describe('extractLedgerPlan', () => {
  test('claude plan resolves to an i18n key', () => {
    expect(extractLedgerPlan('claude', claude({ plan: 'plan_max' }))).toEqual({
      key: 'claude_quota.plan_max',
    });
  });
});
