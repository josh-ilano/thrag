import { useEffect, useMemo, useState } from 'react'
import { supabase, supabaseConfigError } from './lib/supabaseClient'
import './App.css'

const emptyForm = {
  email: '',
  password: '',
}

const emptyChooseSoftwareForm = {
  desiredTool: '',
  riskAssessment: '',
  modelType: '',
  costs: '',
  dataRequirements: '',
}

const defaultDetailHints = {
  riskAssessment:
    'Example: We need low hallucination risk, auditability, strong access controls, and clear human review checkpoints.',
  modelType:
    'Example: Text to text, text to image, speech to text, embedding model, multimodal assistant.',
  costs:
    'Example: Prefer usage-based pricing under $2,000/month for the pilot, with predictable enterprise scaling.',
  dataRequirements:
    'Example: Must support SSO, no training on our data, retention controls, and SOC 2 or ISO 27001 evidence.',
}

const maxFeedbackIterations = 6

const vllmModel =
  import.meta.env.VITE_VLLM_MODEL || 'TinyLlama/TinyLlama-1.1B-Chat-v1.0'

function createTailoredDetailHints() {
  return {
    riskAssessment:
      'Describe the risks you care about most: hallucinations, bias, misuse, human review needs, security controls, compliance requirements, and what could go wrong in production.',
    modelType:
      'Describe the expected AI capability: text to text, text to image, speech to text, embeddings, code generation, multimodal analysis, agentic workflow, or another model type.',
    costs:
      'Describe your budget expectations: pilot budget, monthly limit, usage volume, per-seat or token pricing concerns, and how costs should scale if adoption grows.',
    dataRequirements:
      'Describe the data rules it must satisfy: sensitive data allowed or blocked, retention limits, whether provider training is allowed, SSO/access controls, and compliance evidence needed.',
  }
}

function extractJsonObject(text) {
  const fencedJson = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const firstBraceIndex = text.indexOf('{')

  if (!fencedJson && firstBraceIndex === -1) {
    return null
  }

  const jsonCandidate = fencedJson?.[1] || text.slice(firstBraceIndex)
  const lastBraceIndex = jsonCandidate.lastIndexOf('}')

  if (lastBraceIndex === -1) {
    return null
  }

  try {
    return JSON.parse(jsonCandidate.slice(0, lastBraceIndex + 1))
  } catch {
    return null
  }
}

function normalizeDetailHints(reply) {
  const parsedHints = extractJsonObject(reply)
  const tailoredHints = createTailoredDetailHints()

  if (!parsedHints) {
    return tailoredHints
  }

  return {
    riskAssessment:
      parsedHints.riskAssessment ||
      parsedHints.risk_assessment ||
      tailoredHints.riskAssessment,
    modelType:
      parsedHints.modelType || parsedHints.model_type || tailoredHints.modelType,
    costs: parsedHints.costs || tailoredHints.costs,
    dataRequirements:
      parsedHints.dataRequirements ||
      parsedHints.data_requirements ||
      parsedHints.dataPrivacy ||
      parsedHints.data_privacy ||
      tailoredHints.dataRequirements,
  }
}

function normalizeFeedbackQuestions(reply, iterationNumber) {
  const parsedResponse = extractJsonObject(reply)
  const rawQuestions = Array.isArray(parsedResponse)
    ? parsedResponse
    : parsedResponse?.questions

  const questions = Array.isArray(rawQuestions)
    ? rawQuestions
        .map((question) => String(question).trim())
        .filter(Boolean)
        .slice(0, 6)
    : []

  if (questions.length > 0) {
    return questions
  }

  const fallbackQuestions = [
    'Who will use this AI capability, and what decisions or workflows will it influence?',
    'What type of information will users provide to the AI system?',
    'What outputs would be unacceptable, unsafe, or expensive for your organization?',
    'What human review or approval should happen before the AI output is used?',
    'Which compliance, procurement, or security requirements must the tool satisfy?',
    'What would make one recommendation clearly better than another?',
  ]

  return fallbackQuestions.slice(0, Math.min(6, iterationNumber + 2))
}

function App() {
  const [authMode, setAuthMode] = useState('sign-in')
  const [form, setForm] = useState(emptyForm)
  const [activeWorkflow, setActiveWorkflow] = useState('')
  const [chooseSoftwareForm, setChooseSoftwareForm] = useState(
    emptyChooseSoftwareForm,
  )
  const [chooseSoftwareRequest, setChooseSoftwareRequest] = useState(null)
  const [chooseSoftwareReply, setChooseSoftwareReply] = useState('')
  const [chooseStep, setChooseStep] = useState('tool')
  const [detailHints, setDetailHints] = useState(defaultDetailHints)
  const [feedbackIterations, setFeedbackIterations] = useState([])
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
              'Register to start assessing AI tools and managing model risk.',
            action: 'Register',
            switchText: 'Already have an account?',
            switchAction: 'Sign in',
          }
        : {
            title: 'Sign in',
            description:
              'Access your AI risk workspace with your email and password.',
            action: 'Sign in',
            switchText: 'Need an account?',
            switchAction: 'Register',
          },
    [isRegistering],
  )

  const currentFeedbackIteration =
    feedbackIterations[feedbackIterations.length - 1]
  const primaryChooseAction =
    chooseStep === 'tool'
      ? isTestingModel
        ? 'Generating hints...'
        : 'Next'
      : chooseStep === 'details'
        ? isTestingModel
          ? 'Generating questions...'
          : 'Next'
        : chooseStep === 'feedback'
          ? isTestingModel
            ? feedbackIterations.length >= maxFeedbackIterations
              ? 'Generating report...'
              : 'Generating questions...'
            : feedbackIterations.length >= maxFeedbackIterations
              ? 'Submit'
              : 'Next'
          : 'Done'

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
    setChooseStep('tool')
    setDetailHints(defaultDetailHints)
    setFeedbackIterations([])
  }

  function updateChooseSoftwareForm(event) {
    const { name, value } = event.target
    setChooseSoftwareForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }))
  }

  async function requestVllmReply(userMessage) {
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

    return reply
  }

  function updateFeedbackAnswer(iterationIndex, questionIndex, value) {
    setFeedbackIterations((currentIterations) =>
      currentIterations.map((iteration, currentIndex) =>
        currentIndex === iterationIndex
          ? {
              ...iteration,
              answers: {
                ...iteration.answers,
                [questionIndex]: value,
              },
            }
          : iteration,
      ),
    )
  }

  function buildDecisionContext() {
    return JSON.stringify(
      {
        initialRequest: chooseSoftwareForm.desiredTool,
        details: {
          riskAssessment: chooseSoftwareForm.riskAssessment,
          modelType: chooseSoftwareForm.modelType,
          costs: chooseSoftwareForm.costs,
          dataRequirements: chooseSoftwareForm.dataRequirements,
        },
        followUps: feedbackIterations.map((iteration) => ({
          iteration: iteration.iteration,
          questions: iteration.questions.map((question, questionIndex) => ({
            question,
            answer: iteration.answers[questionIndex] || '',
          })),
        })),
      },
      null,
      2,
    )
  }

  async function generateFinalReport() {
    setError('')
    setNotice('')
    setChooseSoftwareRequest({
      ...chooseSoftwareForm,
      feedbackIterations,
    })
    setChooseSoftwareReply('')
    setIsTestingModel(true)

    const userMessage = `You are helping a company choose appropriate AI tools or systems.

Use all collected information below to generate the best possible AI risk management recommendation report.

Collected information:
${buildDecisionContext()}

Return a concise report with:
1. Recommended AI tool categories or products
2. Why they fit the user's needs
3. Key risks to evaluate
4. Cost considerations
5. Data, privacy, and governance checks
6. A final recommendation.`

    try {
      const reply = await requestVllmReply(userMessage)
      setChooseSoftwareReply(reply)
      setChooseStep('report')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setIsTestingModel(false)
    }
  }

  async function handleChooseSoftwareSubmit(event) {
    event.preventDefault()
    await generateFinalReport()
  }

  async function generateFeedbackQuestions() {
    setError('')
    setNotice('')
    setChooseSoftwareReply('')
    setIsTestingModel(true)

    const nextIterationNumber = feedbackIterations.length + 1
    const userMessage = `You are narrowing down an AI risk management recommendation.

Generate tailored follow-up questions based on all of the user's responses so far. The questions should help narrow the recommendation and avoid repeating questions already answered.

Collected information:
${buildDecisionContext()}

Return only valid JSON with this shape:
{
  "questions": [
    "question 1",
    "question 2"
  ]
}

Rules:
- Generate between 3 and 6 questions.
- Questions must be specific to the user's needs.
- Questions should cover missing details, tradeoffs, constraints, risk appetite, deployment context, users, governance, budget, integrations, or data sensitivity.
- This is iteration ${nextIterationNumber} of ${maxFeedbackIterations}. Later iterations should become more specific.`

    try {
      const reply = await requestVllmReply(userMessage)
      const questions = normalizeFeedbackQuestions(reply, nextIterationNumber)
      setFeedbackIterations((currentIterations) => [
        ...currentIterations,
        {
          iteration: nextIterationNumber,
          questions,
          answers: {},
        },
      ])
      setChooseStep('feedback')
    } catch (requestError) {
      const questions = normalizeFeedbackQuestions('', nextIterationNumber)
      setFeedbackIterations((currentIterations) => [
        ...currentIterations,
        {
          iteration: nextIterationNumber,
          questions,
          answers: {},
        },
      ])
      setChooseStep('feedback')
      setError(`${requestError.message} Using local follow-up questions instead.`)
    } finally {
      setIsTestingModel(false)
    }
  }

  async function handleFeedbackNext(event) {
    event.preventDefault()

    if (feedbackIterations.length >= maxFeedbackIterations) {
      await generateFinalReport()
      return
    }

    await generateFeedbackQuestions()
  }

  async function handleDetailsNext(event) {
    event.preventDefault()
    await generateFeedbackQuestions()
  }


  function resetWorkflow() {
    setActiveWorkflow('')
    setChooseSoftwareForm(emptyChooseSoftwareForm)
    setChooseSoftwareRequest(null)
    setChooseSoftwareReply('')
    setChooseStep('tool')
    setDetailHints(defaultDetailHints)
    setFeedbackIterations([])
  }

  async function goToChooseDetails(event) {
    event.preventDefault()
    setError('')
    setNotice('')
    setChooseSoftwareRequest(null)
    setChooseSoftwareReply('')
    setIsTestingModel(true)

    const userMessage = `Generate helpful text related to the user's prompt that will guide them for filling out the four domains.

User prompt:
${chooseSoftwareForm.desiredTool}

Return only valid JSON with exactly these string keys:
{
  "riskAssessment": "placeholder text that helps the user describe AI safety, compliance, accuracy, misuse, security, and operational risks",
  "modelType": "placeholder text that helps the user identify the likely AI model type, such as text to text, text to image, speech to text, embeddings, or multimodal",
  "costs": "placeholder text that helps the user describe budget, pricing model, usage volume, pilot limits, and scaling constraints",
  "dataRequirements": "placeholder text that helps the user describe privacy, retention, data training, access controls, and compliance evidence"
}

Do not repeat or quote the user's prompt in the placeholder text. Make the placeholders useful and specific without echoing the original wording.`

    try {
      const reply = await requestVllmReply(userMessage)
      setDetailHints(normalizeDetailHints(reply))
    } catch (requestError) {
      setDetailHints(createTailoredDetailHints())
      setError(`${requestError.message} Using tailored local hints instead.`)
    } finally {
      setIsTestingModel(false)
      setChooseStep('details')
    }
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
              <p className="eyebrow">AI Risk Management</p>
              <h1>AI risk workspace</h1>
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
              <h2>Vet an AI tool</h2>
              <p>Generate a risk report for an AI system your company is reviewing.</p>
            </button>
            <button
              className={`workflow-card ${
                activeWorkflow === 'choose-software' ? 'selected' : ''
              }`}
              type="button"
              onClick={() => selectWorkflow('choose-software')}
            >
              <span>02</span>
              <h2>Choose an AI tool</h2>
              <p>Compare AI options and identify the best fit for your controls.</p>
            </button>
          </div>

          {activeWorkflow === 'choose-software' && (
            <form
              className="workflow-form"
              onSubmit={
                chooseStep === 'tool'
                  ? goToChooseDetails
                  : chooseStep === 'details'
                    ? handleDetailsNext
                    : chooseStep === 'feedback'
                      ? handleFeedbackNext
                      : handleChooseSoftwareSubmit
              }
            >
              <div>
                <p className="eyebrow">Choosing an AI tool</p>
                <h2>
                  {chooseStep === 'tool'
                    ? 'What AI tool would you like?'
                    : chooseStep === 'details'
                      ? 'Add the risk details'
                      : chooseStep === 'feedback'
                        ? `Narrow the recommendation (${currentFeedbackIteration?.iteration || 1} of ${maxFeedbackIterations})`
                        : 'AI risk recommendation report'}
                </h2>
                <p>
                  {chooseStep === 'tool'
                    ? 'Describe the AI capability, product, or workflow you want to evaluate.'
                    : chooseStep === 'details'
                      ? 'Use these fields to guide the AI risk recommendation before continuing.'
                      : chooseStep === 'feedback'
                        ? 'Answer the tailored questions, continue for more refinement, or generate the report now.'
                        : 'Review the generated recommendation below.'}
                </p>
              </div>

              {chooseStep === 'tool' && (
                <label>
                  AI tool request
                  <textarea
                    name="desiredTool"
                    onChange={updateChooseSoftwareForm}
                    placeholder="Example: We need an AI assistant for customer support ticket triage and response drafting."
                    required
                    rows="6"
                    value={chooseSoftwareForm.desiredTool}
                  />
                </label>
              )}

              {chooseStep === 'details' && (
                <>
                  <label>
                    Risk assessment
                    <textarea
                      name="riskAssessment"
                      onChange={updateChooseSoftwareForm}
                      placeholder={detailHints.riskAssessment}
                      required
                      rows="4"
                      value={chooseSoftwareForm.riskAssessment}
                    />
                  </label>

                  <label>
                    Model type
                    <textarea
                      name="modelType"
                      onChange={updateChooseSoftwareForm}
                      placeholder={detailHints.modelType}
                      required
                      rows="3"
                      value={chooseSoftwareForm.modelType}
                    />
                  </label>

                  <label>
                    Costs
                    <textarea
                      name="costs"
                      onChange={updateChooseSoftwareForm}
                      placeholder={detailHints.costs}
                      required
                      rows="3"
                      value={chooseSoftwareForm.costs}
                    />
                  </label>

                  <label>
                    Data and privacy requirements
                    <textarea
                      name="dataRequirements"
                      onChange={updateChooseSoftwareForm}
                      placeholder={detailHints.dataRequirements}
                      rows="4"
                      value={chooseSoftwareForm.dataRequirements}
                    />
                  </label>
                </>
              )}

              {chooseStep === 'feedback' && currentFeedbackIteration && (
                <div className="question-list">
                  {currentFeedbackIteration.questions.map((question, questionIndex) => (
                    <label key={`${currentFeedbackIteration.iteration}-${question}`}>
                      {question}
                      <textarea
                        onChange={(event) =>
                          updateFeedbackAnswer(
                            feedbackIterations.length - 1,
                            questionIndex,
                            event.target.value,
                          )
                        }
                        placeholder="Add details that will help narrow the recommendation."
                        rows="3"
                        value={currentFeedbackIteration.answers[questionIndex] || ''}
                      />
                    </label>
                  ))}
                </div>
              )}

              {chooseStep !== 'report' && (
                <div className="form-actions">
                  <button
                    className="primary-button"
                    disabled={isTestingModel}
                    type="submit"
                  >
                    {primaryChooseAction}
                  </button>
                  {chooseStep !== 'report' && (
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={isTestingModel}
                      onClick={generateFinalReport}
                    >
                      {isTestingModel ? 'Generating...' : 'Generate'}
                    </button>
                  )}
                  {chooseStep === 'details' && (
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={isTestingModel}
                      onClick={() => setChooseStep('tool')}
                    >
                      Previous
                    </button>
                  )}
                  {chooseStep === 'feedback' && (
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={isTestingModel}
                      onClick={() => setChooseStep('details')}
                    >
                      Previous
                    </button>
                  )}
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={isTestingModel}
                    onClick={resetWorkflow}
                  >
                    Back
                  </button>
                </div>
              )}

              {chooseSoftwareRequest && (
                <div className="request-preview" aria-live="polite">
                  <h3>AI tool search request</h3>
                  <dl>
                    <div>
                      <dt>AI tool request</dt>
                      <dd>{chooseSoftwareRequest.desiredTool}</dd>
                    </div>
                    <div>
                      <dt>Risk assessment</dt>
                      <dd>{chooseSoftwareRequest.riskAssessment}</dd>
                    </div>
                    <div>
                      <dt>Model type</dt>
                      <dd>{chooseSoftwareRequest.modelType}</dd>
                    </div>
                    <div>
                      <dt>Costs</dt>
                      <dd>{chooseSoftwareRequest.costs}</dd>
                    </div>
                    {chooseSoftwareRequest.dataRequirements && (
                      <div>
                        <dt>Data and privacy requirements</dt>
                        <dd>{chooseSoftwareRequest.dataRequirements}</dd>
                      </div>
                    )}
                    {chooseSoftwareRequest.feedbackIterations?.length > 0 && (
                      <div>
                        <dt>Follow-up answers</dt>
                        <dd>
                          {chooseSoftwareRequest.feedbackIterations
                            .map((iteration) =>
                              iteration.questions
                                .map((question, questionIndex) => {
                                  const answer =
                                    iteration.answers[questionIndex] ||
                                    'No answer provided'
                                  return `Iteration ${iteration.iteration}: ${question}\n${answer}`
                                })
                                .join('\n\n'),
                            )
                            .join('\n\n')}
                        </dd>
                      </div>
                    )}
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
                <p className="eyebrow">Vetting an AI tool</p>
                <h2>AI tool vetting will come next</h2>
                <p>
                  This branch will collect the AI tool name and your tech stack
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
          <p className="eyebrow">AI Risk Management</p>
          <h1>Assess AI systems before they become risk.</h1>
          <p className="lede">
            Create AI risk reports and comparison workflows from a secure
            account.
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
