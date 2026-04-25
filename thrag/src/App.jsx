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

const emptyVetSoftwareForm = {
  modelName: '',
  intendedUse: '',
  deploymentContext: '',
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

const allowedRecommendationModels = [
  'GPT-4o',
  'GPT-4.1',
  'GPT-4.1 mini',
  'o4-mini',
  'Claude 3.5 Sonnet',
  'Claude 3.7 Sonnet',
  'Claude 3.5 Haiku',
  'Gemini 1.5 Pro',
  'Gemini 1.5 Flash',
  'Gemini 2.0 Flash',
  'Llama 3.1 8B Instruct',
  'Llama 3.1 70B Instruct',
  'Llama 3.1 405B Instruct',
  'Mistral Large',
  'Mixtral 8x22B Instruct',
  'DeepSeek-V3',
  'DeepSeek-R1',
  'Qwen2.5 72B Instruct',
  'Command R+',
  'Cohere Command R',
]

const ragSecurityScriptPath = '/Users/joshilano/Downloads/rag_security_assessment.py'

const ragSecurityScriptSummary = `Local MVP: Modular RAG + simulated garak hybrid security assessment.
- Builds a local risk dataset and retrieves relevant risks with sentence-transformers/FAISS or TF-IDF fallback.
- Loads simulated or JSON-based garak vulnerability results.
- Computes risk score (1-5) and confidence score (0-100).
- Builds a structured security prompt and generates a report through vLLM TinyLlama.
- Saves report output to disk for traceability.`

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

function parseRagAssessmentOutput(rawOutput) {
  const raw = String(rawOutput || '').trim()
  if (!raw) {
    return null
  }

  const lines = raw.split('\n')
  const tool = lines.find((line) => line.startsWith('[DEBUG] tool='))?.replace('[DEBUG] tool=', '').trim() || ''
  const retrievalQuery =
    lines
      .find((line) => line.startsWith('[DEBUG] retrieval_query='))
      ?.replace('[DEBUG] retrieval_query=', '')
      .trim() || ''
  const riskScore =
    lines
      .find((line) => line.startsWith('[DEBUG] risk_score_1to5='))
      ?.replace('[DEBUG] risk_score_1to5=', '')
      .trim() || ''
  const confidenceScore =
    lines
      .find((line) => line.startsWith('[DEBUG] confidence_0to100='))
      ?.replace('[DEBUG] confidence_0to100=', '')
      .trim() || ''

  const retrievedRisks = lines
    .filter((line) => line.trim().startsWith('- sim='))
    .map((line) => line.trim())

  const garakStart = lines.findIndex(
    (line) => line.trim() === '[DEBUG] garak_results:',
  )
  const riskScoreIndex = lines.findIndex((line) =>
    line.startsWith('[DEBUG] risk_score_1to5='),
  )
  const garakJson =
    garakStart !== -1 && riskScoreIndex !== -1 && riskScoreIndex > garakStart
      ? lines.slice(garakStart + 1, riskScoreIndex).join('\n').trim()
      : ''

  const divider = '================================================================================'
  const dividerIndexes = lines
    .map((line, index) => (line.trim() === divider ? index : -1))
    .filter((index) => index !== -1)
  const reportStartIndex =
    dividerIndexes.length >= 2 ? dividerIndexes[1] + 1 : lines.length
  const narrativeReport = lines.slice(reportStartIndex).join('\n').trim()

  return {
    tool,
    retrievalQuery,
    riskScore,
    confidenceScore,
    retrievedRisks,
    garakJson,
    narrativeReport,
    raw,
  }
}

function parseAndValidateModelRecommendations(reply) {
  const parsed = extractJsonObject(reply)
  const recommendations = parsed?.recommendations

  if (!Array.isArray(recommendations) || recommendations.length !== 5) {
    return null
  }

  const allowedSet = new Set(allowedRecommendationModels)
  const allAllowed = recommendations.every((recommendation) =>
    allowedSet.has(String(recommendation?.modelName || '').trim()),
  )

  if (!allAllowed) {
    return null
  }

  const bestOverallModel = String(parsed?.bestOverallModel || '').trim()
  if (!bestOverallModel || !allowedSet.has(bestOverallModel)) {
    return null
  }

  return parsed
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

function normalizeQuestionText(question) {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function isSimilarQuestion(question, previousQuestion) {
  const currentWords = new Set(
    normalizeQuestionText(question)
      .split(' ')
      .filter((word) => word.length > 3),
  )
  const previousWords = new Set(
    normalizeQuestionText(previousQuestion)
      .split(' ')
      .filter((word) => word.length > 3),
  )

  if (currentWords.size === 0 || previousWords.size === 0) {
    return false
  }

  const sharedWordCount = [...currentWords].filter((word) =>
    previousWords.has(word),
  ).length
  const overlapRatio =
    sharedWordCount / Math.min(currentWords.size, previousWords.size)

  return overlapRatio >= 0.7
}

function getPreviousQuestions(iterations) {
  return iterations.flatMap((iteration) => iteration.questions)
}

function removeRepeatedQuestions(questions, previousQuestions, iterationNumber) {
  const seenQuestions = new Set(previousQuestions.map(normalizeQuestionText))
  const uniqueQuestions = []

  questions.forEach((question) => {
    const normalizedQuestion = normalizeQuestionText(question)
    const isRepeatedQuestion = previousQuestions.some((previousQuestion) =>
      isSimilarQuestion(question, previousQuestion),
    )

    if (
      normalizedQuestion &&
      !seenQuestions.has(normalizedQuestion) &&
      !isRepeatedQuestion
    ) {
      seenQuestions.add(normalizedQuestion)
      uniqueQuestions.push(question)
    }
  })

  const fallbackQuestions = normalizeFeedbackQuestions('', iterationNumber)

  fallbackQuestions.forEach((question) => {
    const normalizedQuestion = normalizeQuestionText(question)

    if (uniqueQuestions.length < 3 && !seenQuestions.has(normalizedQuestion)) {
      seenQuestions.add(normalizedQuestion)
      uniqueQuestions.push(question)
    }
  })

  return uniqueQuestions.slice(0, 6)
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
  const [currentFeedbackIndex, setCurrentFeedbackIndex] = useState(0)
  const [questionCache, setQuestionCache] = useState({})
  const [isTestingModel, setIsTestingModel] = useState(false)
  const [vetSoftwareForm, setVetSoftwareForm] = useState(emptyVetSoftwareForm)
  const [vetSoftwareReport, setVetSoftwareReport] = useState('')
  const [vetAppendixOutput, setVetAppendixOutput] = useState('')
  const [vetAppendixMeta, setVetAppendixMeta] = useState(null)
  const [isGeneratingVetReport, setIsGeneratingVetReport] = useState(false)
  const [session, setSession] = useState(null)
  const [isLoadingSession, setIsLoadingSession] = useState(Boolean(supabase))
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const parsedVetAppendix = useMemo(
    () => parseRagAssessmentOutput(vetAppendixOutput),
    [vetAppendixOutput],
  )

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

  const currentFeedbackIteration = feedbackIterations[currentFeedbackIndex]
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
            ? currentFeedbackIndex + 1 >= maxFeedbackIterations
              ? 'Generating report...'
              : 'Generating questions...'
            : currentFeedbackIndex + 1 >= maxFeedbackIterations
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
    setCurrentFeedbackIndex(0)
    setQuestionCache({})
    setVetSoftwareForm(emptyVetSoftwareForm)
    setVetSoftwareReport('')
    setVetAppendixOutput('')
    setVetAppendixMeta(null)
  }

  function updateChooseSoftwareForm(event) {
    const { name, value } = event.target
    setChooseSoftwareForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }))
  }

  function updateVetSoftwareForm(event) {
    const { name, value } = event.target
    setVetSoftwareForm((currentForm) => ({
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
        temperature: 0,
        top_p: 1,
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

  async function requestRagSecurityAppendix() {
    const response = await fetch('/api/rag-security-assessment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        modelName: vetSoftwareForm.modelName,
        intendedUse: vetSoftwareForm.intendedUse,
        deploymentContext: vetSoftwareForm.deploymentContext,
      }),
    })

    if (!response.ok) {
      throw new Error(
        `RAG security assessment request failed with status ${response.status}`,
      )
    }

    return response.json()
  }

  async function handleVetSoftwareSubmit(event) {
    event.preventDefault()
    setError('')
    setNotice('')
    setVetSoftwareReport('')
    setVetAppendixOutput('')
    setVetAppendixMeta(null)
    setIsGeneratingVetReport(true)

    const userMessage = `You are an AI governance and model risk analyst.

Generate a detailed, complete, decision-ready vetting report for the specific AI model provided by the user.
This task is model vetting only, not model discovery or model recommendation.

Model details:
${JSON.stringify(vetSoftwareForm, null, 2)}

Output requirements:
- Title: "Risk Assessment Report: <model name>"
- Write in markdown with clear headings and bullet points.
- Include all sections below and do not skip any:
  1) Executive risk summary
     - Business objective, deployment context, key assumptions, and top 3 risk drivers.
  2) Primary risk categories
     - Cover: safety, security, compliance/legal, privacy, reliability, misuse.
     - For each category include:
       - threat or failure scenarios (at least 2)
       - potential impact (operational, legal, financial, reputational)
       - inherent risk level (high/medium/low) with rationale
       - residual risk level after controls
  3) Severity matrix table
     - Provide a markdown table with columns:
       | Risk Category | Likelihood | Impact | Inherent Severity | Key Evidence | Residual Severity |
  4) Required controls and mitigations before production
     - Preventive, detective, and corrective controls.
     - Include owner role, implementation priority (P0/P1/P2), and acceptance criteria for each control.
  5) Validation and monitoring plan
     - Pre-launch test plan, red-team/abuse tests, performance thresholds, drift monitoring, alerting thresholds, and incident response steps.
  6) Governance and compliance checklist
     - Data handling, retention, access controls, audit logging, human oversight, policy approvals, and documentation artifacts.
  7) Final vetting decision
     - Go / Go-with-conditions / No-go for this specific model.
     - If conditional, provide explicit launch gates and what evidence must be collected before approval.

Formatting and quality rules:
- Be specific and actionable, not generic.
- Expand each section with enough detail to be usable by security, legal, and engineering teams.
- If details are missing, state assumptions explicitly and explain how they affect risk ratings.
- Do not suggest alternative models or "best options." Keep the analysis focused on vetting this model only.`

    try {
      const [reply, appendixData] = await Promise.all([
        requestVllmReply(userMessage),
        requestRagSecurityAppendix(),
      ])
      setVetSoftwareReport(reply)
      setVetAppendixOutput(appendixData.output || '')
      setVetAppendixMeta({
        scriptPath: appendixData.scriptPath || ragSecurityScriptPath,
        model: appendixData.model || vllmModel,
        origin: appendixData.origin || '',
        chatPath: appendixData.chatPath || '',
      })
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setIsGeneratingVetReport(false)
    }
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

  function buildDecisionContext(iterations = feedbackIterations) {
    return JSON.stringify(
      {
        initialRequest: chooseSoftwareForm.desiredTool,
        details: {
          riskAssessment: chooseSoftwareForm.riskAssessment,
          modelType: chooseSoftwareForm.modelType,
          costs: chooseSoftwareForm.costs,
          dataRequirements: chooseSoftwareForm.dataRequirements,
        },
        followUps: iterations.map((iteration) => ({
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

  function createQuestionCacheKey(iterations, iterationNumber) {
    return JSON.stringify({
      iterationNumber,
      context: buildDecisionContext(iterations),
    })
  }

  function snapshotFeedbackFromForm(formElement, iterations, iterationIndex) {
    if (!formElement || iterationIndex < 0) {
      return iterations
    }

    const formData = new FormData(formElement)

    return iterations.map((iteration, currentIterationIndex) =>
      currentIterationIndex === iterationIndex
        ? {
            ...iteration,
            answers: iteration.questions.reduce(
              (answers, _question, questionIndex) => ({
                ...answers,
                [questionIndex]:
                  formData.get(
                    `feedback-${currentIterationIndex}-${questionIndex}`,
                  ) ||
                  iteration.answers[questionIndex] ||
                  '',
              }),
              {},
            ),
          }
        : iteration,
    )
  }

  async function generateFinalReport(iterations = feedbackIterations) {
    setError('')
    setNotice('')
    setChooseSoftwareRequest({
      ...chooseSoftwareForm,
      feedbackIterations: iterations,
    })
    setChooseSoftwareReply('')
    setIsTestingModel(true)

    const userMessage = `You are helping a company choose appropriate AI models.

Use all collected information below to generate the best possible AI risk management recommendation report.

Collected information:
${buildDecisionContext(iterations)}

You must recommend exactly 5 real, publicly known AI model names from this allowed model catalog only:
- GPT-4o
- GPT-4.1
- GPT-4.1 mini
- o4-mini
- Claude 3.5 Sonnet
- Claude 3.7 Sonnet
- Claude 3.5 Haiku
- Gemini 1.5 Pro
- Gemini 1.5 Flash
- Gemini 2.0 Flash
- Llama 3.1 8B Instruct
- Llama 3.1 70B Instruct
- Llama 3.1 405B Instruct
- Mistral Large
- Mixtral 8x22B Instruct
- DeepSeek-V3
- DeepSeek-R1
- Qwen2.5 72B Instruct
- Command R+
- Cohere Command R

Return only valid JSON with this exact structure:
{
  "recommendations": [
    {
      "rank": 1,
      "modelName": "exact model name from catalog",
      "provider": "organization name",
      "bestFit": "short description",
      "whyItMatches": "short explanation",
      "keyRisks": ["risk 1", "risk 2"],
      "costConsiderations": "short cost notes",
      "governanceChecks": ["check 1", "check 2"]
    }
  ],
  "bestOverallModel": "exact model name from catalog"
}

Rules:
- Give exactly 5 recommendations.
- Every recommendation must be an exact model name from the allowed catalog.
- Do not invent model names.
- Do not recommend tools, platforms, categories, or model families without a specific model name.
- Rank the recommendations from 1 to 5.
- Include concise, actionable content for each required field.
- Set "bestOverallModel" to one of the 5 recommended models.`

    try {
      const reply = await requestVllmReply(userMessage)
      const validated = parseAndValidateModelRecommendations(reply)

      if (validated) {
        setChooseSoftwareReply(JSON.stringify(validated, null, 2))
        setChooseStep('report')
        return
      }

      const correctionPrompt = `Your previous response did not follow requirements.
Return only valid JSON that matches the required structure, with exactly 5 recommendations.
Each recommendation.modelName must be one of these exact values:
${JSON.stringify(allowedRecommendationModels, null, 2)}

Previous response:
${reply}`

      const correctedReply = await requestVllmReply(correctionPrompt)
      const correctedValidated = parseAndValidateModelRecommendations(correctedReply)

      if (!correctedValidated) {
        throw new Error(
          'Could not generate valid model recommendations with exact known model names.',
        )
      }

      setChooseSoftwareReply(JSON.stringify(correctedValidated, null, 2))
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

  async function generateFeedbackQuestions(iterations = feedbackIterations) {
    setError('')
    setNotice('')
    setChooseSoftwareReply('')
    setIsTestingModel(true)

    const nextIterationNumber = iterations.length + 1
    const previousQuestions = getPreviousQuestions(iterations)
    const cacheKey = createQuestionCacheKey(iterations, nextIterationNumber)

    if (questionCache[cacheKey]) {
      setFeedbackIterations([
        ...iterations,
        {
          iteration: nextIterationNumber,
          questions: questionCache[cacheKey],
          answers: {},
        },
      ])
      setCurrentFeedbackIndex(iterations.length)
      setChooseStep('feedback')
      setIsTestingModel(false)
      return
    }

    const userMessage = `You are narrowing down an AI risk management recommendation.

Generate tailored follow-up questions based on all of the user's responses so far. The questions should help narrow the recommendation and avoid repeating questions already answered.

Collected information:
${buildDecisionContext(iterations)}

Previously asked questions:
${JSON.stringify(previousQuestions, null, 2)}

Return only valid JSON with this shape:
{
  "questions": [
    "question 1",
    "question 2"
  ]
}

Rules:
- Generate between 3 and 6 new questions.
- Questions must be specific to the user's needs.
- Questions must be based on the user's previous answers in the collected information.
- Do not repeat or rephrase any previous question.
- Questions should cover missing details, tradeoffs, constraints, risk appetite, deployment context, users, governance, budget, integrations, or data sensitivity.
- This is iteration ${nextIterationNumber} of ${maxFeedbackIterations}. Later iterations should become more specific.`

    try {
      const reply = await requestVllmReply(userMessage)
      const questions = removeRepeatedQuestions(
        normalizeFeedbackQuestions(reply, nextIterationNumber),
        previousQuestions,
        nextIterationNumber,
      )
      setFeedbackIterations((currentIterations) => [
        ...currentIterations,
        {
          iteration: nextIterationNumber,
          questions,
          answers: {},
        },
      ])
      setCurrentFeedbackIndex(iterations.length)
      setQuestionCache((currentCache) => ({
        ...currentCache,
        [cacheKey]: questions,
      }))
      setChooseStep('feedback')
    } catch (requestError) {
      const questions = removeRepeatedQuestions(
        normalizeFeedbackQuestions('', nextIterationNumber),
        previousQuestions,
        nextIterationNumber,
      )
      setFeedbackIterations((currentIterations) => [
        ...currentIterations,
        {
          iteration: nextIterationNumber,
          questions,
          answers: {},
        },
      ])
      setCurrentFeedbackIndex(iterations.length)
      setQuestionCache((currentCache) => ({
        ...currentCache,
        [cacheKey]: questions,
      }))
      setChooseStep('feedback')
      setError(`${requestError.message} Using local follow-up questions instead.`)
    } finally {
      setIsTestingModel(false)
    }
  }

  async function handleFeedbackNext(event) {
    event.preventDefault()
    const updatedIterations = snapshotFeedbackFromForm(
      event.currentTarget,
      feedbackIterations,
      currentFeedbackIndex,
    )

    setFeedbackIterations(updatedIterations)

    if (currentFeedbackIndex < updatedIterations.length - 1) {
      setCurrentFeedbackIndex((currentIndex) => currentIndex + 1)
      return
    }

    if (currentFeedbackIndex + 1 >= maxFeedbackIterations) {
      await generateFinalReport(updatedIterations)
      return
    }

    await generateFeedbackQuestions(updatedIterations)
  }

  async function handleDetailsNext(event) {
    event.preventDefault()

    if (feedbackIterations.length > 0) {
      setChooseStep('feedback')
      setCurrentFeedbackIndex(0)
      return
    }

    await generateFeedbackQuestions()
  }

  async function handleGenerateClick(event) {
    const formElement = event.currentTarget.form
    const iterations =
      chooseStep === 'feedback'
        ? snapshotFeedbackFromForm(
            formElement,
            feedbackIterations,
            currentFeedbackIndex,
          )
        : feedbackIterations

    if (chooseStep === 'feedback') {
      setFeedbackIterations(iterations)
    }

    await generateFinalReport(iterations)
  }

  function goToPreviousChooseStep() {
    if (chooseStep === 'details') {
      setChooseStep('tool')
      return
    }

    if (chooseStep === 'feedback' && currentFeedbackIndex > 0) {
      setCurrentFeedbackIndex((currentIndex) => currentIndex - 1)
      return
    }

    setChooseStep('details')
  }


  function resetWorkflow() {
    setActiveWorkflow('')
    setChooseSoftwareForm(emptyChooseSoftwareForm)
    setChooseSoftwareRequest(null)
    setChooseSoftwareReply('')
    setChooseStep('tool')
    setDetailHints(defaultDetailHints)
    setFeedbackIterations([])
    setVetSoftwareForm(emptyVetSoftwareForm)
    setVetSoftwareReport('')
    setVetAppendixOutput('')
    setVetAppendixMeta(null)
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
                        name={`feedback-${currentFeedbackIndex}-${questionIndex}`}
                        onChange={(event) =>
                          updateFeedbackAnswer(
                            currentFeedbackIndex,
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
                  <div className="form-actions-left">
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={isTestingModel}
                      onClick={resetWorkflow}
                    >
                      Back
                    </button>
                    {(chooseStep === 'details' || chooseStep === 'feedback') && (
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={isTestingModel}
                        onClick={goToPreviousChooseStep}
                      >
                        Previous
                      </button>
                    )}
                  </div>

                  <div className="form-actions-right">
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={isTestingModel}
                      onClick={handleGenerateClick}
                    >
                      {isTestingModel ? 'Generating...' : 'Generate'}
                    </button>
                    <button
                      className="primary-button"
                      disabled={isTestingModel}
                      type="submit"
                    >
                      {primaryChooseAction}
                    </button>
                  </div>
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
            <form
              className="workflow-form"
              aria-live="polite"
              onSubmit={handleVetSoftwareSubmit}
            >
              <div>
                <p className="eyebrow">Vetting a specific AI model</p>
                <h2>Generate an AI model vetting report</h2>
                <p>
                  Enter the model and context, then generate a risk-focused vetting
                  report for that model only
                  from vLLM.
                </p>
              </div>

              <label>
                AI model
                <input
                  name="modelName"
                  onChange={updateVetSoftwareForm}
                  placeholder="Example: meta-llama/Llama-3.1-8B-Instruct"
                  required
                  type="text"
                  value={vetSoftwareForm.modelName}
                />
              </label>

              <label>
                Intended use
                <textarea
                  name="intendedUse"
                  onChange={updateVetSoftwareForm}
                  placeholder="Example: Internal support copilot for drafting responses and summarizing incidents."
                  rows="3"
                  value={vetSoftwareForm.intendedUse}
                />
              </label>

              <label>
                Deployment context
                <textarea
                  name="deploymentContext"
                  onChange={updateVetSoftwareForm}
                  placeholder="Example: Runs in a private VPC, serves 200 analysts, handles customer account notes."
                  rows="3"
                  value={vetSoftwareForm.deploymentContext}
                />
              </label>

              <div className="form-actions">
                <div className="form-actions-left">
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={isGeneratingVetReport}
                    onClick={resetWorkflow}
                  >
                    Back
                  </button>
                </div>
                <div className="form-actions-right">
                  <button
                    className="primary-button"
                    disabled={isGeneratingVetReport}
                    type="submit"
                  >
                    {isGeneratingVetReport
                      ? 'Generating vetting report...'
                      : 'Generate vetting report'}
                  </button>
                </div>
              </div>

              {vetSoftwareReport && (
                <div className="model-response" aria-live="polite">
                  <h3>vLLM risk assessment report</h3>
                  <p>{vetSoftwareReport}</p>
                </div>
              )}

              {vetAppendixOutput && (
                <div className="model-response" aria-live="polite">
                  <h3>RAG security assessment appendix</h3>
                  <p>
                    Script: <code>{vetAppendixMeta?.scriptPath || ragSecurityScriptPath}</code>
                  </p>
                  <p>
                    Runtime: <code>{vetAppendixMeta?.model || vllmModel}</code> via{' '}
                    <code>{vetAppendixMeta?.origin || 'http://localhost:8000'}</code>
                    {' '}
                    <code>{vetAppendixMeta?.chatPath || '/v1/chat/completions'}</code>
                  </p>
                  <p>{ragSecurityScriptSummary}</p>
                  {parsedVetAppendix ? (
                    <div className="appendix-sections">
                      <div className="appendix-section">
                        <h4>Assessment snapshot</h4>
                        <p>
                          Tool under test: <strong>{parsedVetAppendix.tool || 'N/A'}</strong>
                        </p>
                        <p>
                          Risk score (1-5): <strong>{parsedVetAppendix.riskScore || 'N/A'}</strong>{' '}
                          | Confidence (0-100):{' '}
                          <strong>{parsedVetAppendix.confidenceScore || 'N/A'}</strong>
                        </p>
                        {parsedVetAppendix.retrievalQuery && (
                          <p className="appendix-query">
                            <strong>Retrieval query:</strong>{' '}
                            {parsedVetAppendix.retrievalQuery}
                          </p>
                        )}
                      </div>

                      <div className="appendix-section">
                        <h4>Retrieved risks</h4>
                        {parsedVetAppendix.retrievedRisks.length > 0 ? (
                          <ul className="appendix-list">
                            {parsedVetAppendix.retrievedRisks.map((riskLine) => (
                              <li key={riskLine}>{riskLine.replace(/^- /, '')}</li>
                            ))}
                          </ul>
                        ) : (
                          <p>No retrieved risks were captured.</p>
                        )}
                      </div>

                      <div className="appendix-section">
                        <h4>Observed vulnerabilities input (garak)</h4>
                        <pre className="appendix-pre">
                          {parsedVetAppendix.garakJson || '{}'}
                        </pre>
                      </div>

                      <div className="appendix-section">
                        <h4>Generated assessment narrative</h4>
                        <pre className="appendix-pre">
                          {parsedVetAppendix.narrativeReport || parsedVetAppendix.raw}
                        </pre>
                      </div>
                    </div>
                  ) : (
                    <pre className="appendix-pre">{vetAppendixOutput}</pre>
                  )}
                </div>
              )}
            </form>
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
