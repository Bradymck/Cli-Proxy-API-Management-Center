import type { QuotaProviderType } from './providers/types';

/** tab 顺序 = 旧页五分区的纵向顺序，'全部' tab 下卡片也按此分组排列。 */
export const QUOTA_TAB_ORDER: readonly QuotaProviderType[] = [
  'claude',
  'antigravity',
  'codex',
  'xai',
  'kimi',
  'devin',
  'meta',
  'plugin',
];

export type QuotaTabId = 'all' | QuotaProviderType;

/** 页级分页固定 20/页，同时把「刷新全部」的上游并发限制在 20。 */
export const QUOTA_PAGE_SIZE = 20;

/** 卡片排序：默认 = provider 分组序；soonest = 最快恢复优先。 */
export const QUOTA_SORT_MODES = ['default', 'soonest'] as const;

export type QuotaSortMode = (typeof QUOTA_SORT_MODES)[number];

/** Card layout (Even rows / Stacked / Compact), kept in localStorage across sessions. */
export const QUOTA_CARD_LAYOUT_KEY = 'quotaPage.cardLayout';

/** Quota page view: the ledger (default) or one of the shared card layouts. */
export const QUOTA_VIEWS = ['ledger', 'even', 'stacked', 'compact'] as const;
export type QuotaView = (typeof QUOTA_VIEWS)[number];
export const DEFAULT_QUOTA_VIEW: QuotaView = 'ledger';
export const QUOTA_VIEW_KEY = 'quotaPage.view';

export const isQuotaView = (value: unknown): value is QuotaView =>
  typeof value === 'string' && (QUOTA_VIEWS as readonly string[]).includes(value);

export const readQuotaView = (): QuotaView => {
  if (typeof window === 'undefined') return DEFAULT_QUOTA_VIEW;
  try {
    const stored = window.localStorage.getItem(QUOTA_VIEW_KEY);
    return isQuotaView(stored) ? stored : DEFAULT_QUOTA_VIEW;
  } catch {
    return DEFAULT_QUOTA_VIEW;
  }
};

export const writeQuotaView = (view: QuotaView) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(QUOTA_VIEW_KEY, view);
  } catch {
    // ignore
  }
};

/** Column minimums and gaps for the Stacked and Compact layouts; Even rows uses `.grid`. */
export const QUOTA_STACKED_COLUMNS = { minColumnWidth: 340, gap: 16 } as const;
export const QUOTA_COMPACT_COLUMNS = { minColumnWidth: 260, gap: 10 } as const;

/** 与 useRevealGroup 的 GROUP_MAX_TOTAL 一致：卡片级联总预算 360ms。 */
export const CARD_ENTRANCE_BUDGET_MS = 360;
