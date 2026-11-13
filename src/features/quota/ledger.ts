/**
 * Ledger view model: one row per credential, up to three limit columns, plus
 * per-provider roll-ups. React-free so tests can consume it directly.
 */

import type { QuotaFileEntry } from './logic';
import { QUOTA_TAB_ORDER } from './constants';
import type { QuotaProviderType } from './providers/types';

export interface LedgerWindow {
  id: string;
  label?: string;
  labelKey?: string;
  labelParams?: Record<string, string | number>;
  /** Remaining capacity, 0-100; null when unknown. */
  remainingPercent: number | null;
  resetAtMs: number | null;
  resetLabel?: string;
  periodHours?: number | null;
}

export interface LedgerColumns {
  /** Column 1, and the window that drives sorting and the provider roll-up. */
  primary: LedgerWindow | null;
  secondary: LedgerWindow | null;
  /** Less important bucket; rendered greyed out. */
  tertiary: LedgerWindow | null;
}

export type LedgerLevel = 'high' | 'medium' | 'low' | 'unknown';

export const LEDGER_HIGH_THRESHOLD = 70;
export const LEDGER_MEDIUM_THRESHOLD = 30;

const clampPercent = (value: number): number => Math.max(0, Math.min(100, value));

const fromUsed = (used: unknown): number | null =>
  typeof used === 'number' && Number.isFinite(used) ? clampPercent(100 - clampPercent(used)) : null;

const finiteMs = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export const ledgerLevel = (remaining: number | null): LedgerLevel => {
  if (remaining === null) return 'unknown';
  if (remaining >= LEDGER_HIGH_THRESHOLD) return 'high';
  if (remaining >= LEDGER_MEDIUM_THRESHOLD) return 'medium';
  return 'low';
};

interface WindowRowLike {
  id: string;
  label?: string;
  labelKey?: string;
  labelParams?: Record<string, string | number>;
  usedPercent?: number | null;
  remainingPercent?: number | null;
  resetLabel?: string;
  resetAtMs?: number | null;
  periodHours?: number | null;
}

const fromWindowRow = (row: WindowRowLike): LedgerWindow => ({
  id: row.id,
  label: row.label,
  labelKey: row.labelKey,
  labelParams: row.labelParams,
  remainingPercent:
    row.remainingPercent !== undefined && row.remainingPercent !== null
      ? clampPercent(row.remainingPercent)
      : fromUsed(row.usedPercent),
  resetAtMs: finiteMs(row.resetAtMs),
  resetLabel: row.resetLabel,
  periodHours: row.periodHours ?? null,
});

const MODEL_SEVEN_DAY_IDS = ['seven-day-fable', 'seven-day-opus', 'seven-day-sonnet'];

/** Claude: model-specific 7-day, 5-hour, then the plain 7-day (the greyed bucket). */
const claudeColumns = (windows: LedgerWindow[]): LedgerColumns => {
  const byId = (id: string) => windows.find((window) => window.id === id) ?? null;
  const model = MODEL_SEVEN_DAY_IDS.map(byId).find((window) => window !== null) ?? null;
  const sevenDay = byId('seven-day');
  const fiveHour = byId('five-hour');
  if (model) return { primary: model, secondary: fiveHour, tertiary: sevenDay };
  return { primary: sevenDay, secondary: fiveHour, tertiary: null };
};

/** Generic: the longest window leads (it is what gates sustained use), then the rest. */
const genericColumns = (windows: LedgerWindow[]): LedgerColumns => {
  if (windows.length === 0) return { primary: null, secondary: null, tertiary: null };
  const longestIndex = windows.reduce(
    (best, window, index) =>
      (window.periodHours ?? 0) > (windows[best].periodHours ?? 0) ? index : best,
    0
  );
  const rest = windows.filter((_, index) => index !== longestIndex);
  return { primary: windows[longestIndex], secondary: rest[0] ?? null, tertiary: rest[1] ?? null };
};

/** Flatten a provider's cached quota state into ledger windows. Structural reads only. */
export function extractLedgerWindows(type: QuotaProviderType, quota: unknown): LedgerWindow[] {
  const state = quota as { status?: string } | undefined;
  if (!state || state.status !== 'success') return [];

  switch (type) {
    case 'claude':
    case 'codex':
      return ((quota as { windows?: WindowRowLike[] }).windows ?? []).map(fromWindowRow);
    case 'devin':
      return ((quota as { windows?: WindowRowLike[] }).windows ?? []).map((window) =>
        fromWindowRow({ ...window, label: window.label ?? window.id })
      );
    case 'kimi':
      return (
        (
          quota as {
            rows?: (WindowRowLike & { used: number; limit: number; resetHint?: string })[];
          }
        ).rows ?? []
      ).map((row) =>
        fromWindowRow({
          ...row,
          resetLabel: row.resetHint,
          usedPercent: row.limit > 0 ? (row.used / row.limit) * 100 : null,
        })
      );
    case 'meta':
      return (
        (
          quota as {
            data?: {
              windows?: {
                id: string;
                usedPercent: number | null;
                resetAt?: number;
                durationMinutes?: number;
              }[];
            };
          }
        ).data?.windows ?? []
      ).map((window) =>
        fromWindowRow({
          id: window.id,
          label: window.id,
          usedPercent: window.usedPercent,
          resetAtMs: typeof window.resetAt === 'number' ? window.resetAt * 1000 : null,
          periodHours: window.durationMinutes ? window.durationMinutes / 60 : null,
        })
      );
    case 'xai': {
      const billing = (
        quota as {
          billing?: {
            periodType?: string;
            usagePercent: number | null;
            resetAtMs?: number | null;
          } | null;
        }
      ).billing;
      if (!billing) return [];
      return [
        fromWindowRow({
          id: 'xai:weekly',
          labelKey:
            billing.periodType === 'monthly'
              ? 'quota_management.ledger_monthly_limit'
              : 'quota_management.ledger_weekly_limit',
          usedPercent: billing.usagePercent,
          resetAtMs: billing.resetAtMs,
          periodHours: billing.periodType === 'monthly' ? 720 : 168,
        }),
      ];
    }
    case 'antigravity':
    case 'plugin':
      return (
        (quota as { groups?: { buckets?: Record<string, unknown>[] }[] }).groups ?? []
      ).flatMap((group) =>
        (group.buckets ?? []).map((bucket) => {
          const fraction = bucket.remainingFraction;
          return fromWindowRow({
            id: String(bucket.id),
            label: String(bucket.label ?? bucket.id),
            remainingPercent:
              typeof fraction === 'number' && Number.isFinite(fraction) ? fraction * 100 : null,
            resetAtMs: finiteMs(bucket.resetAtMs),
            resetLabel: typeof bucket.resetTime === 'string' ? bucket.resetTime : undefined,
            periodHours: finiteMs(bucket.periodHours),
          });
        })
      );
    default:
      return [];
  }
}

export function buildLedgerColumns(type: QuotaProviderType, quota: unknown): LedgerColumns {
  const windows = extractLedgerWindows(type, quota);
  return type === 'claude' ? claudeColumns(windows) : genericColumns(windows);
}

/** Raw plan identity; the view localizes it. `key` is an i18n key, `text` a literal. */
export function extractLedgerPlan(
  type: QuotaProviderType,
  quota: unknown
): { key?: string; text?: string } | null {
  const state = quota as Record<string, unknown> | undefined;
  if (!state || state.status !== 'success') return null;
  const str = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
  switch (type) {
    case 'claude': {
      const plan = str(state.planType);
      return plan ? { key: `claude_quota.${plan}` } : null;
    }
    case 'codex': {
      const plan = str(state.planType);
      return plan ? { key: `codex_quota.plan_${plan}`, text: plan } : null;
    }
    case 'kimi': {
      const plan = str(state.planName);
      return plan ? { text: plan } : null;
    }
    case 'devin': {
      const plan = str(state.plan);
      return plan ? { text: plan } : null;
    }
    case 'meta': {
      const plan = str((state.data as { planName?: unknown } | undefined)?.planName);
      return plan ? { text: plan } : null;
    }
    case 'xai': {
      const plan = str((state.billing as { planLabel?: unknown } | null | undefined)?.planLabel);
      return plan ? { text: plan } : null;
    }
    case 'antigravity': {
      const sub = state.subscription as { plan?: unknown; tierName?: unknown } | null | undefined;
      const plan = str(sub?.tierName) ?? str(sub?.plan);
      return plan ? { text: plan } : null;
    }
    default:
      return null;
  }
}

/**
 * claude-trevor@example.dev.json -> claude-t•••@e•••.dev.json
 * Names without an "@" carry no email, so they are returned unchanged.
 */
export function maskCredentialName(name: string): string {
  const at = name.indexOf('@');
  if (at < 0) return name;
  let start = at;
  while (start > 0 && !/[-_\s]/.test(name[start - 1])) start -= 1;
  const prefix = name.slice(0, start);
  const local = name.slice(start, at);
  const domain = name.slice(at + 1);
  const dot = domain.indexOf('.');
  const host = dot >= 0 ? domain.slice(0, dot) : domain;
  const tail = dot >= 0 ? domain.slice(dot) : '';
  const localHead = local ? `${local[0]}•••` : '•••';
  const hostHead = host ? `${host[0]}•••` : '•••';
  return `${prefix}${localHead}@${hostHead}${tail}`;
}

export interface LedgerSortable {
  index: number;
  resetAtMs: number | null;
}

/** Soonest reset first; accounts without a pending reset sink, keeping incoming order. */
export function compareByReset(a: LedgerSortable, b: LedgerSortable, nowMs: number): number {
  const aMs = a.resetAtMs !== null && a.resetAtMs > nowMs ? a.resetAtMs : null;
  const bMs = b.resetAtMs !== null && b.resetAtMs > nowMs ? b.resetAtMs : null;
  if (aMs === null && bMs === null) return a.index - b.index;
  if (aMs === null) return 1;
  if (bMs === null) return -1;
  return aMs - bMs || a.index - b.index;
}

/**
 * Group by provider (QUOTA_TAB_ORDER) and, within each group, put the credential whose
 * primary window resets soonest first.
 */
export function sortLedgerEntries(
  entries: QuotaFileEntry[],
  resolvePrimaryResetMs: (entry: QuotaFileEntry) => number | null,
  nowMs: number
): QuotaFileEntry[] {
  const decorated = entries.map((entry, index) => ({
    entry,
    index,
    resetAtMs: resolvePrimaryResetMs(entry),
  }));
  return QUOTA_TAB_ORDER.flatMap((type) =>
    decorated
      .filter((item) => item.entry.type === type)
      .sort((a, b) => compareByReset(a, b, nowMs))
      .map((item) => item.entry)
  );
}

/**
 * Per provider, the credential the server will route to first: soonest pending primary
 * reset among credentials that still have capacity. Needs two candidates to be worth a badge.
 */
export function pickNextUpKeys(
  entries: QuotaFileEntry[],
  keyOf: (entry: QuotaFileEntry) => string,
  columnsOf: (entry: QuotaFileEntry) => LedgerColumns,
  nowMs: number
): Set<string> {
  const winners = new Set<string>();
  for (const type of QUOTA_TAB_ORDER) {
    const candidates = entries
      .filter((entry) => entry.type === type)
      .map((entry, index) => {
        const primary = columnsOf(entry).primary;
        return {
          key: keyOf(entry),
          index,
          resetAtMs: primary?.resetAtMs ?? null,
          usable: primary !== null && (primary.remainingPercent ?? 0) > 0,
        };
      })
      .filter((item) => item.usable && item.resetAtMs !== null && item.resetAtMs > nowMs);
    if (candidates.length < 2) continue;
    candidates.sort((a, b) => compareByReset(a, b, nowMs));
    winners.add(candidates[0].key);
  }
  return winners;
}

export interface LedgerSummary {
  type: QuotaProviderType;
  credentialCount: number;
  loadedCount: number;
  primaryLabel: LedgerWindow | null;
  /** Sum of remaining percent across loaded credentials; null when nothing is loaded. */
  primaryTotal: number | null;
  primaryMax: number;
  tertiaryTotal: number | null;
  tertiaryLabel: LedgerWindow | null;
  /** One segment per credential, in ledger order. */
  segments: { key: string; remaining: number | null }[];
  tertiarySegments: { key: string; remaining: number | null }[];
  soonestResetMs: number | null;
}

export function buildLedgerSummary(
  type: QuotaProviderType,
  items: { key: string; columns: LedgerColumns }[],
  nowMs: number
): LedgerSummary {
  const loaded = items.filter((item) => item.columns.primary !== null);
  const tertiaryLoaded = items.filter((item) => item.columns.tertiary !== null);
  const sum = (values: (number | null)[]) =>
    values.reduce<number>((total, value) => total + (value ?? 0), 0);
  const upcoming = loaded
    .map((item) => item.columns.primary?.resetAtMs ?? null)
    .filter((ms): ms is number => ms !== null && ms > nowMs);
  return {
    type,
    credentialCount: items.length,
    loadedCount: loaded.length,
    primaryLabel: loaded[0]?.columns.primary ?? null,
    primaryTotal:
      loaded.length > 0
        ? sum(loaded.map((item) => item.columns.primary?.remainingPercent ?? null))
        : null,
    primaryMax: items.length * 100,
    tertiaryTotal:
      tertiaryLoaded.length > 0
        ? sum(tertiaryLoaded.map((item) => item.columns.tertiary?.remainingPercent ?? null))
        : null,
    tertiaryLabel: tertiaryLoaded[0]?.columns.tertiary ?? null,
    segments: items.map((item) => ({
      key: item.key,
      remaining: item.columns.primary?.remainingPercent ?? null,
    })),
    tertiarySegments: items.map((item) => ({
      key: item.key,
      remaining: item.columns.tertiary?.remainingPercent ?? null,
    })),
    soonestResetMs: upcoming.length > 0 ? Math.min(...upcoming) : null,
  };
}
