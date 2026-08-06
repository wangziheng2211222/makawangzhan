'use client'

import type { CSSProperties, FormEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BarChart3,
  CalendarDays,
  Clock3,
  ExternalLink,
  Eye,
  KeyRound,
  LogOut,
  MousePointerClick,
  RefreshCw,
  Users,
} from 'lucide-react'

import type { AnalyticsStats } from '@/types/analytics'

import styles from './analytics.module.css'

const TOKEN_STORAGE_KEY = 'maka_analytics_admin_token'

type ViewState = 'loading' | 'ready' | 'unauthorized' | 'unconfigured' | 'error'

const numberFormatter = new Intl.NumberFormat('zh-CN')
const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

function formatDateTime(value: string) {
  return dateTimeFormatter.format(new Date(value))
}

function formatDay(value: string) {
  const [, month, day] = value.split('-')
  return `${month}/${day}`
}

function destinationHost(destination: string) {
  try {
    return new URL(destination).hostname.replace(/^www\./, '')
  } catch {
    return destination
  }
}

export function AnalyticsDashboard() {
  const [stats, setStats] = useState<AnalyticsStats | null>(null)
  const [viewState, setViewState] = useState<ViewState>('loading')
  const [token, setToken] = useState(() => (
    typeof window === 'undefined'
      ? ''
      : window.sessionStorage.getItem(TOKEN_STORAGE_KEY) ?? ''
  ))
  const [tokenInput, setTokenInput] = useState('')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const hasLoadedRef = useRef(false)

  const loadStats = useCallback(async (adminToken = '', background = false) => {
    if (background) setIsRefreshing(true)
    else setViewState('loading')

    try {
      const response = await fetch('/api/analytics/stats', {
        cache: 'no-store',
        headers: adminToken
          ? { authorization: `Bearer ${adminToken}` }
          : undefined,
      })

      if (response.status === 401) {
        setStats(null)
        setViewState('unauthorized')
        return
      }
      if (response.status === 503) {
        const errorBody = await response.json().catch(() => null) as { error?: string } | null
        setStats(null)
        setViewState(
          errorBody?.error === 'analytics_admin_token_not_configured'
            ? 'unconfigured'
            : 'error',
        )
        return
      }
      if (!response.ok) throw new Error(`Analytics request failed: ${response.status}`)

      const nextStats = await response.json() as AnalyticsStats
      setStats(nextStats)
      setViewState('ready')
    } catch {
      setViewState('error')
    } finally {
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    if (hasLoadedRef.current) return
    hasLoadedRef.current = true
    void loadStats(token)
  }, [loadStats, token])

  const maxDailyCount = useMemo(
    () => Math.max(...(stats?.daily.map((item) => item.count) ?? [0]), 1),
    [stats],
  )

  const handleLogin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextToken = tokenInput.trim()
    window.sessionStorage.setItem(TOKEN_STORAGE_KEY, nextToken)
    setToken(nextToken)
    void loadStats(nextToken)
  }

  const handleLogout = () => {
    window.sessionStorage.removeItem(TOKEN_STORAGE_KEY)
    setToken('')
    setTokenInput('')
    setStats(null)
    setViewState('unauthorized')
  }

  if (viewState === 'loading' && !stats) {
    return (
      <main className={styles.centeredPage}>
        <RefreshCw className={styles.loadingIcon} aria-hidden="true" />
        <p>正在读取统计</p>
      </main>
    )
  }

  if (viewState === 'unauthorized') {
    return (
      <main className={styles.centeredPage}>
        <form className={styles.loginPanel} onSubmit={handleLogin}>
          <div className={styles.loginMark}><KeyRound aria-hidden="true" /></div>
          <p className={styles.eyebrow}>玛卡小镇</p>
          <h1>数据后台</h1>
          <p className={styles.loginSubtitle}>查看详情点击统计</p>
          <label htmlFor="analytics-token">管理令牌</label>
          <input
            id="analytics-token"
            type="password"
            value={tokenInput}
            autoComplete="current-password"
            onChange={(event) => setTokenInput(event.target.value)}
            required
          />
          <button type="submit"><KeyRound size={17} aria-hidden="true" />进入后台</button>
        </form>
      </main>
    )
  }

  if (viewState === 'unconfigured') {
    return (
      <main className={styles.centeredPage}>
        <section className={styles.statePanel}>
          <KeyRound aria-hidden="true" />
          <h1>后台未配置</h1>
          <p>请在服务端设置 <code>ANALYTICS_ADMIN_TOKEN</code>。</p>
        </section>
      </main>
    )
  }

  if (viewState === 'error' || !stats) {
    return (
      <main className={styles.centeredPage}>
        <section className={styles.statePanel}>
          <BarChart3 aria-hidden="true" />
          <h1>统计暂时不可用</h1>
          <button type="button" onClick={() => void loadStats(token)}>
            <RefreshCw size={17} aria-hidden="true" />重试
          </button>
        </section>
      </main>
    )
  }

  const metrics = [
    { label: '累计点击', value: stats.summary.totalClicks, icon: MousePointerClick, tone: 'blue' },
    { label: '今日点击', value: stats.summary.todayClicks, icon: CalendarDays, tone: 'green' },
    { label: '近 7 天', value: stats.summary.last7DaysClicks, icon: Eye, tone: 'coral' },
    { label: '独立会话', value: stats.summary.uniqueSessions, icon: Users, tone: 'violet' },
  ] as const

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>玛卡小镇</p>
          <h1>查看详情统计</h1>
          <p className={styles.updatedAt}>
            <Clock3 size={14} aria-hidden="true" />
            更新于 {formatDateTime(stats.generatedAt)}
          </p>
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => void loadStats(token, true)}
            aria-label="刷新数据"
            title="刷新数据"
            disabled={isRefreshing}
          >
            <RefreshCw className={isRefreshing ? styles.spinning : undefined} aria-hidden="true" />
          </button>
          {token ? (
            <button
              type="button"
              className={styles.iconButton}
              onClick={handleLogout}
              aria-label="退出后台"
              title="退出后台"
            >
              <LogOut aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </header>

      <section className={styles.metrics} aria-label="关键指标">
        {metrics.map((metric) => {
          const Icon = metric.icon
          return (
            <article key={metric.label} className={styles.metric} data-tone={metric.tone}>
              <Icon aria-hidden="true" />
              <p>{metric.label}</p>
              <strong>{numberFormatter.format(metric.value)}</strong>
            </article>
          )
        })}
      </section>

      <section className={styles.trendSection} aria-labelledby="trend-title">
        <div className={styles.sectionHeading}>
          <div><p>趋势</p><h2 id="trend-title">近 7 天点击</h2></div>
          <span>{stats.timeZone}</span>
        </div>
        <div className={styles.chart}>
          {stats.daily.map((item) => {
            const barHeight = item.count === 0
              ? 2
              : Math.max((item.count / maxDailyCount) * 100, 8)
            return (
              <div key={item.date} className={styles.chartColumn}>
                <span>{numberFormatter.format(item.count)}</span>
                <div className={styles.barTrack}>
                  <div
                    className={styles.bar}
                    style={{ '--bar-height': `${barHeight}%` } as CSSProperties}
                  />
                </div>
                <time dateTime={item.date}>{formatDay(item.date)}</time>
              </div>
            )
          })}
        </div>
      </section>

      <div className={styles.breakdownGrid}>
        <section className={styles.breakdown} aria-labelledby="robot-title">
          <div className={styles.sectionHeading}>
            <div><p>内容</p><h2 id="robot-title">角色分布</h2></div>
          </div>
          {stats.byRobot.length ? (
            <ol>
              {stats.byRobot.map((item) => (
                <li key={item.key}>
                  <span>{item.label}</span>
                  <div><i style={{ width: `${(item.count / stats.summary.totalClicks) * 100}%` }} /></div>
                  <strong>{numberFormatter.format(item.count)}</strong>
                </li>
              ))}
            </ol>
          ) : <p className={styles.emptyState}>暂无数据</p>}
        </section>

        <section className={styles.breakdown} aria-labelledby="source-title">
          <div className={styles.sectionHeading}>
            <div><p>入口</p><h2 id="source-title">来源分布</h2></div>
          </div>
          {stats.bySource.length ? (
            <ol>
              {stats.bySource.map((item) => (
                <li key={item.key}>
                  <span>{item.label}</span>
                  <div><i style={{ width: `${(item.count / stats.summary.totalClicks) * 100}%` }} /></div>
                  <strong>{numberFormatter.format(item.count)}</strong>
                </li>
              ))}
            </ol>
          ) : <p className={styles.emptyState}>暂无数据</p>}
        </section>
      </div>

      <section className={styles.recentSection} aria-labelledby="recent-title">
        <div className={styles.sectionHeading}>
          <div><p>明细</p><h2 id="recent-title">最近点击</h2></div>
          <span>最近 50 条</span>
        </div>
        {stats.recent.length ? (
          <div className={styles.tableWrap}>
            <table>
              <thead><tr><th>时间</th><th>角色</th><th>入口</th><th>会话</th><th>去向</th></tr></thead>
              <tbody>
                {stats.recent.map((click) => (
                  <tr key={click.id}>
                    <td>{formatDateTime(click.occurredAt)}</td>
                    <td><strong>{click.robotLabel}</strong></td>
                    <td>{click.sourceLabel}</td>
                    <td><code>{click.sessionId.slice(0, 8)}</code></td>
                    <td>
                      <a href={click.destination} target="_blank" rel="noopener noreferrer">
                        {destinationHost(click.destination)}<ExternalLink size={13} aria-hidden="true" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.emptyDetail}>
            <MousePointerClick aria-hidden="true" />
            <p>还没有查看详情点击记录</p>
          </div>
        )}
      </section>
    </main>
  )
}
