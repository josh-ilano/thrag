# THRAG: Tool & Model Risk Assessment Workspace

THRAG is an AI governance and risk management application that helps teams evaluate AI systems before production rollout.

It supports two end-to-end workflows:

1. **Vet an AI tool/model**: Generate a detailed risk assessment report for one specific model.
2. **Choose an AI tool/model**: Collect requirements through iterative questioning and return a ranked top-5 model recommendation with governance notes.

The app combines:
- a React frontend,
- Supabase authentication,
- local or self-hosted vLLM inference,
- and a local RAG security appendix script with simulated or JSON-based Garak signals.

## What This Program Does

THRAG is designed for security, legal, product, and engineering stakeholders who need decision-ready artifacts for model governance.

### Workflow 1: Vet an AI tool

The user submits:
- model name,
- intended use,
- deployment context.

The system then runs two parallel actions:
- **vLLM risk report generation** via `/api/chat` (OpenAI-compatible endpoint),
- **RAG security appendix generation** via `/api/rag-security-assessment` (Vite middleware that launches a local Python script).

The UI renders:
- the narrative vetting report,
- parsed appendix metadata (risk score, confidence score, retrieval query),
- retrieved risks,
- observed vulnerability inputs (Garak JSON payload section),
- and generated assessment narrative.

### Workflow 2: Choose an AI tool

The user provides:
- desired AI capability,
- risk assessment constraints,
- model type expectations,
- cost limits,
- data/privacy requirements.

THRAG then runs an iterative interview loop (up to 6 rounds):
- generates tailored follow-up questions,
- prevents repeated/similar questions,
- collects answers to refine the recommendation context.

Final output is strict JSON with:
- exactly 5 ranked model recommendations from an allowed model catalog,
- provider attribution,
- fit/risk/cost/governance fields,
- best overall model selection.

If model output is malformed, THRAG applies correction and fallback logic:
- retry with stricter prompt,
- parse model mentions from free text,
- deterministic local recommendation fallback.

## Full Context and Scope

This repository is a **frontend-centered governance MVP** for applied AI risk decisions. It is not a generic chatbot. It is a structured decision-support system with guardrails and reproducible outputs.

Scope includes:
- account-based access (Supabase auth),
- risk-focused workflow UX,
- controlled prompt contracts for report generation,
- explicit model catalog constraints for recommendation output,
- local script integration for RAG-based appendix generation,
- output persistence from the external script (see `outputs/` directory artifacts).

Current non-scope:
- no backend database persistence for assessments yet,
- no enterprise RBAC policy engine,
- no built-in Garak runner inside this repository (the assessment script is external and invoked by path),
- no production deployment configuration in this repo by default.

## RAG Security Script + Garak Context

The app integrates a local Python script through the Vite middleware endpoint:
- `POST /api/rag-security-assessment`

By default, the script path is:
- `/Users/joshilano/Downloads/rag_security_assessment.py`

The script contract (as reflected in the UI and middleware) is:
- receives tool/model context through env vars (`TOOL_UNDER_TEST`, `VLLM_MODEL`, `VLLM_ORIGIN`, `VLLM_CHAT_PATH`),
- retrieves relevant risk snippets from a local dataset (vector or TF-IDF fallback),
- consumes simulated or file-provided Garak vulnerability results,
- computes risk and confidence scores,
- prompts a local vLLM model for a security narrative,
- returns structured debug sections that the React app parses and displays.

Important: this repository **invokes** the RAG/Garak script but does not include the Python implementation itself.

## vLLM Usage

THRAG uses vLLM as the model-serving runtime for generation:

- Frontend calls `POST /api/chat`.
- Vite dev server proxies that endpoint to:
  - `VITE_VLLM_ORIGIN` + `/v1/chat/completions`
- Requests follow OpenAI-style chat completions payload format.

Defaults:
- `VITE_VLLM_ORIGIN=http://localhost:8000`
- `VITE_VLLM_MODEL=TinyLlama/TinyLlama-1.1B-Chat-v1.0`

RAG appendix route can override runtime separately:
- `RAG_VLLM_MODEL`
- `RAG_VLLM_ORIGIN`
- `RAG_VLLM_CHAT_PATH`

## Stack and Components Used

- **Frontend**: React 19 + Vite
- **Auth**: Supabase (`@supabase/supabase-js`)
- **Inference runtime**: vLLM OpenAI-compatible server
- **Local security appendix execution**: Node child process (`python3` spawn in `vite.config.js`)
- **Styling**: plain CSS (`src/App.css`, `src/index.css`)
- **Linting**: ESLint flat config

Primary files:
- `src/App.jsx`: workflow orchestration, prompt construction, parsing, and UX state machine.
- `src/lib/supabaseClient.js`: auth client initialization and env validation.
- `vite.config.js`: API proxy and custom middleware for script execution.

## Setup

### 1) Install

```bash
npm install
```

### 2) Configure environment

Create `.env` (or copy from `.env.example`) in `thrag/`:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
VITE_VLLM_ORIGIN=http://localhost:8000
VITE_VLLM_MODEL=TinyLlama/TinyLlama-1.1B-Chat-v1.0
```

Optional RAG script settings:

```env
RAG_SECURITY_SCRIPT_PATH=/absolute/path/to/rag_security_assessment.py
RAG_VLLM_MODEL=TinyLlama/TinyLlama-1.1B-Chat-v1.0
RAG_VLLM_ORIGIN=http://localhost:8000
RAG_VLLM_CHAT_PATH=/v1/chat/completions
```

### 3) Start services

1. Start your vLLM server (OpenAI-compatible chat endpoint).
2. Ensure Python 3 is available and the RAG script path is valid.
3. Start app:

```bash
npm run dev
```

## Development Scripts

- `npm run dev` - start Vite dev server
- `npm run build` - production build
- `npm run preview` - preview built app
- `npm run lint` - run ESLint

## Operational Notes

- Supabase env vars are required for sign-in/register flows.
- If vLLM is unavailable, report/question generation requests will fail with API error messages.
- If the RAG script is missing, misconfigured, or times out, the vetting appendix route returns a 500 error.
- The middleware currently enforces a script timeout (`120000ms`).

## Why This Project Exists

THRAG addresses a common governance gap: teams can access AI quickly, but often lack consistent, structured risk evaluation workflows before launch.

This project provides a practical bridge between:
- model capability selection,
- security/compliance risk triage,
- and implementation-facing controls.

In short: **THRAG helps teams choose and approve AI systems with explicit risk context instead of ad hoc judgement.**
