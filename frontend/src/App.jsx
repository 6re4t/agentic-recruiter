import { useEffect, useMemo, useState } from 'react'
import './App.css'

const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '')

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options)
  const text = await response.text()
  const data = text ? JSON.parse(text) : null

  if (!response.ok) {
    throw new Error(data?.detail || `HTTP ${response.status}`)
  }

  return data
}

function App() {
  const [jobs, setJobs] = useState([])
  const [candidates, setCandidates] = useState([])
  const [selectedJobId, setSelectedJobId] = useState('')
  const [selectedCandidateId, setSelectedCandidateId] = useState('')
  const [jobForm, setJobForm] = useState({ title: '', description: '', rubric: '' })
  const [manualCandidate, setManualCandidate] = useState({ name: '', email: '', resume_text: '' })
  const [requireApproval, setRequireApproval] = useState(true)
  const [resumeRunId, setResumeRunId] = useState('')
  const [topK, setTopK] = useState(3)
  const [status, setStatus] = useState('Ready')
  const [result, setResult] = useState(null)

  const selectedCandidate = useMemo(
    () => candidates.find((candidate) => String(candidate.id) === String(selectedCandidateId)),
    [candidates, selectedCandidateId],
  )

  async function refreshJobs() {
    const data = await api('/jobs')
    setJobs(data)
    if (!selectedJobId && data.length) {
      setSelectedJobId(String(data[0].id))
    }
  }

  async function refreshCandidates() {
    const data = await api('/candidates?limit=100')
    setCandidates(data)
    if (!selectedCandidateId && data.length) {
      setSelectedCandidateId(String(data[0].id))
    }
  }

  async function runTask(label, fn) {
    try {
      setStatus(`${label}...`)
      const out = await fn()
      setResult(out)
      setStatus(`${label} done`)
      return out
    } catch (error) {
      setStatus(`${label} failed: ${error.message}`)
      throw error
    }
  }

  useEffect(() => {
    runTask('Loading data', async () => {
      await Promise.all([refreshJobs(), refreshCandidates()])
      return { ok: true }
    }).catch(() => {})
  }, [])

  async function handleCreateJob(event) {
    event.preventDefault()
    await runTask('Creating job', async () => {
      await api('/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jobForm),
      })
      await refreshJobs()
      return { ok: true }
    })
  }

  async function handleCreateManualCandidate(event) {
    event.preventDefault()
    await runTask('Creating candidate', async () => {
      await api('/candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(manualCandidate),
      })
      await refreshCandidates()
      return { ok: true }
    })
  }

  async function handleUploadPdfs(event) {
    const files = Array.from(event.target.files || [])
    if (!files.length) {
      return
    }

    const pdfFiles = files.filter(
      (file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'),
    )
    if (!pdfFiles.length) {
      setStatus('Uploading PDFs failed: no PDF files found in selection')
      return
    }

    const form = new FormData()
    pdfFiles.forEach((file) => form.append('files', file))

    await runTask('Uploading PDFs', async () => {
      const out = await api('/candidates/upload_pdfs', {
        method: 'POST',
        body: form,
      })
      await refreshCandidates()
      return out
    })

    event.target.value = ''
  }

  async function handleRunGraph() {
    if (!selectedJobId || !selectedCandidateId) {
      return
    }

    await runTask('Running graph', async () => api('/agent/graph/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: Number(selectedJobId),
        candidate_id: Number(selectedCandidateId),
        require_approval: requireApproval,
      }),
    }))

    await refreshCandidates()
  }

  async function handleResumeGraph(approved) {
    if (!resumeRunId) {
      return
    }

    await runTask('Resuming graph', async () => api('/agent/graph/resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ run_id: Number(resumeRunId), approved }),
    }))

    await refreshCandidates()
  }

  async function handleBatchTopK() {
    if (!selectedJobId) {
      return
    }

    await runTask('Running batch top-k', async () => api('/agent/batch/topk_outreach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: Number(selectedJobId), top_k: Number(topK) || 1 }),
    }))

    await refreshCandidates()
  }

  async function handleSendEmail() {
    if (!selectedCandidateId) {
      return
    }

    await runTask('Sending outreach email', async () => api('/outreach/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidate_id: Number(selectedCandidateId) }),
    }))

    await refreshCandidates()
  }

  return (
    <div className="container">
      <h1>Agentic Recruiter UI</h1>
      <p className="small">API: {API_BASE}</p>

      <div className="grid">
        <section className="card">
          <h2>Create Job</h2>
          <form onSubmit={handleCreateJob}>
            <label>Title</label>
            <input
              value={jobForm.title}
              onChange={(event) => setJobForm((prev) => ({ ...prev, title: event.target.value }))}
              required
            />
            <label>Description</label>
            <textarea
              value={jobForm.description}
              onChange={(event) => setJobForm((prev) => ({ ...prev, description: event.target.value }))}
              required
            />
            <label>Rubric</label>
            <textarea
              value={jobForm.rubric}
              onChange={(event) => setJobForm((prev) => ({ ...prev, rubric: event.target.value }))}
              required
            />
            <div className="row">
              <button type="submit">Create Job</button>
              <button type="button" className="secondary" onClick={() => runTask('Refreshing jobs', refreshJobs)}>
                Refresh
              </button>
            </div>
          </form>

          <label>Jobs</label>
          <div className="list">
            {jobs.map((job) => (
              <div
                key={job.id}
                className={`list-item ${String(job.id) === String(selectedJobId) ? 'active' : ''}`}
                onClick={() => setSelectedJobId(String(job.id))}
              >
                <strong>#{job.id}</strong> {job.title}
              </div>
            ))}
            {!jobs.length && <div className="list-item">No jobs yet</div>}
          </div>
        </section>

        <section className="card">
          <h2>Candidates</h2>
          <form onSubmit={handleCreateManualCandidate}>
            <label>Name</label>
            <input
              value={manualCandidate.name}
              onChange={(event) => setManualCandidate((prev) => ({ ...prev, name: event.target.value }))}
            />
            <label>Email</label>
            <input
              type="email"
              value={manualCandidate.email}
              onChange={(event) => setManualCandidate((prev) => ({ ...prev, email: event.target.value }))}
            />
            <label>Resume Text</label>
            <textarea
              value={manualCandidate.resume_text}
              onChange={(event) => setManualCandidate((prev) => ({ ...prev, resume_text: event.target.value }))}
              required
            />
            <button type="submit">Create Manual Candidate</button>
          </form>

          <label>Upload PDF(s)</label>
          <input type="file" accept="application/pdf" multiple onChange={handleUploadPdfs} />

          <label>Upload Folder (all PDFs)</label>
          <input type="file" webkitdirectory="" directory="" onChange={handleUploadPdfs} />

          <label>Candidate List</label>
          <div className="list">
            {candidates.map((candidate) => (
              <div
                key={candidate.id}
                className={`list-item ${String(candidate.id) === String(selectedCandidateId) ? 'active' : ''}`}
                onClick={() => setSelectedCandidateId(String(candidate.id))}
              >
                <strong>#{candidate.id}</strong> {candidate.name || '(no name)'} — {candidate.stage}
              </div>
            ))}
            {!candidates.length && <div className="list-item">No candidates yet</div>}
          </div>
        </section>

        <section className="card">
          <h2>Agent Actions</h2>
          <label>Selected Job ID</label>
          <input value={selectedJobId} onChange={(event) => setSelectedJobId(event.target.value)} />

          <label>Selected Candidate ID</label>
          <input value={selectedCandidateId} onChange={(event) => setSelectedCandidateId(event.target.value)} />

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={requireApproval}
              onChange={(event) => setRequireApproval(event.target.checked)}
            />
            Require approval in graph run
          </label>

          <div className="row">
            <button onClick={handleRunGraph} disabled={!selectedJobId || !selectedCandidateId}>Run Graph</button>
            <button className="secondary" onClick={handleBatchTopK} disabled={!selectedJobId}>Batch Top-K</button>
          </div>
          <div className="row">
            <button className="secondary" onClick={handleSendEmail} disabled={!selectedCandidateId}>Send Email</button>
          </div>

          <label>Top K</label>
          <input type="number" min={1} max={50} value={topK} onChange={(event) => setTopK(event.target.value)} />

          <label>Resume Run ID</label>
          <input value={resumeRunId} onChange={(event) => setResumeRunId(event.target.value)} />
          <div className="row">
            <button onClick={() => handleResumeGraph(true)} disabled={!resumeRunId}>Resume Approve</button>
            <button className="secondary" onClick={() => handleResumeGraph(false)} disabled={!resumeRunId}>Resume Reject</button>
          </div>
        </section>

        <section className="card">
          <h2>Selected Candidate</h2>
          {selectedCandidate ? (
            <pre>{JSON.stringify(selectedCandidate, null, 2)}</pre>
          ) : (
            <p className="small">Select a candidate to inspect fields.</p>
          )}
        </section>

        <section className="card">
          <h2>Last API Result</h2>
          <pre>{result ? JSON.stringify(result, null, 2) : 'No result yet'}</pre>
          <p className="status">{status}</p>
        </section>
      </div>
    </div>
  )
}

export default App
