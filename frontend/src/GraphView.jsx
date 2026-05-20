import { useEffect, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
  Handle,
  Position,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '')

async function apiFetch(path) {
  const res = await fetch(`${API_BASE}${path}`)
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return text ? JSON.parse(text) : null
}

function scoreColor(score) {
  if (score == null) return 'var(--muted-light)'
  if (score >= 70) return 'var(--success)'
  if (score >= 40) return 'var(--warning)'
  return 'var(--danger)'
}

// ─── Custom node: Job ────────────────────────────────────────────────────────

function JobNode({ data }) {
  return (
    <div style={{
      background: 'linear-gradient(135deg, var(--primary) 0%, hsl(var(--primary-h), var(--primary-s), 58%) 100%)',
      color: '#fff',
      borderRadius: '12px',
      padding: '14px 20px',
      minWidth: '200px',
      boxShadow: '0 8px 18px var(--primary-glow)',
      border: 'none',
      cursor: 'pointer',
    }}>
      <Handle type="source" position={Position.Right} style={{ background: 'var(--primary-light)', border: '2.5px solid var(--surface)', width: 9, height: 9 }} />
      <div style={{ fontWeight: 700, fontSize: '0.88rem', marginBottom: '4px', lineHeight: 1.3, fontFamily: 'var(--font-headings)' }}>{data.label}</div>
      <div style={{ fontSize: '0.72rem', opacity: 0.85, marginBottom: data.categories?.length ? '8px' : 0 }}>
        {data.applicants} applicant{data.applicants !== 1 ? 's' : ''}
      </div>
      {data.categories?.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
          {data.categories.map((cat, i) => (
            <span key={i} style={{
              background: 'rgba(255, 255, 255, 0.16)', borderRadius: '4px',
              padding: '2px 6px', fontSize: '0.64rem', fontWeight: 600,
            }}>
              {cat}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Custom node: Candidate ──────────────────────────────────────────────────

function CandidateNode({ data }) {
  const color = scoreColor(data.score)
  return (
    <div style={{
      background: 'var(--surface)',
      color: 'var(--text)',
      borderRadius: '12px',
      padding: '12px 16px',
      minWidth: '180px',
      boxShadow: 'var(--shadow-sm)',
      border: '1.5px solid var(--border)',
      borderLeft: `4.5px solid ${color}`,
      cursor: 'pointer',
    }}>
      <Handle type="target" position={Position.Left} style={{ background: color, border: '2px solid var(--surface)', width: 8, height: 8 }} />
      {data.showSkills && (
        <Handle type="source" position={Position.Right} style={{ background: 'var(--success)', border: '2px solid var(--surface)', width: 8, height: 8 }} />
      )}
      <div style={{ fontWeight: 700, fontSize: '0.84rem', marginBottom: '6px', lineHeight: 1.3, color: 'var(--text)' }}>{data.label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        {data.score != null
          ? <span className={`badge ${data.score >= 70 ? 'badge-green' : data.score >= 40 ? 'badge-yellow' : 'badge-red'}`} style={{
              fontSize: '0.68rem', padding: '1px 6px', fontWeight: 700,
            }}>
              {data.score.toFixed(0)} Score
            </span>
          : <span style={{ fontSize: '0.7rem', color: 'var(--muted-light)', fontWeight: 500 }}>not scored</span>
        }
        <span style={{ fontSize: '0.7rem', color: 'var(--muted)', marginLeft: 'auto', fontWeight: 500 }}>{data.stage}</span>
      </div>
    </div>
  )
}

// ─── Custom node: Skill ──────────────────────────────────────────────────────

function SkillNode({ data }) {
  return (
    <div style={{
      background: 'var(--success-subtle)',
      color: 'var(--success-text)',
      borderRadius: '999px',
      padding: '4px 12px',
      fontSize: '0.71rem',
      fontWeight: 600,
      border: '1px solid var(--success-border)',
      whiteSpace: 'nowrap',
      cursor: 'default',
    }}>
      <Handle type="target" position={Position.Left} style={{ background: 'var(--success)', border: 'none', width: 6, height: 6 }} />
      {data.label}
    </div>
  )
}

const NODE_TYPES = { job: JobNode, candidate: CandidateNode, skill: SkillNode }

// ─── Main GraphView ──────────────────────────────────────────────────────────

export default function GraphView() {
  const [jobs, setJobs] = useState([])
  const [candidates, setCandidates] = useState([])
  const [applications, setApplications] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedJobId, setSelectedJobId] = useState('all')
  const [showSkills, setShowSkills] = useState(false)
  const [selectedNode, setSelectedNode] = useState(null)

  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])

  // ── Load all data ──────────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [jobData, candidateData] = await Promise.all([
          apiFetch('/jobs'),
          apiFetch('/candidates?limit=500'),
        ])
        const safeJobs = jobData || []
        const safeCands = candidateData || []
        setJobs(safeJobs)
        setCandidates(safeCands)

        const appResults = await Promise.all(safeJobs.map(j => apiFetch(`/jobs/${j.id}/applications`)))
        setApplications(appResults.flat())
      } catch (e) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // ── Rebuild graph when data / filters change ───────────────────────────────
  useEffect(() => {
    if (loading) return

    const filteredJobs = selectedJobId === 'all'
      ? jobs
      : jobs.filter(j => j.id === Number(selectedJobId))

    const filteredApps = applications.filter(a => filteredJobs.some(j => j.id === a.job_id))
    const candidateIdsInGraph = new Set(filteredApps.map(a => a.candidate_id))
    const filteredCandidates = candidates.filter(c => candidateIdsInGraph.has(c.id))

    // Best score per candidate across filtered jobs
    const bestScore = {}
    filteredApps.forEach(app => {
      if (app.score != null) {
        if (bestScore[app.candidate_id] == null || app.score > bestScore[app.candidate_id]) {
          bestScore[app.candidate_id] = app.score
        }
      }
    })

    const sortedCandidates = [...filteredCandidates].sort((a, b) => {
      return (bestScore[b.id] ?? -1) - (bestScore[a.id] ?? -1)
    })

    const JOB_X = 60
    const CAND_X = 460
    const SKILL_X = 800
    const JOB_SPACING = 180
    const CAND_SPACING = 110
    const SKILL_SPACING = 32

    const newNodes = []
    const newEdges = []

    // Job nodes
    filteredJobs.forEach((job, i) => {
      const jobApps = applications.filter(a => a.job_id === job.id)
      let categories = []
      if (job.analyzed_json) {
        try { categories = JSON.parse(job.analyzed_json).scoring_categories || [] } catch {}
      }
      newNodes.push({
        id: `job-${job.id}`,
        type: 'job',
        position: { x: JOB_X, y: i * JOB_SPACING + 40 },
        data: { label: job.title, applicants: jobApps.length, categories, raw: job },
      })
    })

    // Candidate nodes + optional skill nodes
    sortedCandidates.forEach((cand, i) => {
      let skills = []
      if (cand.extracted_json) {
        try { skills = JSON.parse(cand.extracted_json).skills || [] } catch {}
      }
      newNodes.push({
        id: `cand-${cand.id}`,
        type: 'candidate',
        position: { x: CAND_X, y: i * CAND_SPACING + 20 },
        data: {
          label: cand.name || `Candidate #${cand.id}`,
          score: bestScore[cand.id] ?? null,
          stage: cand.stage,
          showSkills,
          raw: cand,
        },
      })

      if (showSkills) {
        skills.slice(0, 5).forEach((skill, si) => {
          const skillId = `skill-${cand.id}-${si}`
          newNodes.push({
            id: skillId,
            type: 'skill',
            position: { x: SKILL_X, y: i * CAND_SPACING + si * SKILL_SPACING + 10 },
            data: { label: skill },
          })
          newEdges.push({
            id: `e-skill-${cand.id}-${si}`,
            source: `cand-${cand.id}`,
            target: skillId,
            style: { stroke: 'var(--success-border)', strokeWidth: 1, opacity: 0.6 },
            type: 'smoothstep',
          })
        })
      }
    })

    // Application edges: job → candidate
    filteredApps.forEach(app => {
      const color = scoreColor(app.score)
      newEdges.push({
        id: `e-app-${app.id}`,
        source: `job-${app.job_id}`,
        target: `cand-${app.candidate_id}`,
        type: 'smoothstep',
        label: app.score != null ? app.score.toFixed(0) : '',
        style: { stroke: color, strokeWidth: app.score != null ? 2.5 : 1 },
        labelStyle: { fill: color, fontWeight: 700, fontSize: '11px', fontFamily: 'var(--font-body)' },
        labelBgStyle: { fill: 'rgba(255, 255, 255, 0.95)', padding: '2px 4px' },
        labelBgPadding: [4, 3],
        labelBgBorderRadius: 4,
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
        animated: app.stage === 'Scoring',
      })
    })

    setNodes(newNodes)
    setEdges(newEdges)
  }, [jobs, candidates, applications, selectedJobId, showSkills, loading])

  // ── Node click → details panel ─────────────────────────────────────────────
  function onNodeClick(_, node) {
    setSelectedNode(node)
  }

  // ── Details panel ──────────────────────────────────────────────────────────
  function renderDetails() {
    if (!selectedNode) return (
      <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '40px 0', fontSize: '0.85rem' }}>
        Click any node to see details
      </div>
    )

    const { type, data } = selectedNode

    if (type === 'job') {
      const { raw } = data
      let analysis = null
      if (raw?.analyzed_json) { try { analysis = JSON.parse(raw.analyzed_json) } catch {} }
      return (
        <div>
          <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '12px', color: 'var(--text)', fontFamily: 'var(--font-headings)' }}>💼 {raw.title}</div>

          {analysis ? (
            <>
              <p className="section-label">Scoring Categories</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '12px' }}>
                {analysis.scoring_categories?.map((c, i) => (
                  <span key={i} className="badge badge-purple" style={{ fontSize: '0.7rem' }}>{c}</span>
                ))}
              </div>

              <p className="section-label">Required Skills</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '12px' }}>
                {analysis.required_skills?.map((s, i) => (
                  <span key={i} className="badge badge-blue" style={{ fontSize: '0.7rem' }}>{s}</span>
                ))}
              </div>

              {analysis.deal_breakers?.length > 0 && (
                <>
                  <p className="section-label" style={{ color: 'var(--danger-text)' }}>Deal-breakers</p>
                  <ul style={{ margin: '0 0 12px', paddingLeft: '16px', fontSize: '0.78rem', display: 'flex', flexDirection: 'column', gap: '3px', color: 'var(--text-2)' }}>
                    {analysis.deal_breakers.map((d, i) => <li key={i}>{d}</li>)}
                  </ul>
                </>
              )}

              <p className="section-label">Seniority</p>
              <span className="badge badge-gray">{analysis.seniority_level}</span>
            </>
          ) : (
            <p style={{ color: 'var(--muted)', fontSize: '0.8rem', lineHeight: 1.4 }}>
              No analysis cached yet — run the pipeline on a candidate for this job to populate.
            </p>
          )}

          <p className="section-label" style={{ marginTop: '14px' }}>Applicants</p>
          <p style={{ fontSize: '0.85rem', margin: 0, fontWeight: 600 }}>{data.applicants} candidates applied</p>
        </div>
      )
    }

    if (type === 'candidate') {
      const { raw } = data
      let extracted = null
      if (raw?.extracted_json) { try { extracted = JSON.parse(raw.extracted_json) } catch {} }
      const candApps = applications.filter(a => a.candidate_id === raw.id)

      return (
        <div>
          <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '4px', color: 'var(--text)', fontFamily: 'var(--font-headings)' }}>
            👤 {raw.name || `Candidate #${raw.id}`}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '12px' }}>
            {raw.email || 'no email'}
          </div>

          {extracted && (
            <>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
                {extracted.seniority && <span className="badge badge-gray">{extracted.seniority}</span>}
                {extracted.years_experience != null && (
                  <span className="badge badge-gray">{extracted.years_experience}y exp</span>
                )}
                {extracted.location && <span className="badge badge-gray">{extracted.location}</span>}
              </div>

              {extracted.headline && (
                <p style={{ fontSize: '0.8rem', color: 'var(--muted)', fontStyle: 'italic', margin: '0 0 12px', lineHeight: 1.4 }}>
                  "{extracted.headline}"
                </p>
              )}

              <p className="section-label">Skills</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '12px' }}>
                {extracted.skills?.slice(0, 14).map((s, i) => (
                  <span key={i} className="badge badge-green" style={{ fontSize: '0.68rem', padding: '2px 7px' }}>{s}</span>
                ))}
              </div>

              {extracted.highlights?.length > 0 && (
                <>
                  <p className="section-label">Highlights</p>
                  <ul style={{ margin: '0 0 12px', paddingLeft: '16px', fontSize: '0.78rem', display: 'flex', flexDirection: 'column', gap: '4px', color: 'var(--text-2)' }}>
                    {extracted.highlights.slice(0, 4).map((h, i) => <li key={i}>{h}</li>)}
                  </ul>
                </>
              )}
            </>
          )}

          {candApps.length > 0 && (
            <>
              <p className="section-label">Scores by Job</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                {candApps.map(app => {
                  const job = jobs.find(j => j.id === app.job_id)
                  const color = scoreColor(app.score)
                  return (
                    <div key={app.id} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      fontSize: '0.78rem', padding: '6px 0',
                      borderBottom: '1px solid var(--border)',
                    }}>
                      <span style={{ color: 'var(--text-2)', flex: 1, marginRight: '8px', fontWeight: 500 }}>
                        {job?.title || `Job #${app.job_id}`}
                      </span>
                      {app.score != null
                        ? <span style={{
                            background: color, color: '#fff', borderRadius: '999px',
                            padding: '1px 8px', fontWeight: 700, flexShrink: 0, fontSize: '0.7rem'
                          }}>{app.score.toFixed(0)}</span>
                        : <span style={{ color: 'var(--muted-light)' }}>—</span>
                      }
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )
    }

    if (type === 'skill') {
      return (
        <div style={{ fontSize: '0.9rem' }}>
          <span style={{ fontWeight: 700, color: 'var(--text)' }}>🔧 {selectedNode.data.label}</span>
          <p style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: '8px', lineHeight: 1.45 }}>
            Extracted skill identifier from candidate profile.
          </p>
        </div>
      )
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '60vh', color: 'var(--muted)', flexDirection: 'column', gap: '12px',
    }}>
      <span style={{ fontSize: '1.5rem' }}>⏳</span>
      <span>Loading graph data…</span>
    </div>
  )

  if (error) return (
    <div className="card">
      <div className="card-body">
        <p style={{ color: 'var(--danger)', margin: 0 }}>Failed to load graph: {error}</p>
      </div>
    </div>
  )

  const jobCount = nodes.filter(n => n.type === 'job').length
  const candCount = nodes.filter(n => n.type === 'candidate').length
  const appCount = edges.filter(e => e.id.startsWith('e-app')).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 170px)', gap: '12px', animation: 'fadeIn 0.25s ease' }}>

      {/* Controls bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '20px', paddingBottom: '2px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label style={{ fontSize: '0.8rem', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em' }}>Filter by job</label>
          <select value={selectedJobId} onChange={e => { setSelectedJobId(e.target.value); setSelectedNode(null) }}
            style={{ minWidth: '220px', fontSize: '0.83rem' }}>
            <option value="all">All Jobs</option>
            {jobs.map(j => <option key={j.id} value={j.id}>#{j.id} {j.title}</option>)}
          </select>
        </div>

        <label className="checkbox-field" style={{ fontSize: '0.82rem' }}>
          <input type="checkbox" checked={showSkills} onChange={e => setShowSkills(e.target.checked)} />
          <span>Show skill nodes</span>
        </label>

        <span style={{ fontSize: '0.8rem', color: 'var(--muted)', marginLeft: 'auto', fontWeight: 500 }}>
          <strong style={{ color: 'var(--text)' }}>{jobCount}</strong> jobs · <strong style={{ color: 'var(--text)' }}>{candCount}</strong> candidates · <strong style={{ color: 'var(--text)' }}>{appCount}</strong> edges
        </span>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '18px', paddingBottom: '4px', flexWrap: 'wrap', fontSize: '0.74rem', color: 'var(--muted)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: 10, height: 10, borderRadius: '3px', background: 'var(--primary)', display: 'inline-block' }} />
          Job
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: 10, height: 4, borderRadius: '2px', background: 'var(--success)', display: 'inline-block' }} />
          Score ≥ 70
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: 10, height: 4, borderRadius: '2px', background: 'var(--warning)', display: 'inline-block' }} />
          Score 40–69
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: 10, height: 4, borderRadius: '2px', background: 'var(--danger)', display: 'inline-block' }} />
          Score &lt; 40
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: 10, height: 4, borderRadius: '2px', background: 'var(--muted-light)', display: 'inline-block' }} />
          Not scored
        </span>
      </div>

      {/* Graph + details panel */}
      <div style={{ flex: 1, display: 'flex', gap: '20px', minHeight: 0 }}>

        {/* React Flow canvas */}
        <div style={{
          flex: 1, border: '1px solid var(--border)', borderRadius: '12px',
          overflow: 'hidden', background: 'var(--bg)', boxShadow: 'var(--shadow-sm)'
        }}>
          {nodes.length === 0
            ? (
              <div style={{
                height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexDirection: 'column', gap: '12px', color: 'var(--muted)',
              }}>
                <span style={{ fontSize: '2rem' }}>🕸️</span>
                <span style={{ fontSize: '0.9rem' }}>
                  No data to display. Create jobs, add candidates, and run the pipeline to populate the graph.
                </span>
              </div>
            )
            : (
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={onNodeClick}
                nodeTypes={NODE_TYPES}
                fitView
                fitViewOptions={{ padding: 0.25 }}
                minZoom={0.15}
                maxZoom={2.5}
                defaultEdgeOptions={{ type: 'smoothstep' }}
                proOptions={{ hideAttribution: true }}
              >
                <Background color="var(--border)" gap={24} size={1} />
                <Controls />
                <MiniMap
                  nodeColor={n => {
                    if (n.type === 'job') return 'var(--primary)'
                    if (n.type === 'skill') return 'var(--success)'
                    return scoreColor(n.data?.score)
                  }}
                  style={{ border: '1px solid var(--border)', borderRadius: '8px' }}
                />
              </ReactFlow>
            )
          }
        </div>

        {/* Details panel */}
        <div style={{
          width: '280px', flexShrink: 0,
          border: '1px solid var(--border)', borderRadius: '12px',
          background: 'var(--surface)', padding: '20px', overflowY: 'auto',
          boxShadow: 'var(--shadow)', display: 'flex', flexDirection: 'column'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', borderBottom: '1px solid var(--border)', paddingBottom: '10px' }}>
            <span className="section-label" style={{ margin: 0 }}>Details</span>
            {selectedNode && (
              <button className="btn-ghost btn-sm" onClick={() => setSelectedNode(null)} style={{ padding: '4px 8px', minWidth: 'auto' }}>✕</button>
            )}
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {renderDetails()}
          </div>
        </div>
      </div>
    </div>
  )
}
