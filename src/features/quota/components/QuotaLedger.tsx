/**
 * Ledger view of quota: one summary card per provider, then one row per credential
 * with three limit columns. Data comes from the same quota store as the card views.
 */

import { useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { IconRefreshCw } from '@/components/ui/icons';
import type { ResolvedTheme } from '@/types';
import { resolveQuotaErrorMessage } from '@/utils/quota';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { formatInstantShort, formatRelativeInstant } from '@/utils/quota/relativeTime';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
} from '@/features/authFiles/constants';
import { QUOTA_ADAPTERS, type QuotaCardState } from '../providers';
import type { QuotaFileEntry } from '../logic';
import {
  buildLedgerColumns,
  buildLedgerSummary,
  extractLedgerPlan,
  ledgerLevel,
  maskCredentialName,
  type LedgerColumns,
  type LedgerSummary,
  type LedgerWindow,
} from '../ledger';
import { QUOTA_TAB_ORDER } from '../constants';
import type { QuotaProviderType } from '../providers/types';
import styles from './QuotaLedger.module.scss';

const windowLabel = (t: TFunction, window: LedgerWindow | null, fallbackKey: string): string => {
  if (!window) return t(fallbackKey);
  if (window.labelKey) return t(window.labelKey, window.labelParams);
  return window.label || t(fallbackKey);
};

const levelClass = (remaining: number | null): string => {
  const level = ledgerLevel(remaining);
  if (level === 'high') return styles.high;
  if (level === 'medium') return styles.medium;
  if (level === 'low') return styles.low;
  return styles.unknown;
};

export interface QuotaLedgerProps {
  /** Rows to show on this page, already ordered by the page. */
  entries: QuotaFileEntry[];
  /** Everything the summary cards roll up (the active tab, before paging). */
  summaryEntries: QuotaFileEntry[];
  nextUpKeys: ReadonlySet<string>;
  getQuota: (entry: QuotaFileEntry) => QuotaCardState | undefined;
  keyOf: (entry: QuotaFileEntry) => string;
  resolvedTheme: ResolvedTheme;
  showEmails: boolean;
  nowMs: number;
  canRefresh: boolean;
  resettingName: string | null;
  onRefresh: (entry: QuotaFileEntry) => void;
}

function ProviderIcon({
  type,
  theme,
  label,
}: {
  type: string;
  theme: ResolvedTheme;
  label: string;
}) {
  const src = getAuthFileIcon(type, theme);
  return (
    <span
      className={styles.providerIcon}
      title={label}
      style={
        isThemeSurfaceIconProvider(type)
          ? { background: getThemeSurfaceIconBackground(theme) }
          : undefined
      }
    >
      {src ? (
        <img src={src} alt="" />
      ) : (
        <span className={styles.providerIconFallback}>{label.slice(0, 1).toUpperCase()}</span>
      )}
    </span>
  );
}

function SegmentedBar({
  segments,
  muted = false,
}: {
  segments: { key: string; remaining: number | null }[];
  muted?: boolean;
}) {
  return (
    <div className={`${styles.segments} ${muted ? styles.segmentsMuted : ''}`} aria-hidden="true">
      {segments.map((segment) => (
        <span
          key={segment.key}
          className={`${styles.segment} ${segment.remaining === null ? '' : levelClass(segment.remaining)}`}
        />
      ))}
    </div>
  );
}

function resetText(t: TFunction, atMs: number | null, nowMs: number, locale?: string): string {
  if (atMs === null || atMs <= nowMs) return t('quota_management.ledger_no_reset');
  return `${formatRelativeInstant(atMs, nowMs, locale)} · ${formatInstantShort(atMs)}`;
}

function SummaryCard({
  summary,
  resolvedTheme,
  nowMs,
}: {
  summary: LedgerSummary;
  resolvedTheme: ResolvedTheme;
  nowMs: number;
}) {
  const { t, i18n } = useTranslation();
  const [showExtra, setShowExtra] = useState(false);
  const label = getTypeLabel(t, summary.type);
  const empty = summary.primaryTotal === null;
  const single = summary.credentialCount === 1;
  const total = empty
    ? '--'
    : single
      ? t('quota_management.ledger_percent_left', {
          percent: Math.round(summary.primaryAvgPercent ?? 0),
        })
      : t('quota_management.ledger_accounts_left', {
          left: (summary.primaryAccountsLeft ?? 0).toFixed(1),
          total: summary.credentialCount,
        });
  const extraText =
    summary.tertiaryAccountsLeft === null
      ? ''
      : single
        ? t('quota_management.ledger_percent_left', {
            percent: Math.round(summary.tertiaryAvgPercent ?? 0),
          })
        : t('quota_management.ledger_accounts_left_short', {
            left: summary.tertiaryAccountsLeft.toFixed(1),
            total: summary.credentialCount,
          });
  const hasExtra = summary.tertiaryTotal !== null && summary.tertiaryLabel !== null;

  return (
    <article className={styles.summaryCard}>
      <header className={styles.summaryHead}>
        <ProviderIcon type={summary.type} theme={resolvedTheme} label={label} />
        <span className={styles.summaryName}>{label}</span>
        <span className={styles.summaryCount}>
          {t('quota_management.ledger_credentials', { count: summary.credentialCount })}
        </span>
      </header>
      <div className={styles.summaryWindow}>
        {windowLabel(t, summary.primaryLabel, 'quota_management.ledger_primary_default')}
      </div>
      <div className={styles.summaryTotal}>
        <span className={styles.summaryTotalValue}>{total}</span>
        {!empty && !single && (
          <span className={styles.summaryTotalMax}>
            {t('quota_management.ledger_avg_percent', {
              percent: Math.round(summary.primaryAvgPercent ?? 0),
            })}
          </span>
        )}
      </div>
      <SegmentedBar segments={summary.segments} />
      <div className={styles.summaryReset}>
        {resetText(t, summary.soonestResetMs, nowMs, i18n.resolvedLanguage)}
      </div>
      {hasExtra && (
        <div className={styles.summaryExtra}>
          <div className={styles.summaryExtraRow}>
            <span className={styles.summaryExtraLabel}>
              {windowLabel(t, summary.tertiaryLabel, 'quota_management.ledger_primary_default')}
            </span>
            <span className={styles.summaryExtraValue}>
              {extraText}
              {!single && summary.tertiaryAvgPercent !== null && (
                <span className={styles.summaryTotalMax}>
                  {' · '}
                  {t('quota_management.ledger_avg_percent', {
                    percent: Math.round(summary.tertiaryAvgPercent),
                  })}
                </span>
              )}
            </span>
            <button
              type="button"
              className={styles.summaryExtraToggle}
              aria-expanded={showExtra}
              onClick={() => setShowExtra((value) => !value)}
            >
              {t(showExtra ? 'quota_management.ledger_hide' : 'quota_management.ledger_show')}
            </button>
          </div>
          {showExtra && <SegmentedBar segments={summary.tertiarySegments} muted />}
        </div>
      )}
    </article>
  );
}

function Column({
  window,
  muted,
  nowMs,
  fallbackLabelKey,
}: {
  window: LedgerWindow | null;
  muted?: boolean;
  nowMs: number;
  fallbackLabelKey: string;
}) {
  const { t, i18n } = useTranslation();
  if (!window) return <div className={styles.column} aria-hidden="true" />;
  const remaining = window.remainingPercent;
  const percent = remaining === null ? '--' : `${Math.round(remaining)}%`;
  return (
    <div className={`${styles.column} ${muted ? styles.columnMuted : ''}`}>
      <div className={styles.columnHead}>
        <span className={styles.columnLabel}>{windowLabel(t, window, fallbackLabelKey)}</span>
        <span className={styles.columnPercent}>{percent}</span>
      </div>
      <div className={styles.bar}>
        <div
          className={`${styles.barFill} ${levelClass(remaining)}`}
          style={{ width: `${remaining ?? 0}%` } as CSSProperties}
        />
      </div>
      <div className={styles.columnReset}>
        {window.resetAtMs !== null && window.resetAtMs > nowMs
          ? resetText(t, window.resetAtMs, nowMs, i18n.resolvedLanguage)
          : window.resetLabel && window.resetLabel !== '-'
            ? window.resetLabel
            : t('quota_management.ledger_no_reset')}
      </div>
    </div>
  );
}

function LedgerRow({
  entry,
  quota,
  columns,
  nextUp,
  showEmails,
  nowMs,
  canRefresh,
  resetting,
  onRefresh,
}: {
  entry: QuotaFileEntry;
  quota: QuotaCardState | undefined;
  columns: LedgerColumns;
  nextUp: boolean;
  showEmails: boolean;
  nowMs: number;
  canRefresh: boolean;
  resetting: boolean;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const adapter = QUOTA_ADAPTERS[entry.type];
  const status = quota?.status ?? 'idle';
  const loading = status === 'loading';
  const name = showEmails ? entry.file.name : maskCredentialName(entry.file.name);
  const plan = extractLedgerPlan(entry.type, quota);
  const planText = plan?.key ? t(plan.key, { defaultValue: plan.text ?? '' }) : (plan?.text ?? '');
  const hasColumns = status === 'success' && columns.primary !== null;

  return (
    <div className={styles.row} data-next-up={nextUp ? '' : undefined}>
      <div className={styles.identity}>
        <div className={styles.nameLine}>
          <span className={styles.fileName} title={name}>
            {name}
          </span>
          {nextUp && (
            <span className={styles.nextUp} title={t('quota_management.ledger_next_up_hint')}>
              {t('quota_management.ledger_next_up')}
            </span>
          )}
        </div>
        {planText && <span className={styles.plan}>{planText}</span>}
      </div>

      {status === 'idle' ? (
        <button
          type="button"
          className={styles.stateSpan}
          onClick={onRefresh}
          disabled={!canRefresh}
        >
          <IconRefreshCw size={13} aria-hidden="true" />
          {t(`${adapter.i18nPrefix}.idle`)}
        </button>
      ) : loading && !hasColumns ? (
        <div className={styles.stateSpan} aria-busy="true">
          {t(`${adapter.i18nPrefix}.loading`)}
        </div>
      ) : status === 'error' ? (
        <div className={`${styles.stateSpan} ${styles.stateError}`} role="alert">
          {t(`${adapter.i18nPrefix}.load_failed`, {
            message: resolveQuotaErrorMessage(
              t,
              quota?.errorStatus,
              quota?.error || t('common.unknown_error')
            ),
          })}
        </div>
      ) : hasColumns ? (
        <>
          <Column
            window={columns.primary}
            nowMs={nowMs}
            fallbackLabelKey="quota_management.ledger_primary_default"
          />
          <Column
            window={columns.secondary}
            nowMs={nowMs}
            fallbackLabelKey="quota_management.ledger_primary_default"
          />
          <Column
            window={columns.tertiary}
            muted
            nowMs={nowMs}
            fallbackLabelKey="quota_management.ledger_primary_default"
          />
        </>
      ) : (
        <div className={styles.stateSpan}>{t(`${adapter.i18nPrefix}.empty_windows`, '')}</div>
      )}

      <div className={styles.actions}>
        {status !== 'idle' && (
          <button
            type="button"
            className={styles.refresh}
            onClick={onRefresh}
            disabled={!canRefresh || loading || resetting}
            title={t('auth_files.quota_refresh_hint')}
          >
            <IconRefreshCw size={13} className={loading ? styles.spinning : undefined} />
            {t('auth_files.quota_refresh_single')}
          </button>
        )}
      </div>
    </div>
  );
}

export function QuotaLedger(props: QuotaLedgerProps) {
  const {
    entries,
    summaryEntries,
    nextUpKeys,
    getQuota,
    keyOf,
    resolvedTheme,
    showEmails,
    nowMs,
    canRefresh,
    resettingName,
    onRefresh,
  } = props;
  const { t } = useTranslation();

  const summaries = QUOTA_TAB_ORDER.map((type) => {
    const group = summaryEntries.filter((entry) => entry.type === type);
    if (group.length === 0) return null;
    return buildLedgerSummary(
      type,
      group.map((entry) => ({
        key: keyOf(entry),
        columns: buildLedgerColumns(type, getQuota(entry)),
      })),
      nowMs
    );
  }).filter((summary): summary is LedgerSummary => summary !== null);

  const groups = QUOTA_TAB_ORDER.map((type: QuotaProviderType) => ({
    type,
    items: entries.filter((entry) => entry.type === type),
  })).filter((group) => group.items.length > 0);

  return (
    <div className={styles.ledger}>
      {summaries.length > 0 && (
        <section
          className={styles.summaryRow}
          aria-label={t('quota_management.ledger_summary_label')}
        >
          {summaries.map((summary) => (
            <SummaryCard
              key={summary.type}
              summary={summary}
              resolvedTheme={resolvedTheme}
              nowMs={nowMs}
            />
          ))}
        </section>
      )}

      {groups.map((group) => (
        <section key={group.type} className={styles.group}>
          <h2 className={styles.groupTitle}>
            {getTypeLabel(t, group.type)}
            <span className={styles.groupCount}>
              {summaryEntries.filter((entry) => entry.type === group.type).length}
            </span>
          </h2>
          <div className={styles.rows}>
            {group.items.map((entry) => {
              const key = keyOf(entry);
              const quota = getQuota(entry);
              return (
                <LedgerRow
                  key={key}
                  entry={entry}
                  quota={quota}
                  columns={buildLedgerColumns(entry.type, quota)}
                  nextUp={nextUpKeys.has(key)}
                  showEmails={showEmails}
                  nowMs={nowMs}
                  canRefresh={canRefresh && !entry.file.disabled}
                  resetting={resettingName === getQuotaCacheKey(entry.file)}
                  onRefresh={() => onRefresh(entry)}
                />
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
