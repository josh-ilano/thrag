import { useEffect, useMemo, useState } from 'react'
import { supabase, supabaseConfigError } from './lib/supabaseClient'
import './App.css'

const emptyForm = {
  email: '',
  password: '',
}

const emptyChooseSoftwareForm = {
  techStack: '',
  goals: '',
}

const vllmModel =
  import.meta.env.VITE_VLLM_MODEL || 'TinyLlama/TinyLlama-1.1B-Chat-v1.0'

function App() {
  const [authMode, setAuthMode] = useState('sign-in')
  const [form, setForm] = useState(emptyForm)
  const [activeWorkflow, setActiveWorkflow] = useState('')
  const [chooseSoftwareForm, setChooseSoftwareForm] = useState(
    emptyChooseSoftwareForm,
  )
  const [chooseSoftwareRequest, setChooseSoftwareRequest] = useState(null)
  const [chooseSoftwareReply, setChooseSoftwareReply] = useState('')
  const [isTestingModel, setIsTestingModel] = useState(false)
  const [session, setSession] = useState(null)
  const [isLoadingSession, setIsLoadingSession] = useState(Boolean(supabase))
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const isRegistering = authMode === 'register'

  const pageCopy = useMemo(
    () =>
      isRegistering
        ? {
            title: 'Create your account',
            description:
              'Register to start vetting vendors and comparing software risk profiles.',
            action: 'Register',
            switchText: 'Already have an account?',
            switchAction: 'Sign in',
          }
        : {
            title: 'Sign in',
            description:
              'Access your third-party risk workspace with your email and password.',
            action: 'Sign in',
            switchText: 'Need an account?',
            switchAction: 'Register',
          },
    [isRegistering],
  )

  useEffect(() => {
    if (!supabase) {
      return undefined
    }

    let isMounted = true

    supabase.auth.getSession().then(({ data }) => {
      if (isMounted) {
        setSession(data.session)
        setIsLoadingSession(false)
      }
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  function updateForm(event) {
    const { name, value } = event.target
    setForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }))
  }

  function switchMode() {
    setAuthMode((currentMode) =>
      currentMode === 'sign-in' ? 'register' : 'sign-in',
    )
    setNotice('')
    setError('')
  }

  function selectWorkflow(workflow) {
    setActiveWorkflow(workflow)
    setChooseSoftwareRequest(null)
    setChooseSoftwareReply('')
  }

  function updateChooseSoftwareForm(event) {
    const { name, value } = event.target
    setChooseSoftwareForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }))
  }

  async function handleChooseSoftwareSubmit(event) {
    event.preventDefault()
    setError('')
    setNotice('')
    setChooseSoftwareRequest(chooseSoftwareForm)
    setChooseSoftwareReply('')
    setIsTestingModel(true)

    const userMessage = `You are helping a company choose appropriate software.

Current tech stack:
${chooseSoftwareForm.techStack}

Goals:
${chooseSoftwareForm.goals}

Return a short test response confirming you can read the request, then suggest 3 software categories or products to consider.`

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: vllmModel,
          messages: [{ role: 'user', content: userMessage }],
        }),
      })

      if (!response.ok) {
        throw new Error(`vLLM request failed with status ${response.status}`)
      }

      const data = await response.json()
      const reply = data.choices?.[0]?.message?.content

      if (!reply) {
        throw new Error('vLLM returned a response without a message.')
      }

      setChooseSoftwareReply(reply)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setIsTestingModel(false)
    }
  }

  function resetWorkflow() {
    setActiveWorkflow('')
    setChooseSoftwareForm(emptyChooseSoftwareForm)
    setChooseSoftwareRequest(null)
    setChooseSoftwareReply('')
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setNotice('')
    setError('')

    if (!supabase) {
      setError(supabaseConfigError)
      return
    }

    setIsSubmitting(true)

    const authRequest = isRegistering
      ? supabase.auth.signUp({
          email: form.email,
          password: form.password,
        })
      : supabase.auth.signInWithPassword({
          email: form.email,
          password: form.password,
        })

    const { data, error: authError } = await authRequest
    setIsSubmitting(false)

    if (authError) {
      setError(authError.message)
      return
    }

    setForm(emptyForm)

    if (isRegistering && !data.session) {
      setNotice('Registration created. Check your email to confirm your account.')
      return
    }

    setNotice(isRegistering ? 'Account created.' : 'Signed in.')
  }

  async function handleSignOut() {
    if (!supabase) return

    setError('')
    setNotice('')
    const { error: signOutError } = await supabase.auth.signOut()

    if (signOutError) {
      setError(signOutError.message)
    } else {
      setNotice('Signed out.')
    }
  }

  if (isLoadingSession) {
    return (
      <main className="app-shell">
        <p className="status-message">Loading authentication...</p>
      </main>
    )
  }

  if (session) {
    return (
      <main className="app-shell">
        <section className="workspace-panel">
          <header className="workspace-header">
            <div>
              <p className="eyebrow">Third-Party Risk Management</p>
              <h1>Vendor risk workspace</h1>
              <p className="lede">
                You are signed in as <strong>{session.user.email}</strong>.
              </p>
            </div>
            <button
              className="secondary-button"
              type="button"
              onClick={handleSignOut}
            >
              Sign out
            </button>
          </header>

          <div className="workspace-grid" aria-label="Available workflows">
            <button
              className={`workflow-card ${
                activeWorkflow === 'vet-software' ? 'selected' : ''
              }`}
              type="button"
              onClick={() => selectWorkflow('vet-software')}
            >
              <span>01</span>
              <h2>Vet a software</h2>
              <p>Generate a risk report for a vendor your company is reviewing.</p>
            </button>
            <button
              className={`workflow-card ${
                activeWorkflow === 'choose-software' ? 'selected' : ''
              }`}
              type="button"
              onClick={() => selectWorkflow('choose-software')}
            >
              <span>02</span>
              <h2>Choose a software</h2>
              <p>Compare options and identify the best fit for your controls.</p>
            </button>
          </div>

          {activeWorkflow === 'choose-software' && (
            <form className="workflow-form" onSubmit={handleChooseSoftwareSubmit}>
              <div>
                <p className="eyebrow">Choosing a software</p>
                <h2>Find tools that fit your environment</h2>
                <p>
                  Share the current tech stack and the business goals this new
                  software needs to support.
                </p>
              </div>

              <label>
                Tech stack
                <textarea
                  name="techStack"
                  onChange={updateChooseSoftwareForm}
                  placeholder="Example: React, Node.js, PostgreSQL, AWS, Okta, Jira"
                  required
                  rows="5"
                  value={chooseSoftwareForm.techStack}
                />
              </label>

              <label>
                Goals
                <textarea
                  name="goals"
                  onChange={updateChooseSoftwareForm}
                  placeholder="Example: We need a secure project management tool for engineering and compliance teams, with SSO and audit logs."
                  required
                  rows="6"
                  value={chooseSoftwareForm.goals}
                />
              </label>

              <div className="form-actions">
                <button
                  className="primary-button"
                  disabled={isTestingModel}
                  type="submit"
                >
                  {isTestingModel ? 'Submitting...' : 'Submit'}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={isTestingModel}
                  onClick={resetWorkflow}
                >
                  Back
                </button>
              </div>

              {chooseSoftwareRequest && (
                <div className="request-preview" aria-live="polite">
                  <h3>Software search request</h3>
                  <dl>
                    <div>
                      <dt>Tech stack</dt>
                      <dd>{chooseSoftwareRequest.techStack}</dd>
                    </div>
                    <div>
                      <dt>Goals</dt>
                      <dd>{chooseSoftwareRequest.goals}</dd>
                    </div>
                  </dl>
                </div>
              )}

              {chooseSoftwareReply && (
                <div className="model-response" aria-live="polite">
                  <h3>vLLM response</h3>
                  <p>{chooseSoftwareReply}</p>
                </div>
              )}
            </form>
          )}

          {activeWorkflow === 'vet-software' && (
            <section className="workflow-form" aria-live="polite">
              <div>
                <p className="eyebrow">Vetting a software</p>
                <h2>Vendor vetting will come next</h2>
                <p>
                  This branch will collect the software name and your tech stack
                  when the vetting flow is implemented.
                </p>
              </div>
              <button
                className="secondary-button"
                type="button"
                onClick={resetWorkflow}
              >
                Back
              </button>
            </section>
          )}

          {error && <p className="alert error">{error}</p>}
          {notice && <p className="alert success">{notice}</p>}
        </section>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <section className="auth-layout">
        <div className="product-copy">
          <p className="eyebrow">Third-Party Risk Management</p>
          <h1>Assess vendors before they become risk.</h1>
          <p className="lede">
            Create software vetting reports and comparison workflows from a
            secure account.
          </p>
        </div>

        <form className="auth-card" onSubmit={handleSubmit}>
          <div>
            <h2>{pageCopy.title}</h2>
            <p>{pageCopy.description}</p>
          </div>

          <label>
            Email
            <input
              autoComplete="email"
              name="email"
              onChange={updateForm}
              placeholder="you@company.com"
              required
              type="email"
              value={form.email}
            />
          </label>

          <label>
            Password
            <input
              autoComplete={isRegistering ? 'new-password' : 'current-password'}
              minLength="6"
              name="password"
              onChange={updateForm}
              placeholder="At least 6 characters"
              required
              type="password"
              value={form.password}
            />
          </label>

          {supabaseConfigError && <p className="alert error">{supabaseConfigError}</p>}
          {error && <p className="alert error">{error}</p>}
          {notice && <p className="alert success">{notice}</p>}

          <button className="primary-button" disabled={isSubmitting} type="submit">
            {isSubmitting ? 'Working...' : pageCopy.action}
          </button>

          <p className="mode-switch">
            {pageCopy.switchText}{' '}
            <button type="button" onClick={switchMode}>
              {pageCopy.switchAction}
            </button>
          </p>
        </form>
      </section>
    </main>
  )
}

export default App
