import { useEffect, useRef, useState } from 'react'

const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '')

const SUGGESTED_PROMPTS = [
  'List all jobs and how many applicants each has',
  'Who are the top candidates for the first job?',
  'Search for candidates with Python and machine learning experience',
  'Explain the score for application #1',
  'Find candidates with leadership or management background',
]

// ─── Markdown-lite renderer ──────────────────────────────────────────────────
// Handles bold, inline code, headers, bullet lists, numbered lists, tables.

function renderMarkdown(text) {
  if (!text) return null
  const lines = text.split('\n')
  const elements = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Table detection: line contains | and next line is separator
    if (line.includes('|') && lines[i + 1] && /^\|?[\s\-|]+\|?$/.test(lines[i + 1])) {
      const tableLines = [line]
      i += 2 // skip separator
      while (i < lines.length && lines[i].includes('|')) {
        tableLines.push(lines[i])
        i++
      }
      const headers = tableLines[0].split('|').map(h => h.trim()).filter(Boolean)
      const rows = tableLines.slice(1).map(r => r.split('|').map(c => c.trim()).filter(Boolean))
      elements.push(
        <div key={i} style={{ overflowX: 'auto', margin: '12px 0', border: '1px solid var(--border)', borderRadius: '8px' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.8rem', background: 'var(--surface)' }}>
            <thead>
              <tr style={{ background: 'var(--bg)' }}>
                {headers.map((h, hi) => (
                  <th key={hi} style={{ padding: '8px 12px', borderBottom: '1.5px solid var(--border)', textAlign: 'left', fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap' }}>
                    {inlineFormat(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} style={{ borderBottom: ri === rows.length - 1 ? 'none' : '1px solid var(--border)', background: ri % 2 === 0 ? 'transparent' : 'var(--bg)' }}>
                  {row.map((cell, ci) => (
                    <td key={ci} style={{ padding: '8px 12px', color: 'var(--text-2)', fontSize: '0.8rem' }}>{inlineFormat(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      continue
    }

    // H3
    if (line.startsWith('### ')) {
      elements.push(<p key={i} style={{ fontWeight: 700, fontSize: '0.9rem', margin: '14px 0 6px', color: 'var(--text)', fontFamily: 'var(--font-headings)' }}>{inlineFormat(line.slice(4))}</p>)
      i++; continue
    }
    // H2
    if (line.startsWith('## ')) {
      elements.push(<p key={i} style={{ fontWeight: 700, fontSize: '0.95rem', margin: '16px 0 6px', color: 'var(--text)', fontFamily: 'var(--font-headings)' }}>{inlineFormat(line.slice(3))}</p>)
      i++; continue
    }
    // H1
    if (line.startsWith('# ')) {
      elements.push(<p key={i} style={{ fontWeight: 800, fontSize: '1rem', margin: '18px 0 6px', color: 'var(--text)', fontFamily: 'var(--font-headings)' }}>{inlineFormat(line.slice(2))}</p>)
      i++; continue
    }

    // Bullet list item
    if (/^[-*]\s/.test(line)) {
      const listItems = []
      while (i < lines.length && /^[-*]\s/.test(lines[i])) {
        listItems.push(<li key={i} style={{ marginBottom: '4px' }}>{inlineFormat(lines[i].slice(2))}</li>)
        i++
      }
      elements.push(<ul key={`ul-${i}`} style={{ margin: '8px 0', paddingLeft: '20px', fontSize: '0.84rem', color: 'var(--text-2)', display: 'flex', flexDirection: 'column', gap: '2px' }}>{listItems}</ul>)
      continue
    }

    // Numbered list item
    if (/^\d+\.\s/.test(line)) {
      const listItems = []
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        listItems.push(<li key={i} style={{ marginBottom: '4px' }}>{inlineFormat(lines[i].replace(/^\d+\.\s/, ''))}</li>)
        i++
      }
      elements.push(<ol key={`ol-${i}`} style={{ margin: '8px 0', paddingLeft: '20px', fontSize: '0.84rem', color: 'var(--text-2)', display: 'flex', flexDirection: 'column', gap: '2px' }}>{listItems}</ol>)
      continue
    }

    // Blank line
    if (!line.trim()) {
      elements.push(<div key={i} style={{ height: '8px' }} />)
      i++; continue
    }

    // Normal paragraph
    elements.push(<p key={i} style={{ margin: '4px 0', fontSize: '0.84rem', lineHeight: 1.6, color: 'var(--text-2)' }}>{inlineFormat(line)}</p>)
    i++
  }

  return <>{elements}</>
}

function inlineFormat(text) {
  // Split on **bold**, `code`, *italic*
  const parts = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g
  let last = 0
  let m
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith('**')) {
      parts.push(<strong key={m.index} style={{ color: 'var(--text)', fontWeight: 700 }}>{tok.slice(2, -2)}</strong>)
    } else if (tok.startsWith('`')) {
      parts.push(
        <code key={m.index} style={{ background: 'var(--surface-sub)', border: '1px solid var(--border)', borderRadius: '4px', padding: '2px 5px', fontSize: '0.78rem', fontFamily: 'monospace', color: 'var(--text-2)' }}>
          {tok.slice(1, -1)}
        </code>
      )
    } else {
      parts.push(<em key={m.index}>{tok.slice(1, -1)}</em>)
    }
    last = m.index + tok.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts.length === 1 && typeof parts[0] === 'string' ? parts[0] : <>{parts}</>
}

// ─── Tool usage pill ─────────────────────────────────────────────────────────

const TOOL_LABELS = {
  list_jobs: '💼 Listed jobs',
  search_candidates: '🔍 Searched resumes',
  get_top_candidates: '🏆 Ranked candidates',
  explain_score: '📊 Fetched score breakdown',
}

function ToolPills({ tools }) {
  if (!tools?.length) return null
  const unique = [...new Set(tools)]
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px' }}>
      {unique.map((t, i) => (
        <span key={i} className="badge badge-indigo" style={{ fontSize: '0.68rem', padding: '2px 8px' }}>
          {TOOL_LABELS[t] || t}
        </span>
      ))}
    </div>
  )
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({ msg }) {
  const isUser = msg.role === 'user'
  const isError = msg.role === 'error'

  if (isUser) {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
        <div style={{
          background: 'linear-gradient(135deg, var(--primary) 0%, hsl(var(--primary-h), var(--primary-s), 58%) 100%)',
          color: '#ffffff',
          borderRadius: '16px 16px 4px 16px',
          padding: '12px 16px',
          maxWidth: '70%',
          fontSize: '0.86rem',
          lineHeight: 1.5,
          fontWeight: 500,
          boxShadow: '0 4px 12px var(--primary-glow)',
        }}>
          {msg.content}
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '16px' }}>
        <div style={{
          background: 'var(--danger-subtle)',
          color: 'var(--danger-text)',
          borderRadius: '16px 16px 16px 4px',
          padding: '12px 16px',
          maxWidth: '75%',
          fontSize: '0.84rem',
          fontWeight: 500,
          border: '1px solid var(--danger-border)',
        }}>
          {msg.content}
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '16px', gap: '10px', alignItems: 'flex-start' }}>
      <div style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        background: 'linear-gradient(135deg, var(--primary) 0%, #4338ca 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '0.95rem',
        flexShrink: 0,
        boxShadow: '0 2px 8px var(--primary-glow)',
        border: '2px solid #ffffff'
      }}>
        🤖
      </div>
      <div style={{ maxWidth: '80%' }}>
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '4px 16px 16px 16px',
          padding: '12px 16px',
          boxShadow: 'var(--shadow-xs)',
          color: 'var(--text)',
        }}>
          {renderMarkdown(msg.content)}
        </div>
        <ToolPills tools={msg.tools_used} />
      </div>
    </div>
  )
}

// ─── Typing indicator ────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '16px', gap: '10px', alignItems: 'flex-start' }}>
      <div style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        background: 'linear-gradient(135deg, var(--primary) 0%, #4338ca 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '0.95rem',
        flexShrink: 0,
        boxShadow: '0 2px 8px var(--primary-glow)',
        border: '2px solid #ffffff'
      }}>🤖</div>
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '4px 16px 16px 16px',
        padding: '14px 18px',
        boxShadow: 'var(--shadow-xs)',
        display: 'flex',
        gap: '6px',
        alignItems: 'center',
      }}>
        {[0, 1, 2].map(i => (
          <span key={i} style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'var(--primary)',
            display: 'inline-block',
            animation: 'bounce 1.2s infinite',
            animationDelay: `${i * 0.18}s`,
          }} />
        ))}
        <style>{`@keyframes bounce { 0%,80%,100%{transform:translateY(0);opacity:.4} 40%{transform:translateY(-6px);opacity:1} }`}</style>
      </div>
    </div>
  )
}

// ─── Main ChatView ────────────────────────────────────────────────────────────

export default function ChatView() {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: "Hi! I'm your recruiting assistant. I can search candidate resumes, rank applicants for a job, and explain AI scoring decisions. What would you like to know?",
      tools_used: [],
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef(null)
  const textareaRef = useRef(null)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  async function sendMessage(text) {
    const userText = (text || input).trim()
    if (!userText || loading) return

    const newMessages = [...messages, { role: 'user', content: userText }]
    setMessages(newMessages)
    setInput('')
    setLoading(true)

    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .map(m => ({ role: m.role, content: m.content })),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.detail || `HTTP ${res.status}`)
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.reply,
        tools_used: data.tools_used || [],
      }])
    } catch (err) {
      setMessages(prev => [...prev, { role: 'error', content: `Error: ${err.message}` }])
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  function handleSuggest(prompt) {
    setInput(prompt)
    textareaRef.current?.focus()
  }

  function clearChat() {
    setMessages([{
      role: 'assistant',
      content: "Chat cleared. What would you like to know?",
      tools_used: [],
    }])
  }

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 170px)', gap: '20px', animation: 'fadeIn 0.25s ease' }}>

      {/* Left panel: chat */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

        {/* Chat header */}
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px 12px 0 0',
          padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          boxShadow: 'var(--shadow-sm)', zIndex: 10
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1.25rem' }}>🤖</span>
            <div>
              <p style={{ margin: 0, fontWeight: 700, fontSize: '0.88rem', color: 'var(--text)', fontFamily: 'var(--font-headings)' }}>Recruiter Assistant</p>
              <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--muted)' }}>
                Powered by {(import.meta.env.VITE_API_BASE_URL || 'OpenRouter')} · tool-calling agent
              </p>
            </div>
          </div>
          <button className="btn-ghost btn-sm" onClick={clearChat} title="Clear chat">
            Clear
          </button>
        </div>

        {/* Message list */}
        <div style={{
          flex: 1, overflowY: 'auto',
          background: 'var(--bg)', border: '1px solid var(--border)', borderTop: 'none',
          padding: '20px', minHeight: 0,
        }}>
          {messages.map((msg, i) => <MessageBubble key={i} msg={msg} />)}
          {loading && <TypingIndicator />}
          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)', borderTop: 'none',
          borderRadius: '0 0 12px 12px', padding: '14px',
          display: 'flex', gap: '10px', alignItems: 'flex-end',
          boxShadow: 'var(--shadow-sm)',
        }}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about candidates, jobs, or scores…"
            rows={2}
            disabled={loading}
            style={{
              flex: 1, resize: 'none', fontFamily: 'var(--font-body)', fontSize: '0.87rem',
              padding: '10px 14px', borderRadius: '8px', border: '1.5px solid var(--border)',
              background: loading ? 'var(--bg)' : 'var(--surface)', color: 'var(--text)',
              outline: 'none', lineHeight: 1.5, boxSizing: 'border-box',
              transition: 'all 0.15s',
            }}
            onFocus={e => { e.target.style.borderColor = 'var(--primary)'; e.target.style.boxShadow = '0 0 0 3px var(--primary-glow)' }}
            onBlur={e => { e.target.style.borderColor = 'var(--border)'; e.target.style.boxShadow = 'none' }}
          />
          <button
            className="btn-primary"
            onClick={() => sendMessage()}
            disabled={loading || !input.trim()}
            style={{ flexShrink: 0, height: '42px', padding: '0 20px', alignSelf: 'flex-end', borderRadius: '8px' }}
          >
            {loading ? '…' : 'Send'}
          </button>
        </div>
      </div>

      {/* Right panel: suggested prompts */}
      <div style={{ width: '240px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', flex: '1', minHeight: 0 }}>
          <div className="card-header" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
            <span className="card-title" style={{ fontSize: '0.84rem' }}>Suggested Prompts</span>
          </div>
          <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', flex: 1 }}>
            {SUGGESTED_PROMPTS.map((p, i) => (
              <button key={i} onClick={() => handleSuggest(p)}
                disabled={loading}
                style={{
                  background: 'var(--bg)', border: '1px solid var(--border)',
                  borderRadius: '8px', padding: '10px 12px', fontSize: '0.78rem',
                  color: 'var(--text-2)', textAlign: 'left', cursor: 'pointer',
                  lineHeight: 1.45, width: '100%', whiteSpace: 'normal',
                  wordBreak: 'break-word', display: 'block',
                  transition: 'all 0.15s ease',
                  fontWeight: 500
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.background = 'var(--primary-subtle)'; e.currentTarget.style.color = 'var(--primary)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--bg)'; e.currentTarget.style.color = 'var(--text-2)' }}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="card" style={{ flexShrink: 0 }}>
          <div className="card-header" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
            <span className="card-title" style={{ fontSize: '0.84rem' }}>Agent Capabilities</span>
          </div>
          <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {Object.entries(TOOL_LABELS).map(([key, label]) => (
              <div key={key} style={{ fontSize: '0.75rem', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span style={{ fontWeight: 650, color: 'var(--text)' }}>{label}</span>
                <span style={{ color: 'var(--muted)', fontFamily: 'monospace', fontSize: '0.68rem' }}>{key}()</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
