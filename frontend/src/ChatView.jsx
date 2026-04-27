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
        <div key={i} style={{ overflowX: 'auto', margin: '8px 0' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.82rem' }}>
            <thead>
              <tr>
                {headers.map((h, hi) => (
                  <th key={hi} style={{ padding: '5px 10px', borderBottom: '2px solid var(--border)', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {inlineFormat(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} style={{ borderBottom: '1px solid var(--border)', background: ri % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.02)' }}>
                  {row.map((cell, ci) => (
                    <td key={ci} style={{ padding: '4px 10px', fontSize: '0.81rem' }}>{inlineFormat(cell)}</td>
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
      elements.push(<p key={i} style={{ fontWeight: 700, fontSize: '0.88rem', margin: '12px 0 4px', color: 'var(--text)' }}>{inlineFormat(line.slice(4))}</p>)
      i++; continue
    }
    // H2
    if (line.startsWith('## ')) {
      elements.push(<p key={i} style={{ fontWeight: 700, fontSize: '0.92rem', margin: '14px 0 4px', color: 'var(--text)' }}>{inlineFormat(line.slice(3))}</p>)
      i++; continue
    }
    // H1
    if (line.startsWith('# ')) {
      elements.push(<p key={i} style={{ fontWeight: 700, fontSize: '0.96rem', margin: '14px 0 4px', color: 'var(--text)' }}>{inlineFormat(line.slice(2))}</p>)
      i++; continue
    }

    // Bullet list item
    if (/^[-*]\s/.test(line)) {
      const listItems = []
      while (i < lines.length && /^[-*]\s/.test(lines[i])) {
        listItems.push(<li key={i} style={{ marginBottom: '2px' }}>{inlineFormat(lines[i].slice(2))}</li>)
        i++
      }
      elements.push(<ul key={`ul-${i}`} style={{ margin: '6px 0', paddingLeft: '18px', fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: '2px' }}>{listItems}</ul>)
      continue
    }

    // Numbered list item
    if (/^\d+\.\s/.test(line)) {
      const listItems = []
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        listItems.push(<li key={i} style={{ marginBottom: '2px' }}>{inlineFormat(lines[i].replace(/^\d+\.\s/, ''))}</li>)
        i++
      }
      elements.push(<ol key={`ol-${i}`} style={{ margin: '6px 0', paddingLeft: '20px', fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: '2px' }}>{listItems}</ol>)
      continue
    }

    // Blank line
    if (!line.trim()) {
      elements.push(<div key={i} style={{ height: '6px' }} />)
      i++; continue
    }

    // Normal paragraph
    elements.push(<p key={i} style={{ margin: '3px 0', fontSize: '0.87rem', lineHeight: 1.55 }}>{inlineFormat(line)}</p>)
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
      parts.push(<strong key={m.index}>{tok.slice(2, -2)}</strong>)
    } else if (tok.startsWith('`')) {
      parts.push(
        <code key={m.index} style={{ background: 'rgba(0,0,0,0.07)', borderRadius: '3px', padding: '1px 4px', fontSize: '0.82em', fontFamily: 'monospace' }}>
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
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '8px' }}>
      {unique.map((t, i) => (
        <span key={i} style={{
          background: '#eef2ff', color: '#4338ca', border: '1px solid #c7d2fe',
          borderRadius: '999px', padding: '2px 9px', fontSize: '0.7rem', fontWeight: 500,
        }}>
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
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '12px' }}>
        <div style={{
          background: 'var(--primary)', color: '#fff', borderRadius: '16px 16px 4px 16px',
          padding: '10px 14px', maxWidth: '72%', fontSize: '0.87rem', lineHeight: 1.5,
          boxShadow: '0 1px 4px rgba(79,70,229,0.25)',
        }}>
          {msg.content}
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '12px' }}>
        <div style={{
          background: '#fee2e2', color: '#991b1b', borderRadius: '16px 16px 16px 4px',
          padding: '10px 14px', maxWidth: '80%', fontSize: '0.85rem',
          border: '1px solid #fca5a5',
        }}>
          {msg.content}
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '12px', gap: '8px', alignItems: 'flex-start' }}>
      <div style={{
        width: 28, height: 28, borderRadius: '50%', background: '#4f46e5',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '0.75rem', flexShrink: 0, marginTop: '2px',
      }}>
        🤖
      </div>
      <div style={{ maxWidth: '80%' }}>
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: '4px 16px 16px 16px',
          padding: '10px 14px', boxShadow: 'var(--shadow)',
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
    <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '12px', gap: '8px', alignItems: 'flex-start' }}>
      <div style={{
        width: 28, height: 28, borderRadius: '50%', background: '#4f46e5',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '0.75rem', flexShrink: 0,
      }}>🤖</div>
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: '4px 16px 16px 16px', padding: '12px 16px',
        boxShadow: 'var(--shadow)', display: 'flex', gap: '5px', alignItems: 'center',
      }}>
        {[0, 1, 2].map(i => (
          <span key={i} style={{
            width: 7, height: 7, borderRadius: '50%', background: 'var(--primary)',
            display: 'inline-block',
            animation: 'bounce 1.1s infinite',
            animationDelay: `${i * 0.18}s`,
          }} />
        ))}
        <style>{`@keyframes bounce { 0%,80%,100%{transform:translateY(0);opacity:.5} 40%{transform:translateY(-5px);opacity:1} }`}</style>
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
    <div style={{ display: 'flex', height: 'calc(100vh - 112px)', gap: '20px' }}>

      {/* Left panel: chat */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

        {/* Chat header */}
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px 10px 0 0',
          padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          boxShadow: 'var(--shadow)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1.2rem' }}>🤖</span>
            <div>
              <p style={{ margin: 0, fontWeight: 700, fontSize: '0.9rem' }}>Recruiter Assistant</p>
              <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--muted)' }}>
                Powered by {(import.meta.env.VITE_API_BASE_URL || 'OpenRouter')} · tool-calling agent
              </p>
            </div>
          </div>
          <button className="btn-ghost btn-sm" onClick={clearChat} title="Clear chat">
            ↺ Clear
          </button>
        </div>

        {/* Message list */}
        <div style={{
          flex: 1, overflowY: 'auto',
          background: 'var(--bg)', border: '1px solid var(--border)', borderTop: 'none',
          padding: '16px', minHeight: 0,
        }}>
          {messages.map((msg, i) => <MessageBubble key={i} msg={msg} />)}
          {loading && <TypingIndicator />}
          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)', borderTop: 'none',
          borderRadius: '0 0 10px 10px', padding: '12px',
          display: 'flex', gap: '8px', alignItems: 'flex-end',
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
        }}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about candidates, jobs, or scores… (Enter to send, Shift+Enter for newline)"
            rows={2}
            disabled={loading}
            style={{
              flex: 1, resize: 'none', fontFamily: 'inherit', fontSize: '0.87rem',
              padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border)',
              background: loading ? 'var(--bg)' : 'var(--surface)', color: 'var(--text)',
              outline: 'none', lineHeight: 1.5, boxSizing: 'border-box',
              transition: 'border-color 0.15s',
            }}
            onFocus={e => { e.target.style.borderColor = 'var(--border-focus)' }}
            onBlur={e => { e.target.style.borderColor = 'var(--border)' }}
          />
          <button
            className="btn-primary"
            onClick={() => sendMessage()}
            disabled={loading || !input.trim()}
            style={{ flexShrink: 0, height: '40px', padding: '0 18px', alignSelf: 'flex-end' }}
          >
            {loading ? '…' : '↑ Send'}
          </button>
        </div>
      </div>

      {/* Right panel: suggested prompts */}
      <div style={{ width: '230px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div className="card" style={{ padding: 0 }}>
          <div className="card-header" style={{ paddingBottom: '8px' }}>
            <p className="card-title">Suggested prompts</p>
          </div>
          <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {SUGGESTED_PROMPTS.map((p, i) => (
              <button key={i} onClick={() => handleSuggest(p)}
                disabled={loading}
                style={{
                  background: 'var(--bg)', border: '1px solid var(--border)',
                  borderRadius: '8px', padding: '8px 10px', fontSize: '0.78rem',
                  color: 'var(--text)', textAlign: 'left', cursor: 'pointer',
                  lineHeight: 1.5, width: '100%', whiteSpace: 'normal',
                  wordBreak: 'break-word', display: 'block',
                  transition: 'border-color 0.15s, background 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.background = '#eef2ff' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--bg)' }}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="card" style={{ padding: 0 }}>
          <div className="card-header" style={{ paddingBottom: '8px' }}>
            <p className="card-title">Available tools</p>
          </div>
          <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {Object.entries(TOOL_LABELS).map(([key, label]) => (
              <div key={key} style={{ fontSize: '0.76rem' }}>
                <div style={{ fontWeight: 600, marginBottom: '1px' }}>{label}</div>
                <div style={{ color: 'var(--muted)', fontFamily: 'monospace', fontSize: '0.7rem' }}>{key}()</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
