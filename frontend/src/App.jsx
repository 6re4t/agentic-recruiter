import { useEffect, useRef, useState } from 'react'
import './App.css'
import GraphView from './GraphView.jsx'
import ChatView from './ChatView.jsx'

const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '')

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options)
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) throw new Error(data?.detail || `HTTP ${response.status}`)
  return data
}

// ─── Badge helpers ──────────────────────────────────────────────────────────

const STAGE_BADGE = {
  Applied:        'badge-gray',
  Processing:     'badge-yellow',
  Scoring:        'badge-yellow',
  Scored:         'badge-blue',
  Outreach_Draft: 'badge-purple',
  Contacted:      'badge-green',
  Rejected:       'badge-red',
  Ready:          'badge-green',
  Error:          'badge-red',
  Sourced:        'badge-gray',
}

const OUTREACH_BADGE = {
  draft:       'badge-gray',
  approved:    'badge-green',
  rejected:    'badge-red',
  sent:        'badge-green',
  send_failed: 'badge-red',
}

function StageBadge({ stage }) {
  if (!stage) return null
  return <span className={`badge ${STAGE_BADGE[stage] || 'badge-gray'}`}>{stage}</span>
}

function OutreachBadge({ status }) {
  if (!status) return null
  return <span className={`badge ${OUTREACH_BADGE[status] || 'badge-gray'}`}>{status}</span>
}

function ScorePill({ score }) {
  if (score == null) return null
  const cls = score >= 70 ? 'score-high' : score >= 40 ? 'score-mid' : 'score-low'
  return <span className={`score-pill ${cls}`}>{score.toFixed(0)}</span>
}

function ScoreBreakdown({ app }) {
  if (!app) return null
  const scoreData = (() => {
    try { return app.score_json ? JSON.parse(app.score_json) : null } catch { return null } })()

  if (!scoreData) {
    return app.score_reason
      ? <>
          <p style={{ fontSize: '0.82rem', color: 'var(--muted)', margin: '8px 0 0' }}>{app.score_reason}</p>
          {app.score != null && <p className="hint" style={{ margin: '6px 0 0' }}>Re-run the pipeline to get the full breakdown.</p>}
        </>
      : null
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '12px' }}>

      {/* Overall + recommendation */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <ScorePill score={scoreData.score} />
        <span style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>{scoreData.one_line_reason}</span>
        {scoreData.recommendation && (
          <span className={`badge badge-${scoreData.recommendation === 'reach_out' ? 'green' : scoreData.recommendation === 'maybe' ? 'yellow' : 'red'}`}
            style={{ textTransform: 'capitalize' }}>
            {scoreData.recommendation.replace('_', ' ')}
          </span>
        )}
      </div>

      {/* Category scores */}
      {scoreData.category_scores?.length > 0 && (
        <div>
          <p className="section-label">Category Scores</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {scoreData.category_scores.map((cat, i) => (
              <div key={i}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>{cat.category}</span>
                  <span style={{
                    fontSize: '0.82rem', fontWeight: 700, minWidth: '36px', textAlign: 'right',
                    color: cat.score >= 76 ? 'var(--success)' : cat.score >= 56 ? '#d97706' : 'var(--danger)'
                  }}>{cat.score.toFixed(0)}</span>
                </div>
                <div style={{ background: 'var(--border)', borderRadius: '6px', height: '8px', overflow: 'hidden' }}>
                  <div style={{
                    width: `${cat.score}%`, height: '100%', borderRadius: '6px',
                    background: cat.score >= 76 ? 'var(--success)' : cat.score >= 56 ? '#f59e0b' : 'var(--danger)',
                    transition: 'width 0.4s ease'
                  }} />
                </div>
                {cat.rationale && (
                  <p style={{ fontSize: '0.76rem', color: 'var(--muted)', margin: '3px 0 0', lineHeight: 1.4 }}>{cat.rationale}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Strengths & Gaps */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        {scoreData.strengths?.length > 0 && (
          <div>
            <p className="section-label" style={{ color: 'var(--success)' }}>✓ Strengths</p>
            <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '0.82rem', display: 'flex', flexDirection: 'column', gap: '3px' }}>
              {scoreData.strengths.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </div>
        )}
        {scoreData.gaps?.length > 0 && (
          <div>
            <p className="section-label" style={{ color: 'var(--danger)' }}>✗ Gaps</p>
            <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '0.82rem', display: 'flex', flexDirection: 'column', gap: '3px' }}>
              {scoreData.gaps.map((g, i) => <li key={i}>{g}</li>)}
            </ul>
          </div>
        )}
      </div>

      {/* Evidence snippets */}
      {scoreData.evidence_snippets?.length > 0 && (
        <div>
          <p className="section-label">Evidence from Resume</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {scoreData.evidence_snippets.map((ev, i) => (
              <div key={i} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '6px', padding: '8px 10px', fontSize: '0.82rem' }}>
                <p style={{ margin: '0 0 2px', fontStyle: 'italic', color: 'var(--text)' }}>&ldquo;{ev.quote}&rdquo;</p>
                <p style={{ margin: 0, color: 'var(--muted)' }}>{ev.relevance}</p>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  )
}

// ─── Status bar ─────────────────────────────────────────────────────────────

function statusClass(s) {
  if (s.endsWith('...')) return 'loading'
  if (s.includes('failed') || s.includes('error')) return 'error'
  if (s.includes('done')) return 'done'
  return ''
}

// ─── Result viewer ───────────────────────────────────────────────────────────

function ResultViewer({ data, depth = 0 }) {
  const [expanded, setExpanded] = useState({})
  const toggle = key => setExpanded(e => ({ ...e, [key]: !e[key] }))

  if (data === null || data === undefined)
    return <span style={{ color: 'var(--muted)' }}>null</span>

  if (typeof data === 'boolean')
    return <span style={{ color: data ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>{String(data)}</span>

  if (typeof data === 'number')
    return <span style={{ color: '#7c3aed', fontWeight: 600 }}>{data}</span>

  if (typeof data === 'string') {
    // Try to parse nested JSON strings
    if ((data.startsWith('{') || data.startsWith('[')) && data.length > 2) {
      try {
        const parsed = JSON.parse(data)
        return (
          <span>
            <span style={{ color: 'var(--muted)', fontSize: '0.75rem', marginRight: '4px' }}>[JSON]</span>
            <ResultViewer data={parsed} depth={depth} />
          </span>
        )
      } catch {}
    }
    if (data.length > 200) {
      const key = `str-${depth}`
      return expanded[key]
        ? <span style={{ color: '#059669', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            "{data}" <button className="btn-ghost btn-sm" style={{ fontSize: '0.7rem' }} onClick={() => toggle(key)}>less</button>
          </span>
        : <span style={{ color: '#059669' }}>
            "{data.slice(0, 200)}…" <button className="btn-ghost btn-sm" style={{ fontSize: '0.7rem' }} onClick={() => toggle(key)}>more</button>
          </span>
    }
    return <span style={{ color: '#059669' }}>"{data}"</span>
  }

  if (Array.isArray(data)) {
    if (data.length === 0) return <span style={{ color: 'var(--muted)' }}>[ ]</span>
    return (
      <ul style={{ margin: '2px 0 0 0', paddingLeft: depth === 0 ? 0 : '18px', listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {data.map((item, i) => (
          <li key={i} style={{ display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
            <span style={{ color: 'var(--muted)', fontSize: '0.72rem', minWidth: '16px', paddingTop: '2px' }}>{i}</span>
            <ResultViewer data={item} depth={depth + 1} />
          </li>
        ))}
      </ul>
    )
  }

  if (typeof data === 'object') {
    const entries = Object.entries(data)
    if (entries.length === 0) return <span style={{ color: 'var(--muted)' }}>{'{ }'}</span>

    // Special render: updates array as a timeline
    if ('step' in data && 'ts' in data) {
      const time = new Date(data.ts).toLocaleTimeString()
      return (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: '0.82rem' }}>
          <span style={{ color: 'var(--muted)', minWidth: '70px', fontSize: '0.75rem' }}>{time}</span>
          <span style={{ fontWeight: 600, color: 'var(--primary)' }}>{data.step}</span>
          {data.data != null && <ResultViewer data={data.data} depth={depth + 1} />}
        </div>
      )
    }

    return (
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.82rem' }}>
        <tbody>
          {entries.map(([k, v]) => {
            const label = k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
            const isCollapsible = (typeof v === 'object' && v !== null) || (typeof v === 'string' && v.length > 200)
            const open = expanded[k] !== false  // default open at top level
            return (
              <tr key={k} style={{ verticalAlign: 'top' }}>
                <td style={{ padding: '3px 12px 3px 0', color: 'var(--muted)', fontWeight: 500, whiteSpace: 'nowrap', userSelect: 'none',
                    cursor: isCollapsible ? 'pointer' : 'default', width: '1%' }}
                  onClick={() => isCollapsible && toggle(k)}>
                  {isCollapsible && <span style={{ fontSize: '0.7rem', marginRight: '4px' }}>{open ? '▾' : '▸'}</span>}
                  {label}
                </td>
                <td style={{ padding: '3px 0' }}>
                  {isCollapsible && !open
                    ? <span style={{ color: 'var(--muted)', fontSize: '0.78rem' }}>
                        {Array.isArray(v) ? `[ ${v.length} items ]` : '{ … }'}
                      </span>
                    : <ResultViewer data={v} depth={depth + 1} />
                  }
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    )
  }

  return <span>{String(data)}</span>
}

// ─── Icons ───────────────────────────────────────────────────────────────────

const LogoMark = () => (
  <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true">
    <rect width="26" height="26" rx="7" fill="#4f46e5"/>
    <path d="M14.8 4.5 8 13.5h5.6L11.2 21.5l8.8-10.5H14L14.8 4.5z" fill="white"/>
  </svg>
)

const BriefcaseIcon = () => (
  <svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path fillRule="evenodd" d="M6 3.75A2.75 2.75 0 018.75 1h2.5A2.75 2.75 0 0114 3.75v.443c.572.055 1.14.122 1.706.2C17.053 4.582 18 5.75 18 7.07v3.469c0 1.126-.694 2.191-1.83 2.54-1.952.599-4.024.921-6.17.921s-4.219-.322-6.17-.921C2.694 12.73 2 11.665 2 10.539V7.07c0-1.321.947-2.489 2.294-2.676A41.047 41.047 0 016 4.193V3.75zm6.5 0v.325a41.622 41.622 0 00-5 0V3.75c0-.69.56-1.25 1.25-1.25h2.5c.69 0 1.25.56 1.25 1.25zM10 10a1 1 0 00-1 1v.01a1 1 0 001 1h.01a1 1 0 001-1V11a1 1 0 00-1-1H10z" clipRule="evenodd"/>
    <path d="M3 15.055v-.684c.124.082.253.16.389.231 2.077 1.073 4.4 1.575 6.611 1.575 2.21 0 4.533-.502 6.61-1.575.137-.071.266-.149.39-.231v.684c0 1.347-.985 2.57-2.363 2.727a41.911 41.911 0 01-9.274 0C3.985 17.624 3 16.402 3 15.055z"/>
  </svg>
)

const UsersIcon = () => (
  <svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path d="M7 8a3 3 0 100-6 3 3 0 000 6zM14.5 9a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM1.615 16.428a1.224 1.224 0 01-.569-1.175 6.002 6.002 0 0111.908 0c.058.467-.172.92-.57 1.174A9.953 9.953 0 017 17a9.953 9.953 0 01-5.385-1.572zM14.5 16h-.106c.07-.297.088-.611.048-.933a7.47 7.47 0 00-1.588-3.755 4.502 4.502 0 015.874 2.636.818.818 0 01-.36.98A7.465 7.465 0 0114.5 16z"/>
  </svg>
)

const SearchIconNav = () => (
  <svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd"/>
  </svg>
)

const GraphIconNav = () => (
  <svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path d="M13 4.5a2.5 2.5 0 11.702 1.737L6.97 9.604a2.518 2.518 0 010 .792l6.733 3.367a2.5 2.5 0 11-.671 1.341l-6.733-3.367a2.5 2.5 0 110-3.474l6.733-3.366A2.52 2.52 0 0113 4.5z"/>
  </svg>
)

const ChatIconNav = () => (
  <svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path d="M3.505 2.365A41.369 41.369 0 019 2c1.863 0 3.697.124 5.495.365 1.247.167 2.18 1.108 2.435 2.268a4.45 4.45 0 00-.577-.069 43.141 43.141 0 00-4.706 0C9.229 4.696 7.5 6.727 7.5 8.998v2.24c0 1.413.67 2.735 1.76 3.562l-2.98 2.98A.75.75 0 015 17.25v-3.443c-.501-.048-1-.106-1.495-.172C2.033 13.438 1 12.162 1 10.72V5.28c0-1.441 1.033-2.717 2.505-2.914z"/>
    <path d="M14 6c-.762 0-1.52.02-2.271.062C10.157 6.148 9 7.472 9 8.998v2.24c0 1.519 1.147 2.839 2.71 2.935.214.013.428.024.642.034.2.009.385.09.518.224l2.35 2.35a.75.75 0 001.28-.531v-2.07c1.453-.195 2.5-1.463 2.5-2.915V8.998c0-1.526-1.157-2.85-2.729-2.936A41.645 41.645 0 0014 6z"/>
  </svg>
)

const SettingsIconNav = () => (
  <svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path fillRule="evenodd" d="M7.84 1.804A1 1 0 018.82 1h2.36a1 1 0 01.98.804l.331 1.652a6.993 6.993 0 011.929 1.115l1.598-.54a1 1 0 011.186.447l1.18 2.044a1 1 0 01-.205 1.251l-1.267 1.113a7.047 7.047 0 010 2.228l1.267 1.113a1 1 0 01.205 1.251l-1.18 2.044a1 1 0 01-1.186.447l-1.598-.54a6.993 6.993 0 01-1.929 1.115l-.33 1.652a1 1 0 01-.98.804H8.82a1 1 0 01-.98-.804l-.331-1.652a6.993 6.993 0 01-1.929-1.115l-1.598.54a1 1 0 01-1.186-.447l-1.18-2.044a1 1 0 01.205-1.251l1.267-1.113a7.047 7.047 0 010-2.228L1.08 7.304a1 1 0 01-.205-1.251l1.18-2.044a1 1 0 011.186-.447l1.598.54A6.993 6.993 0 016.768 2.9l.33-1.652a1 1 0 01.74-.797V1.804zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd"/>
  </svg>
)

const TerminalIcon = () => (
  <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path fillRule="evenodd" d="M2 5a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V5zm3.293 1.293a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 01-1.414-1.414L7.586 10 5.293 7.707a1 1 0 010-1.414zM11 12a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd"/>
  </svg>
)

// ─── App shell ──────────────────────────────────────────────────────────────

export default function App() {
  const [view, setView] = useState('jobs')
  const [status, setStatus] = useState('Ready')
  const [result, setResult] = useState(null)
  const [showResult, setShowResult] = useState(false)
  const [settings, setSettings] = useState(null)  // loaded from /settings

  useEffect(() => {
    api('/settings').then(s => setSettings(s)).catch(() => {})
  }, [])

  async function saveSettings(updated) {
    const saved = await api('/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    })
    setSettings(saved)
    return saved
  }

  async function runTask(label, fn) {
    try {
      setStatus(`${label}...`)
      const out = await fn()
      setResult(out)
      setStatus(`${label} — done`)
      return out
    } catch (err) {
      setStatus(`${label} failed: ${err.message}`)
      throw err
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
          <div className="topbar-brand">
            <LogoMark />
            <span className="topbar-title">Agentic Recruiter</span>
          </div>
          <nav className="topbar-nav">
            <button className={`tab-btn ${view === 'jobs' ? 'active' : ''}`} onClick={() => setView('jobs')}>
              <BriefcaseIcon /> Jobs
            </button>
            <button className={`tab-btn ${view === 'candidates' ? 'active' : ''}`} onClick={() => setView('candidates')}>
              <UsersIcon /> Candidates
            </button>
            <button className={`tab-btn ${view === 'search' ? 'active' : ''}`} onClick={() => setView('search')}>
              <SearchIconNav /> Search
            </button>
            <button className={`tab-btn ${view === 'graph' ? 'active' : ''}`} onClick={() => setView('graph')}>
              <GraphIconNav /> Graph
            </button>
            <button className={`tab-btn ${view === 'chat' ? 'active' : ''}`} onClick={() => setView('chat')}>
              <ChatIconNav /> Chat
            </button>
            <button className={`tab-btn ${view === 'settings' ? 'active' : ''}`} onClick={() => setView('settings')}>
              <SettingsIconNav /> Settings
            </button>
          </nav>
          <div className="topbar-end">
            <span className={`topbar-status ${statusClass(status)}`}>{status}</span>
            <button
              className="btn-icon"
              onClick={() => setShowResult(v => !v)}
              title="Toggle last API result"
              aria-pressed={showResult}
              style={showResult ? { color: 'var(--primary)', background: 'var(--primary-light)' } : undefined}
            >
              <TerminalIcon />
            </button>
          </div>
        </header>

      <main className="page">
        {showResult && (
          <div className="card" style={{ marginBottom: '16px' }}>
            <div className="card-header">
              <span className="card-title">Last API Result</span>
              <button className="btn-ghost btn-sm" onClick={() => setShowResult(false)}>✕ Close</button>
            </div>
            <div className="card-body" style={{ overflowX: 'auto' }}>
              {result
                ? <ResultViewer data={result} />
                : <span style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>No result yet</span>}
            </div>
          </div>
        )}

        {/* ChatView is always mounted so conversation history survives tab switches */}
        <div style={{ display: view === 'chat' ? 'block' : 'none' }}>
          <ChatView />
        </div>

        {view === 'jobs'
          ? <JobsView runTask={runTask} settings={settings} />
          : view === 'candidates'
          ? <CandidatesView runTask={runTask} />
          : view === 'search'
          ? <SearchView runTask={runTask} />
          : view === 'graph'
          ? <GraphView />
          : view === 'chat'
          ? null
          : <SettingsView runTask={runTask} settings={settings} onSave={saveSettings} />}
      </main>
    </div>
  )
}

// ─── Jobs view ───────────────────────────────────────────────────────────────

function JobsView({ runTask, settings }) {
  const [jobs, setJobs] = useState([])
  const [selectedJob, setSelectedJob] = useState(null)
  const [jobForm, setJobForm] = useState({ title: '', description: '', rubric: '', blind_scoring: false })
  const [showCreateJob, setShowCreateJob] = useState(false)
  const [showJD, setShowJD] = useState(true)

  const [applications, setApplications] = useState([])
  const [candidates, setCandidates] = useState([])
  const [selectedApp, setSelectedApp] = useState(null)
  const [detailApp, setDetailApp] = useState(null)

  const [requireApproval, setRequireApproval] = useState(true)
  const [resumeRunId, setResumeRunId] = useState('')
  const [topK, setTopK] = useState(3)
  const [skipScored, setSkipScored] = useState(false)
  const [jdReport, setJdReport] = useState(null)
  const [jdReportJobId, setJdReportJobId] = useState(null)
  const [jdOpen, setJdOpen] = useState(false)
  const [jdPos, setJdPos] = useState({ top: 0, left: 0 })
  const jdButtonRef = useRef(null)
  const jdDropdownRef = useRef(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!jdOpen) return
    function handleClickOutside(e) {
      if (
        jdDropdownRef.current && !jdDropdownRef.current.contains(e.target) &&
        jdButtonRef.current && !jdButtonRef.current.contains(e.target)
      ) {
        setJdOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [jdOpen])

  // Close if job changes
  useEffect(() => { setJdOpen(false) }, [selectedJob?.id])

  useEffect(() => { loadJobs() }, [])
  useEffect(() => {
    if (selectedJob) { loadApplications(selectedJob.id); loadCandidates() }
  }, [selectedJob?.id])
  // Sync defaults from settings when they load
  useEffect(() => {
    if (settings) {
      setRequireApproval(settings.require_approval ?? true)
      setTopK(settings.default_top_k ?? 3)
    }
  }, [settings?.sender_name])

  async function loadJobs() {
    const data = await api('/jobs')
    setJobs(data)
    if (data.length && !selectedJob) setSelectedJob(data[0])
  }

  async function loadApplications(jobId) {
    const data = await api(`/jobs/${jobId}/applications`)
    setApplications(data)
    setSelectedApp(null)
    setDetailApp(null)
  }

  async function handleDeleteJob(id) {
    if (!window.confirm('Delete this job and all its applications? This cannot be undone.')) return
    await runTask('Delete Job', async () => {
      await api(`/jobs/${id}`, { method: 'DELETE' })
      if (selectedJob?.id === id) { setSelectedJob(null); setApplications([]) }
      loadJobs()
    })
  }

  async function loadCandidates() {
    const data = await api('/candidates?limit=200')
    setCandidates(data)
  }

  function candidateName(id) {
    const c = candidates.find(c => c.id === id)
    return c ? (c.name || `Candidate #${id}`) : `#${id}`
  }

  async function handleCreateJob(e) {
    e.preventDefault()
    await runTask('Create job', async () => {
      const job = await api('/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jobForm),
      })
      setJobForm({ title: '', description: '', rubric: '', blind_scoring: false })
      setShowCreateJob(false)
      await loadJobs()
      setSelectedJob(job)
      return job
    })
  }

  async function handleCheckJD() {
    if (!selectedJob) return
    // If we already have a report for this job, just toggle the panel
    if (jdReport && jdReportJobId === selectedJob.id) {
      const rect = jdButtonRef.current?.getBoundingClientRect()
      if (rect) setJdPos({ top: rect.bottom + 6, left: rect.left })
      setJdOpen(v => !v)
      return
    }
    // Fetch fresh report then open
    await runTask('Check JD quality', async () => {
      const report = await api(`/jobs/${selectedJob.id}/check-quality`, { method: 'POST' })
      setJdReport(report)
      setJdReportJobId(selectedJob.id)
      const rect = jdButtonRef.current?.getBoundingClientRect()
      if (rect) setJdPos({ top: rect.bottom + 6, left: rect.left })
      setJdOpen(true)
      return report
    })
  }

  async function handleToggleBlind() {
    if (!selectedJob) return
    const newVal = !selectedJob.blind_scoring
    await runTask(newVal ? 'Enable blind scoring' : 'Disable blind scoring', async () => {
      const updated = await api(`/jobs/${selectedJob.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blind_scoring: newVal }),
      })
      setSelectedJob(updated)
      setJobs(prev => prev.map(j => j.id === updated.id ? updated : j))
      return updated
    })
  }

  async function handleUploadToJob(e) {
    if (!selectedJob) return
    const files = Array.from(e.target.files || []).filter(f => f.name.toLowerCase().endsWith('.pdf'))
    if (!files.length) return
    const form = new FormData()
    files.forEach(f => form.append('files', f))
    await runTask('Upload PDFs', async () => {
      const out = await api(`/jobs/${selectedJob.id}/upload-candidates`, { method: 'POST', body: form })
      setTimeout(() => loadApplications(selectedJob.id), 2500)
      return out
    })
    e.target.value = ''
  }

  async function handleAssignCandidate(e) {
    const candidateId = e.target.value
    if (!selectedJob || !candidateId) return
    e.target.value = ''
    await runTask('Assign candidate', async () => {
      const out = await api('/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidate_id: Number(candidateId), job_id: selectedJob.id }),
      })
      await loadApplications(selectedJob.id)
      setSelectedApp(out)
      return out
    })
  }

  async function handleRunGraph() {
    if (!selectedApp) return
    await runTask('Run AI pipeline', async () => {
      const out = await api('/agent/graph/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          application_id: selectedApp.id,
          require_approval: requireApproval,
          sender_name: settings?.sender_name,
          sender_company: settings?.sender_company,
          tone: settings?.tone,
        }),
      })
      await loadApplications(selectedJob.id)
      return out
    })
  }

  async function handleBatchTopK() {
    if (!selectedJob) return
    await runTask(`Batch Top-${topK}`, async () => {
      const out = await api('/agent/batch/topk_outreach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: selectedJob.id,
          top_k: Number(topK) || settings?.default_top_k || 3,
          sender_name: settings?.sender_name,
          sender_company: settings?.sender_company,
          tone: settings?.tone,
          skip_scored: skipScored,
        }),
      })
      await loadApplications(selectedJob.id)
      return out
    })
  }

  async function handleSendEmail() {
    if (!selectedApp) return
    if (!selectedApp.outreach_json) {
      alert('No outreach draft for this application. Run the pipeline first.')
      return
    }
    await runTask('Send email', async () => {
      const out = await api('/outreach/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ application_id: selectedApp.id }),
      })
      await loadApplications(selectedJob.id)
      return out
    })
  }

  async function handleResume(approved) {
    if (!resumeRunId) return
    await runTask(approved ? 'Approve outreach' : 'Reject outreach', async () => {
      const out = await api('/agent/graph/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_id: Number(resumeRunId), approved }),
      })
      if (selectedJob) await loadApplications(selectedJob.id)
      return out
    })
  }

  return (
    <div className="three-col">

      {/* ── Column 1: Jobs ── */}
      <div>
        <div className="card">
          <div className="card-header">
            <div>
              <p className="card-title">Jobs</p>
              <p className="card-subtitle">{jobs.length} job{jobs.length !== 1 ? 's' : ''}</p>
            </div>
            <div className="btn-row">
              <button className="btn-ghost btn-sm" onClick={loadJobs}>↺</button>
              <button className="btn-primary btn-sm" onClick={() => setShowCreateJob(v => !v)}>
                {showCreateJob ? 'Cancel' : '+ New Job'}
              </button>
            </div>
          </div>

          {showCreateJob && (
            <div className="card-body">
              <form onSubmit={handleCreateJob}>
                <div className="field">
                  <label>Job Title</label>
                  <input placeholder="e.g. Senior Frontend Engineer" value={jobForm.title}
                    onChange={e => setJobForm(p => ({ ...p, title: e.target.value }))} required />
                </div>
                <div className="field">
                  <label>Description</label>
                  <textarea placeholder="What does this role involve?" value={jobForm.description}
                    onChange={e => setJobForm(p => ({ ...p, description: e.target.value }))} required />
                </div>
                <div className="field">
                  <label>Scoring Rubric</label>
                  <textarea placeholder="What skills and experience matter most?" value={jobForm.rubric}
                    onChange={e => setJobForm(p => ({ ...p, rubric: e.target.value }))} required />
                  <p className="hint">The AI uses this rubric to score candidates.</p>
                </div>
                <label className="checkbox-field" style={{ marginBottom: '12px' }}>
                  <input type="checkbox" checked={jobForm.blind_scoring}
                    onChange={e => setJobForm(p => ({ ...p, blind_scoring: e.target.checked }))} />
                  <span>
                    <strong>Blind scoring</strong> — strip name, email &amp; location before the AI scores candidates
                  </span>
                </label>
                <button type="submit" className="btn-primary" style={{ width: '100%' }}>Create Job</button>
              </form>
            </div>
          )}

          <div className="scroll-list">
            {jobs.map(j => (
              <div key={j.id} className={`list-item ${selectedJob?.id === j.id ? 'selected' : ''}`}
                onClick={() => setSelectedJob(j)}>
                <div className="list-item-main">
                  <div className="list-item-name">{j.title}</div>
                  <div className="list-item-meta">#{j.id}</div>
                </div>
                {j.blind_scoring && <span className="badge badge-purple" title="Blind scoring enabled">Blind</span>}
                {selectedJob?.id === j.id && (
                  <button className="btn-ghost btn-sm" title={showJD ? 'Collapse JD' : 'Expand JD'}
                    onClick={e => { e.stopPropagation(); setShowJD(v => !v) }}>
                    {showJD ? '▲' : '▼'}
                  </button>
                )}
                <button className="btn-danger btn-sm" title="Delete job"
                  onClick={e => { e.stopPropagation(); handleDeleteJob(j.id) }}>✕</button>
              </div>
            ))}
            {!jobs.length && <div className="list-empty">No jobs yet. Create one above.</div>}
          </div>

          {selectedJob && showJD && (
            <div className="card-body" style={{ borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
              <p style={{ fontSize: '0.78rem', color: 'var(--muted)', marginBottom: '6px' }}>Description</p>
              <p style={{ fontSize: '0.82rem', color: 'var(--text)', whiteSpace: 'pre-wrap', lineHeight: 1.55, marginBottom: '10px' }}>
                {selectedJob.description}
              </p>
              {selectedJob.rubric && (
                <>
                  <p style={{ fontSize: '0.78rem', color: 'var(--muted)', marginBottom: '4px' }}>Scoring rubric</p>
                  <p style={{ fontSize: '0.82rem', color: 'var(--text)', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>
                    {selectedJob.rubric}
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Column 2: Applications ── */}
      <div>
        <div className="card">
          <div className="card-header">
            <div>
              <p className="card-title">
                {selectedJob ? `Applications — ${selectedJob.title}` : 'Applications'}
              </p>
              <p className="card-subtitle">
                {selectedJob ? `${applications.length} applicant${applications.length !== 1 ? 's' : ''}` : 'Select a job to see applicants'}
              </p>
            </div>
            {selectedJob && (
              <div className="btn-row">
                <button
                  className={selectedJob.blind_scoring ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'}
                  title={selectedJob.blind_scoring ? 'Blind scoring ON — click to disable' : 'Blind scoring OFF — click to enable'}
                  onClick={handleToggleBlind}
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {selectedJob.blind_scoring ? '🙈 Blind ON' : '👁 Blind OFF'}
                </button>
                <button className="btn-ghost btn-sm" onClick={() => loadApplications(selectedJob.id)}>↺</button>
              </div>
            )}
          </div>

          {selectedJob && (
            <div className="card-body">
              <p className="section-label">Add candidates to this job</p>
              <div className="field">
                <label>Upload resume PDFs</label>
                <input type="file" accept="application/pdf" multiple onChange={handleUploadToJob} />
                <p className="hint">Candidates are auto-created and de-duplicated by email / resume hash.</p>
              </div>
              <div className="field">
                <label>Assign from talent pool</label>
                <select onChange={handleAssignCandidate} value="">
                  <option value="">— pick an existing candidate —</option>
                  {candidates.map(c => (
                    <option key={c.id} value={c.id}>#{c.id} {c.name || '(no name)'} {c.email ? `· ${c.email}` : ''}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="scroll-list" style={{ maxHeight: selectedJob ? '260px' : '340px' }}>
            {applications.map(app => (
              <div key={app.id}
                className={`list-item ${selectedApp?.id === app.id ? 'selected' : ''}`}
                onClick={() => setSelectedApp(app)}>
                <div className="list-item-main">
                  <div className="list-item-name">{candidateName(app.candidate_id)}</div>
                  <div className="list-item-meta">App #{app.id}</div>
                </div>
                <StageBadge stage={app.stage} />
                {app.score != null && <ScorePill score={app.score} />}
                <OutreachBadge status={app.outreach_status} />
                <button
                  className="btn-ghost btn-sm"
                  title="View application detail"
                  onClick={e => { e.stopPropagation(); setDetailApp(app) }}
                >⋯</button>
              </div>
            ))}
            {selectedJob && !applications.length && (
              <div className="list-empty">No applicants yet. Upload PDFs or assign a candidate.</div>
            )}
            {!selectedJob && <div className="list-empty">Select a job on the left.</div>}
          </div>
        </div>
      </div>

      {/* ── Column 3: Actions + Detail ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

        {/* Agent Actions */}
        <div className="card">
          <div className="card-header">
            <div>
              <p className="card-title">AI Actions</p>
              <p className="card-subtitle">
                {selectedApp ? `App #${selectedApp.id} — ${candidateName(selectedApp.candidate_id)}` : 'Select an application'}
              </p>
            </div>
          </div>
          <div className="card-body">
            <p className="section-label">Single application</p>
            <label className="checkbox-field" style={{ marginBottom: '10px' }}>
              <input type="checkbox" checked={requireApproval} onChange={e => setRequireApproval(e.target.checked)} />
              Pause for approval before sending email
            </label>
            <div className="btn-row">
              <button className="btn-primary" onClick={handleRunGraph} disabled={!selectedApp}
                title="Score candidate, draft outreach, optionally send email">
                ▶ Run Pipeline
              </button>
              <button className="btn-gray" onClick={handleSendEmail}
                disabled={!selectedApp || !selectedApp.outreach_json}
                title={!selectedApp?.outreach_json ? 'No outreach draft — run the pipeline first' : 'Send the drafted outreach email now'}>
                ✉ Send Email
              </button>
            </div>
          </div>

          <div className="card-body">
            <p className="section-label">Job description quality</p>
            <button
              ref={jdButtonRef}
              className={jdOpen ? 'btn-primary btn-sm' : 'btn-gray btn-sm'}
              onClick={handleCheckJD}
              disabled={!selectedJob}
              title="Analyse this JD for vague requirements, bias, skill stacking, and more"
            >
              🔍 Check JD Quality
            </button>
          </div>

          <div className="card-body">
            <p className="section-label">Batch — score all applicants</p>
            <div className="btn-row" style={{ alignItems: 'center' }}>
              <label style={{ margin: 0, fontSize: '0.8rem', whiteSpace: 'nowrap' }}>Top K</label>
              <input type="number" min={1} max={50} value={topK}
                onChange={e => setTopK(e.target.value)} style={{ width: '64px' }} />
              <button className="btn-gray" onClick={handleBatchTopK} disabled={!selectedJob}
                title="Score all applicants, draft outreach for top K">
                ⚡ Batch Top-K
              </button>
              <label style={{ margin: 0, fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={skipScored} onChange={e => setSkipScored(e.target.checked)} />
                Skip scored
              </label>
            </div>
            <p className="hint" style={{ marginTop: '6px' }}>Scores every applicant for this job and drafts outreach for the top K.</p>
          </div>

          <div className="card-body">
            <p className="section-label">Resume paused run</p>
            <div className="field">
              <label>Run ID</label>
              <input placeholder="Enter run ID from pipeline result"
                value={resumeRunId} onChange={e => setResumeRunId(e.target.value)} />
              <p className="hint">Needed when the pipeline paused for approval.</p>
            </div>
            <div className="btn-row">
              <button className="btn-success" onClick={() => handleResume(true)} disabled={!resumeRunId}>
                ✓ Approve
              </button>
              <button className="btn-danger" onClick={() => handleResume(false)} disabled={!resumeRunId}>
                ✕ Reject
              </button>
            </div>
          </div>
        </div>

        {/* Application detail modal */}
        {detailApp && (
          <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setDetailApp(null) }}>
            <div className="modal">
              <div className="modal-header">
                <div>
                  <p className="card-title" style={{ marginBottom: '4px' }}>
                    {candidateName(detailApp.candidate_id)}
                  </p>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <StageBadge stage={detailApp.stage} />
                    {detailApp.score != null && <ScorePill score={detailApp.score} />}
                    {detailApp.outreach_status && <OutreachBadge status={detailApp.outreach_status} />}
                    <span style={{ fontSize: '0.76rem', color: 'var(--muted)' }}>App #{detailApp.id}</span>
                  </div>
                </div>
                <button className="btn-ghost btn-sm" style={{ flexShrink: 0 }} onClick={() => setDetailApp(null)}>✕</button>
              </div>
              <div className="modal-body">
                <ScoreBreakdown app={detailApp} />
                <RecruiterNotes app={detailApp} onSaved={app => setDetailApp(app)} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* JD Quality dropdown — fixed so it's never clipped by overflow */}
      {jdOpen && jdReport && jdReportJobId === selectedJob?.id && (
        <div
          ref={jdDropdownRef}
          style={{
            position: 'fixed',
            top: Math.min(jdPos.top, window.innerHeight - 440),
            left: Math.min(jdPos.left, window.innerWidth - 356),
            zIndex: 500,
            width: '340px',
            maxHeight: '420px',
            overflowY: 'auto',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '10px',
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          <JDQualityReport report={jdReport} onClose={() => setJdOpen(false)} />
        </div>
      )}
    </div>
  )
}

// ─── Candidates view ─────────────────────────────────────────────────────────

function CandidatesView({ runTask }) {
  const [candidates, setCandidates] = useState([])
  const [selectedCandidate, setSelectedCandidate] = useState(null)
  const [candidateApps, setCandidateApps] = useState([])
  const [selectedCandidateApp, setSelectedCandidateApp] = useState(null)
  const [jobs, setJobs] = useState([])
  const [manualForm, setManualForm] = useState({ name: '', email: '', resume_text: '' })
  const [showAddForm, setShowAddForm] = useState(false)

  useEffect(() => { loadCandidates(); loadJobs() }, [])
  useEffect(() => {
    if (selectedCandidate) { loadCandidateApps(selectedCandidate.id); setSelectedCandidateApp(null) }
  }, [selectedCandidate?.id])

  async function loadCandidates() {
    const data = await api('/candidates?limit=200')
    setCandidates(data)
  }

  async function loadJobs() {
    const data = await api('/jobs')
    setJobs(data)
  }

  async function loadCandidateApps(candidateId) {
    const data = await api(`/candidates/${candidateId}/applications`)
    setCandidateApps(data)
  }

  function jobTitle(id) {
    const j = jobs.find(j => j.id === id)
    return j ? j.title : `Job #${id}`
  }

  async function handleCreateManual(e) {
    e.preventDefault()
    await runTask('Add candidate', async () => {
      const out = await api('/candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(manualForm),
      })
      setManualForm({ name: '', email: '', resume_text: '' })
      setShowAddForm(false)
      await loadCandidates()
      setSelectedCandidate(out.candidate ?? out)
      return out
    })
  }

  async function handleUploadPdfs(e) {
    const files = Array.from(e.target.files || []).filter(f => f.name.toLowerCase().endsWith('.pdf'))
    if (!files.length) return
    const form = new FormData()
    files.forEach(f => form.append('files', f))
    await runTask('Upload PDFs', async () => {
      const out = await api('/candidates/upload_pdfs', { method: 'POST', body: form })
      setTimeout(loadCandidates, 2500)
      return out
    })
    e.target.value = ''
  }

  async function handleDeleteCandidate(id) {
    if (!window.confirm('Delete this candidate and all their applications? This cannot be undone.')) return
    await runTask('Delete Candidate', async () => {
      await api(`/candidates/${id}`, { method: 'DELETE' })
      if (selectedCandidate?.id === id) setSelectedCandidate(null)
      loadCandidates()
    })
  }

  return (
    <div className="two-col">

      {/* ── Column 1: Candidate list ── */}
      <div>
        <div className="card">
          <div className="card-header">
            <div>
              <p className="card-title">Talent Pool</p>
              <p className="card-subtitle">{candidates.length} candidate{candidates.length !== 1 ? 's' : ''}</p>
            </div>
            <div className="btn-row">
              <button className="btn-ghost btn-sm" onClick={loadCandidates}>↺</button>
              <button className="btn-primary btn-sm" onClick={() => setShowAddForm(v => !v)}>
                {showAddForm ? 'Cancel' : '+ Add'}
              </button>
            </div>
          </div>

          {showAddForm && (
            <div className="card-body">
              <form onSubmit={handleCreateManual}>
                <div className="field">
                  <label>Name</label>
                  <input placeholder="Full name" value={manualForm.name}
                    onChange={e => setManualForm(p => ({ ...p, name: e.target.value }))} />
                </div>
                <div className="field">
                  <label>Email</label>
                  <input type="email" placeholder="email@example.com" value={manualForm.email}
                    onChange={e => setManualForm(p => ({ ...p, email: e.target.value }))} />
                </div>
                <div className="field">
                  <label>Resume Text</label>
                  <textarea placeholder="Paste resume text here…" value={manualForm.resume_text}
                    onChange={e => setManualForm(p => ({ ...p, resume_text: e.target.value }))} required />
                </div>
                <button type="submit" className="btn-primary" style={{ width: '100%' }}>Add Candidate</button>
              </form>

              <hr className="divider" />
              <p className="section-label">Or upload PDFs</p>
              <div className="field">
                <label>PDF files</label>
                <input type="file" accept="application/pdf" multiple onChange={handleUploadPdfs} />
              </div>
              <div className="field">
                <label>Entire folder of PDFs</label>
                <input type="file" webkitdirectory="" directory="" onChange={handleUploadPdfs} />
                <p className="hint">Candidates are de-duplicated by email and resume hash.</p>
              </div>
            </div>
          )}

          <div className="scroll-list">
            {candidates.map(c => (
              <div key={c.id}
                className={`list-item ${selectedCandidate?.id === c.id ? 'selected' : ''}`}
                onClick={() => setSelectedCandidate(c)}>
                <div className="list-item-main">
                  <div className="list-item-name">{c.name || '(no name)'}</div>
                  <div className="list-item-meta">{c.email || 'no email'} · #{c.id}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <StageBadge stage={c.stage} />
                  <button className="btn-danger btn-sm" title="Delete candidate"
                    onClick={e => { e.stopPropagation(); handleDeleteCandidate(c.id); }}>✕</button>
                </div>
              </div>
            ))}
            {!candidates.length && <div className="list-empty">No candidates yet. Add one above.</div>}
          </div>
        </div>
      </div>

      {/* ── Column 2: Candidate detail ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {selectedCandidate ? (
          <>
            <div className="card">
              <div className="card-header">
                <div>
                  <p className="card-title">{selectedCandidate.name || `Candidate #${selectedCandidate.id}`}</p>
                  <p className="card-subtitle">#{selectedCandidate.id}</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <StageBadge stage={selectedCandidate.stage} />
                  <button className="btn-danger btn-sm"
                    onClick={() => handleDeleteCandidate(selectedCandidate.id)}>Delete</button>
                </div>
              </div>
              <div className="card-body">
                <div className="info-row">
                  <span>Email: <strong>{selectedCandidate.email || '—'}</strong></span>
                  <span>Processing: <strong>{selectedCandidate.processing_status}</strong></span>
                  {selectedCandidate.text_extraction_method && (
                    <span>Extracted via: <strong>{selectedCandidate.text_extraction_method}</strong></span>
                  )}
                </div>
                {selectedCandidate.extraction_error && (
                  <p style={{ color: 'var(--danger)', fontSize: '0.82rem' }}>{selectedCandidate.extraction_error}</p>
                )}
                {selectedCandidate.resume_text && (
                  <div className="field">
                    <label>Resume excerpt</label>
                    <pre className="json-view" style={{ fontSize: '0.78rem' }}>
                      {selectedCandidate.resume_text.slice(0, 800)}{selectedCandidate.resume_text.length > 800 ? '\n…' : ''}
                    </pre>
                  </div>
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <div>
                  <p className="card-title">Applications</p>
                  <p className="card-subtitle">Jobs this candidate has applied to</p>
                </div>
                <button className="btn-ghost btn-sm" onClick={() => loadCandidateApps(selectedCandidate.id)}>↺</button>
              </div>
              <div className="scroll-list">
                {candidateApps.map(app => (
                  <div key={app.id}
                    className={`list-item ${selectedCandidateApp?.id === app.id ? 'selected' : ''}`}
                    onClick={() => setSelectedCandidateApp(selectedCandidateApp?.id === app.id ? null : app)}
                    style={{ cursor: 'pointer' }}>
                    <div className="list-item-main">
                      <div className="list-item-name">{jobTitle(app.job_id)}</div>
                      <div className="list-item-meta">App #{app.id}</div>
                    </div>
                    <StageBadge stage={app.stage} />
                    {app.score != null && <ScorePill score={app.score} />}
                    <OutreachBadge status={app.outreach_status} />
                  </div>
                ))}
                {!candidateApps.length && (
                  <div className="list-empty">Not assigned to any job yet. Go to the Jobs tab to assign.</div>
                )}
              </div>
              {selectedCandidateApp && (
                <div className="card-body" style={{ borderTop: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <p className="section-label" style={{ margin: 0 }}>Score breakdown — {jobTitle(selectedCandidateApp.job_id)}</p>
                    <button className="btn-ghost btn-sm" onClick={() => setSelectedCandidateApp(null)}>✕</button>
                  </div>
                  <ScoreBreakdown app={selectedCandidateApp} />
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="card">
            <div className="card-body" style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--muted)' }}>
              <p style={{ fontSize: '2rem', margin: '0 0 8px' }}>👤</p>
              <p style={{ margin: 0 }}>Select a candidate from the list to view their profile and applications.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Settings view ───────────────────────────────────────────────────────────

// ─── JD Quality Report widget ────────────────────────────────────────────────

const SEVERITY_CONFIG = {
  critical:   { cls: 'badge-red',    label: 'Critical',    color: 'var(--danger, #f04438)' },
  warning:    { cls: 'badge-yellow', label: 'Warning',     color: 'var(--warning, #f79009)' },
  suggestion: { cls: 'badge-blue',   label: 'Suggestion',  color: 'var(--primary, #4f46e5)' },
}

const CATEGORY_LABELS = {
  vague_requirement:    'Vague Requirement',
  skill_stacking:       'Skill Stacking',
  unrealistic_seniority:'Unrealistic Seniority',
  biased_language:      'Biased Language',
  missing_information:  'Missing Information',
  contradictory:        'Contradictory',
  scope_creep:          'Scope Creep',
  other:                'Other',
}

function JDQualityReport({ report, onClose }) {
  const scoreColor = report.overall_score >= 85 ? 'var(--success, #12b76a)'
    : report.overall_score >= 70 ? 'var(--warning, #f79009)'
    : report.overall_score >= 41 ? 'var(--warning-dark, #dc6803)'
    : 'var(--danger, #f04438)'

  return (
    <div>
      <div className="card-header" style={{ padding: '10px 14px 8px' }}>
        <div>
          <p className="card-title" style={{ fontSize: '0.85rem' }}>JD Quality Report</p>
          <p className="card-subtitle">
            Score:&nbsp;
            <strong style={{ color: scoreColor }}>{report.overall_score}/100</strong>
            &nbsp;·&nbsp;{report.issues.length} issue{report.issues.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button className="btn-ghost btn-sm" onClick={onClose}>✕</button>
      </div>

      <div className="card-body" style={{ paddingTop: '6px' }}>
        <p style={{ fontSize: '0.82rem', color: 'var(--text)', lineHeight: 1.5, marginBottom: '12px' }}>
          {report.summary}
        </p>

        {report.issues.length === 0 && (
          <p style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>No issues found — this JD looks great.</p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {report.issues.map((issue, i) => {
            const cfg = SEVERITY_CONFIG[issue.severity] || SEVERITY_CONFIG.suggestion
            return (
              <div key={i} style={{
                borderLeft: `3px solid ${cfg.color}`,
                paddingLeft: '10px',
                paddingTop: '4px',
                paddingBottom: '4px',
              }}>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '4px', flexWrap: 'wrap' }}>
                  <span className={`badge ${cfg.cls}`}>{cfg.label}</span>
                  <span className="badge badge-gray">{CATEGORY_LABELS[issue.category] || issue.category}</span>
                </div>
                {issue.quote && (
                  <blockquote style={{
                    margin: '4px 0',
                    fontSize: '0.78rem',
                    fontStyle: 'italic',
                    color: 'var(--muted)',
                    borderLeft: 'none',
                    padding: 0,
                  }}>
                    "{issue.quote}"
                  </blockquote>
                )}
                <p style={{ fontSize: '0.82rem', margin: '2px 0', color: 'var(--text)' }}>{issue.explanation}</p>
                <p style={{ fontSize: '0.8rem', margin: '2px 0', color: 'var(--primary)' }}>
                  ✦ {issue.suggestion}
                </p>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Recruiter Notes widget ──────────────────────────────────────────────────

function RecruiterNotes({ app, onSaved }) {
  const [notes, setNotes] = useState(app?.recruiter_notes ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Sync when app changes
  useEffect(() => { setNotes(app?.recruiter_notes ?? '') }, [app?.id, app?.recruiter_notes])

  async function handleSave() {
    setSaving(true)
    try {
      const updated = await api(`/applications/${app.id}/notes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      })
      if (onSaved) onSaved(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      alert('Failed to save notes: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card-body" style={{ borderTop: '1px solid var(--border)' }}>
      <p className="section-label">Recruiter Notes</p>
      <textarea
        value={notes}
        onChange={e => setNotes(e.target.value)}
        rows={3}
        placeholder="Add internal notes about this candidate…"
        style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit', fontSize: '0.85rem', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', boxSizing: 'border-box' }}
      />
      <div className="btn-row" style={{ marginTop: '6px' }}>
        <button className="btn-primary btn-sm" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Notes'}
        </button>
      </div>
    </div>
  )
}

// ─── Search view ─────────────────────────────────────────────────────────────

const SEARCH_TYPE_LABELS = { resumes: '📄 Resumes', jobs: '💼 Jobs', notes: '📝 Notes' }
const TYPE_BADGE = { resume: 'badge-blue', job: 'badge-purple', note: 'badge-green' }

function SearchView() {
  const [q, setQ] = useState('')
  const [types, setTypes] = useState(['resumes', 'jobs', 'notes'])
  const [hits, setHits] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  function toggleType(t) {
    setTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])
  }

  async function handleSearch(e) {
    e.preventDefault()
    if (!q.trim()) return
    setLoading(true)
    setError(null)
    try {
      const results = await api('/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: q.trim(), types, limit: 20 }),
      })
      setHits(results)
    } catch (err) {
      setError(err.message)
      setHits(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="two-col" style={{ maxWidth: '760px' }}>
      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <div className="card-header"><p className="card-title">Semantic Search</p></div>
        <div className="card-body">
          <form onSubmit={handleSearch} style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search across resumes, job descriptions, and recruiter notes…"
              style={{ flex: '1 1 300px', minWidth: '200px' }}
              autoFocus
            />
            <button className="btn-primary" type="submit" disabled={loading || !q.trim()}>
              {loading ? 'Searching…' : '🔍 Search'}
            </button>
          </form>
          <div style={{ display: 'flex', gap: '12px', marginTop: '10px', flexWrap: 'wrap' }}>
            {Object.entries(SEARCH_TYPE_LABELS).map(([key, label]) => (
              <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.83rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={types.includes(key)} onChange={() => toggleType(key)} />
                {label}
              </label>
            ))}
          </div>
          <p className="hint" style={{ marginTop: '8px' }}>
            Results are ranked by semantic similarity. First search loads the embedding model (~25 MB, one-time download).
          </p>
        </div>
      </div>

      {error && (
        <div className="card" style={{ gridColumn: '1 / -1', borderColor: 'var(--danger)' }}>
          <div className="card-body"><p style={{ color: 'var(--danger)', margin: 0 }}>{error}</p></div>
        </div>
      )}

      {hits !== null && (
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <div className="card-header">
            <p className="card-title">Results</p>
            <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{hits.length} hit{hits.length !== 1 ? 's' : ''}</span>
          </div>
          {hits.length === 0
            ? <div className="card-body"><p style={{ color: 'var(--muted)', margin: 0 }}>No results found.</p></div>
            : hits.map((hit, i) => (
              <div key={i} className="card-body" style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                  <span className={`badge ${TYPE_BADGE[hit.type] || 'badge-gray'}`}>{hit.type}</span>
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{hit.label}</span>
                  <span style={{ marginLeft: 'auto', fontSize: '0.8rem', color: hit.score >= 0.7 ? 'var(--success)' : hit.score >= 0.45 ? 'var(--warning)' : 'var(--muted)' }}>
                    {(hit.score * 100).toFixed(0)}% match
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--muted)', lineHeight: 1.5 }}>{hit.snippet}</p>
              </div>
            ))
          }
        </div>
      )}
    </div>
  )
}

const TONE_PRESETS = [
  'friendly and concise',
  'professional and formal',
  'casual and enthusiastic',
  'direct and brief',
  'warm and personable',
]

function SettingsView({ runTask, settings, onSave }) {
  const [form, setForm] = useState(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (settings && !form) setForm({ ...settings })
  }, [settings])

  if (!form) return <div className="card"><div className="card-body" style={{ color: 'var(--muted)' }}>Loading settings…</div></div>

  function field(key, label, input) {
    return (
      <div className="field" key={key}>
        <label>{label}</label>
        {input}
      </div>
    )
  }

  async function handleSave(e) {
    e.preventDefault()
    await runTask('Save settings', async () => {
      await onSave(form)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    })
  }

  return (
    <div style={{ maxWidth: '640px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>

      <div className="card">
        <div className="card-header">
          <div>
            <p className="card-title">Outreach Defaults</p>
            <p className="card-subtitle">Used by the AI pipeline and batch scoring unless overridden per-run</p>
          </div>
        </div>
        <div className="card-body">
          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

            {field('sender_name', 'Sender name',
              <input value={form.sender_name} onChange={e => setForm(f => ({ ...f, sender_name: e.target.value }))}
                placeholder="e.g. Alex from TechCorp" />
            )}

            {field('sender_company', 'Company name',
              <input value={form.sender_company} onChange={e => setForm(f => ({ ...f, sender_company: e.target.value }))}
                placeholder="e.g. TechCorp" />
            )}

            {field('tone', 'Email tone',
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {TONE_PRESETS.map(t => (
                    <button type="button" key={t}
                      className={form.tone === t ? 'btn-primary btn-sm' : 'btn-gray btn-sm'}
                      onClick={() => setForm(f => ({ ...f, tone: t }))}>
                      {t}
                    </button>
                  ))}
                </div>
                <input value={form.tone} onChange={e => setForm(f => ({ ...f, tone: e.target.value }))}
                  placeholder="or type a custom tone…" />
              </div>
            )}

            <div className="divider" />

            {field('default_top_k', 'Default Top-K (batch)',
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <input type="number" min={1} max={50} value={form.default_top_k}
                  onChange={e => setForm(f => ({ ...f, default_top_k: Number(e.target.value) }))}
                  style={{ width: '80px' }} />
                <span style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>
                  Draft outreach for the top N scored candidates when running a batch
                </span>
              </div>
            )}

            {field('require_approval', 'Require approval before sending',
              <label className="checkbox-field">
                <input type="checkbox" checked={form.require_approval}
                  onChange={e => setForm(f => ({ ...f, require_approval: e.target.checked }))} />
                <span>Pause pipeline and wait for human approval before marking outreach as approved</span>
              </label>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <button type="submit" className="btn-primary">Save settings</button>
              {saved && <span style={{ color: 'var(--success)', fontSize: '0.85rem', fontWeight: 500 }}>✓ Saved</span>}
            </div>
          </form>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <p className="card-title">Current values</p>
        </div>
        <div className="card-body">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <tbody>
              {Object.entries(form).map(([k, v]) => (
                <tr key={k} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 12px 6px 0', color: 'var(--muted)', width: '40%', fontWeight: 500 }}>
                    {k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                  </td>
                  <td style={{ padding: '6px 0', wordBreak: 'break-word' }}>
                    {typeof v === 'boolean'
                      ? <span style={{ color: v ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>{String(v)}</span>
                      : String(v)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  )
}
