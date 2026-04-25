import { useEffect, useMemo, useState } from 'react'
import { supabase, supabaseConfigError } from './lib/supabaseClient'
import './App.css'

const emptyForm = {
  email: '',
  password: '',
}

function App() {
  const [authMode, setAuthMode] = useState('sign-in')
  const [form, setForm] = useState(emptyForm)
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
          <div>
            <p className="eyebrow">Third-Party Risk Management</p>
            <h1>Vendor risk workspace</h1>
            <p className="lede">
              You are signed in as <strong>{session.user.email}</strong>.
            </p>
          </div>

          <div className="workspace-grid" aria-label="Available workflows">
            <article>
              <span>01</span>
              <h2>Vet a software</h2>
              <p>Generate a risk report for a vendor your company is reviewing.</p>
            </article>
            <article>
              <span>02</span>
              <h2>Choose a software</h2>
              <p>Compare options and identify the best fit for your controls.</p>
            </article>
          </div>

          {error && <p className="alert error">{error}</p>}
          {notice && <p className="alert success">{notice}</p>}

          <button className="secondary-button" type="button" onClick={handleSignOut}>
            Sign out
          </button>
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
