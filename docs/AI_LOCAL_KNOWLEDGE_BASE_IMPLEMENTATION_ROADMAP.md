# AI Local Knowledge Base — Implementation Roadmap & Task Breakdown

**Date:** May 5, 2026  
**Project Duration:** 4-5 weeks  
**Team Size:** 5 people (1 Senior Dev, 1 Full-Stack Dev, 1 Frontend Dev, 1 ML Engineer, 1 QA)  
**Status:** READY FOR KICKOFF  

---

## PROJECT TIMELINE

```
Week 1 ─────────┬─────────────────────┬──────────────────────
        Phase 1 │ Knowledge Ingestion │ (Parallel: Initial setup)
          └─────┴─────────────────────┘

Week 2 ──────────────┬──────────────────┬────────────────────────
             Phase 1 │ KB Structuring   │ + Phase 2: QA Engine Start
                  └──┴──────────────────┘

Week 3 ───────────────────┬──────────────┬────────────────────────
                    Phase 2 │ QA Engine    │ + Phase 3: UI Development
                          │ (Complete)   │
                          └──────────────┘

Week 4 ────────────────────────┬──────────┬────────────────────────
                         Phase 3 │ UIs      │ + Phase 4: LLM Integration
                              │ (Test)   │
                              └──────────┘

Week 5 ────────────────────────────┬──┬────────────────────────────
                              Phase 4 │ │ Final QA + Launch
                                    └──┴────────────────────────────

        ↓
    Private Alpha (Team Only)
        ↓
    Internal Beta (Dev Friendly)
        ↓
    Production Soft Launch
```

---

## PHASE 1: KNOWLEDGE INGESTION & STRUCTURING (Week 1-2)

### 1.1 Codebase Analysis Automation

**Owner:** Senior Dev + ML Engineer  
**Duration:** 5-6 days  
**Inputs:** Entire `/server` and `/client` source code  
**Outputs:** Structured knowledge JSON (routers, services, types)  

**Tasks:**

| # | Task | Details | Effort | Owner | Status |
|---|------|---------|--------|-------|--------|
| 1.1.1 | Create TypeScript AST Parser | Parse `.ts` files → extract functions, exports, JSDoc | 8h | Senior Dev | TODO |
| 1.1.2 | Generate Router Catalog | For each router: endpoints, input/output types, permissions, caching, rate limits | 10h | Senior Dev | TODO |
| 1.1.3 | Generate Service Catalog | For each service: functions, dependencies, algorithms, performance notes | 10h | Senior Dev | TODO |
| 1.1.4 | Extract Type Definitions | All Zod schemas + TypeScript types → dictionary | 6h | Senior Dev | TODO |
| 1.1.5 | Build Code Dependency Graph | What calls what, data flow between layers | 8h | ML Engineer | TODO |
| 1.1.6 | Document Data Flow Patterns | Common patterns: query → service → cache → DB | 6h | Senior Dev | TODO |
| **Total** | | | **48h** | | |

**Deliverables:**
- `knowledge/routers-catalog.json` (structure of all 60+ routers)
- `knowledge/services-catalog.json` (all 45+ services with signatures)
- `knowledge/types-dictionary.json` (all DTO/Entity types)
- `knowledge/code-graph.json` (dependency graph)
- `knowledge/patterns.json` (common code patterns)

---

### 1.2 Documentation Consolidation

**Owner:** Technical Writer + Senior Dev  
**Duration:** 3-4 days  
**Inputs:** All docs in `apidocs/`, `docs/`, and README files  
**Outputs:** Structured knowledge fragments (100-200 words each)  

**Tasks:**

| # | Task | Details | Effort | Owner | Status |
|---|------|---------|--------|-------|--------|
| 1.2.1 | Index All Docs | Create manifest of every `.md` file + metadata | 4h | Tech Writer | TODO |
| 1.2.2 | Extract API Protocol | From AUTHENTICATION.md → structured Q&A pairs | 6h | Tech Writer | TODO |
| 1.2.3 | Extract Error Codes | From ERROR_CODES.md → error → cause → solution | 4h | Tech Writer | TODO |
| 1.2.4 | Extract MQTT Architecture | From MQTT_INDEX.md → architecture + setup + troubleshooting | 8h | Senior Dev | TODO |
| 1.2.5 | Extract AI Features | From AI_UPGRADE_PLAN.md → feature descriptions + roadmap | 6h | Tech Writer | TODO |
| 1.2.6 | Extract Best Practices | From all docs → patterns + anti-patterns | 6h | Senior Dev | TODO |
| 1.2.7 | Fill Documentation Gaps | Identify missing docs + inline code comments | 8h | Senior Dev | TODO |
| **Total** | | | **42h** | | |

**Deliverables:**
- `knowledge/api-protocol.json` (auth, request/response format, examples)
- `knowledge/error-codes.json` (error → troubleshooting)
- `knowledge/mqtt-guide.json` (MQTT architecture + setup)
- `knowledge/features.json` (all features + usage)
- `knowledge/best-practices.json` (do's & don'ts)

---

### 1.3 Schema & Data Model Documentation

**Owner:** Senior Dev  
**Duration:** 3-4 days  
**Inputs:** Drizzle schema files from `/drizzle` directory  
**Outputs:** Entity relationships + data dictionary  

**Tasks:**

| # | Task | Details | Effort | Owner | Status |
|---|------|---------|--------|-------|--------|
| 1.3.1 | Generate Entity Relationship Diagram | 99 tables → ER diagram + descriptions | 6h | Senior Dev | TODO |
| 1.3.2 | Create Entity Dictionary | For each main entity: fields, types, constraints, examples | 10h | Senior Dev | TODO |
| 1.3.3 | Document Common Queries | SELECT, JOIN patterns used throughout codebase | 6h | Senior Dev | TODO |
| 1.3.4 | Document Data Constraints | Validation rules, unique constraints, foreign keys | 4h | Senior Dev | TODO |
| **Total** | | | **26h** | | |

**Deliverables:**
- `knowledge/schema-diagram.json` (ER model, visual + JSON)
- `knowledge/entity-dictionary.json` (each table explained)
- `knowledge/common-queries.json` (SQL patterns)
- `knowledge/constraints.json` (business rules + validation)

---

### 1.4 Knowledge Graph Construction

**Owner:** ML Engineer  
**Duration:** 4-5 days  
**Inputs:** All structured knowledge from 1.1, 1.2, 1.3  
**Outputs:** Vector embeddings + semantic relationships  

**Tasks:**

| # | Task | Details | Effort | Owner | Status |
|---|------|---------|--------|-------|--------|
| 1.4.1 | Chunk Knowledge Sources | Break into 500-word chunks for embeddings | 6h | ML Engineer | TODO |
| 1.4.2 | Generate Embeddings | Using all-MiniLM-L6-v2 model (or cloud API) | 4h | ML Engineer | TODO |
| 1.4.3 | Setup Vector DB (Chroma) | Local Chroma instance + API | 4h | ML Engineer | TODO |
| 1.4.4 | Build Semantic Graph | Link related chunks (inspection → image → quality → AI) | 8h | ML Engineer | TODO |
| 1.4.5 | Create BM25 Index | Keyword search fallback (using SQLite FTS or MeiliSearch) | 4h | ML Engineer | TODO |
| 1.4.6 | QA Vector Embeddings | Spot-check: similar questions have similar embeddings | 4h | ML Engineer | TODO |
| **Total** | | | **30h** | | |

**Deliverables:**
- `knowledge-db/chroma/` (vector store with 10,000+ embeddings)
- `knowledge-db/metadata.sqlite` (chunk metadata + BM25 index)
- `knowledge/semantic-graph.json` (relationships between chunks)
- `knowledge/test-queries.json` (test Q&As for validation)

---

### Phase 1 Subtotal
- **Total Effort:** 146 hours
- **Team:** 2 Senior Devs, 1 ML Engineer, 1 Tech Writer
- **Duration:** 5-6 calendar days (parallel execution)
- **Milestone:** End of Week 1

---

## PHASE 2: QUESTION-ANSWERING ENGINE (Week 2-3)

### 2.1 Query Understanding Module

**Owner:** Full-Stack Dev + ML Engineer  
**Duration:** 3-4 days  
**Inputs:** Chunked knowledge + training Q&As  
**Outputs:** Intent classifier + entity extractor  

**Tasks:**

| # | Task | Details | Effort | Owner | Status |
|---|------|---------|--------|-------|--------|
| 2.1.1 | Intent Classifier | Train classifier: how-to, troubleshoot, explain, architecture | 6h | ML Engineer | TODO |
| 2.1.2 | Entity Extractor | Extract router names, feature names, error codes from questions | 8h | ML Engineer | TODO |
| 2.1.3 | Language Detector | Detect Vietnamese vs English + auto-translate if needed | 4h | Full-Stack Dev | TODO |
| 2.1.4 | Question Normalizer | Normalize variations: "how do I...?" → "How to ..." | 4h | Full-Stack Dev | TODO |
| 2.1.5 | Build Training Data | 500+ example Q&As for classifier training | 8h | Tech Writer + Senior Dev | TODO |
| **Total** | | | **30h** | | |

**Deliverables:**
- Intent classifier model (saved weights)
- Entity extractor model
- Language detection service
- Training dataset (500+ examples)

---

### 2.2 Retrieval System

**Owner:** ML Engineer + Full-Stack Dev  
**Duration:** 3-4 days  
**Inputs:** Vector DB + BM25 index + semantic graph  
**Outputs:** Hybrid retrieval engine  

**Tasks:**

| # | Task | Details | Effort | Owner | Status |
|---|------|---------|--------|-------|--------|
| 2.2.1 | Semantic Search (Vector) | Query embedding + top-5 similarity search | 4h | ML Engineer | TODO |
| 2.2.2 | Keyword Search (BM25) | Fallback + boosting for exact matches | 4h | ML Engineer | TODO |
| 2.2.3 | Result Reranking | Combine vector + keyword scores, apply relevance filters | 6h | ML Engineer | TODO |
| 2.2.4 | Context Augmentation | Add related chunks based on semantic graph | 4h | ML Engineer | TODO |
| 2.2.5 | Caching Layer | Cache retrievals to avoid repeated searches (Redis) | 4h | Full-Stack Dev | TODO |
| 2.2.6 | Retrieval Benchmarks | Measure latency, recall, precision | 6h | ML Engineer | TODO |
| **Total** | | | **28h** | | |

**Deliverables:**
- Retrieval API (REST endpoint, takes question → returns top-5 chunks)
- Performance benchmarks
- Caching configuration

---

### 2.3 Answer Generation & Synthesis

**Owner:** Full-Stack Dev + ML Engineer  
**Duration:** 3-4 days  
**Inputs:** Retrieved chunks + LLM access  
**Outputs:** Answer synthesis engine  

**Tasks:**

| # | Task | Details | Effort | Owner | Status |
|---|------|---------|--------|-------|--------|
| 2.3.1 | Template-Based Answers | For FAQ: pre-written answers (no LLM needed) | 6h | Tech Writer | TODO |
| 2.3.2 | LLM Integration | Call OpenAI/Anthropic (cloud fallback) | 6h | Full-Stack Dev | TODO |
| 2.3.3 | Answer Synthesis Prompt | Well-crafted system prompt for codebase context | 4h | Senior Dev + Full-Stack Dev | TODO |
| 2.3.4 | Citation Tracking | Track which chunks contributed to each answer | 4h | Full-Stack Dev | TODO |
| 2.3.5 | Format Conversion | Convert answers to markdown + code syntax highlighting | 4h | Full-Stack Dev | TODO |
| 2.3.6 | Confidence Scoring | Estimate answer quality (high/medium/low) | 4h | ML Engineer | TODO |
| **Total** | | | **28h** | | |

**Deliverables:**
- Answer generation API
- FAQ database (500+ Q&A pairs)
- Citation format + sources
- Confidence scorer

---

### 2.4 Quality Assurance & Fact-Checking

**Owner:** QA + ML Engineer  
**Duration:** 2-3 days  
**Inputs:** Generated answers from 2.3  
**Outputs:** QA & fact-check layer  

**Tasks:**

| # | Task | Details | Effort | Owner | Status |
|---|------|---------|--------|-------|--------|
| 2.4.1 | Build QA Test Suite | 200+ test Q&As with expected answers | 8h | QA + Tech Writer | TODO |
| 2.4.2 | Automated Validation | Check if answers match test expectations | 6h | ML Engineer | TODO |
| 2.4.3 | Hallucination Detection | Identify made-up information in answers | 4h | ML Engineer | TODO |
| 2.4.4 | Error Code Validation | Verify all error codes/solutions are accurate | 4h | QA | TODO |
| 2.4.5 | Fallback Mechanism | When confidence < 60%, suggest "I don't know" + escalation | 4h | Full-Stack Dev | TODO |
| **Total** | | | **26h** | | |

**Deliverables:**
- QA test suite (200+ cases)
- Automated validation pipeline
- Hallucination filter
- Error rate < 15% on test cases

---

### Phase 2 Subtotal
- **Total Effort:** 112 hours
- **Team:** 1 Full-Stack Dev, 1 ML Engineer, 1 QA, 1 Tech Writer, 1 Senior Dev (part-time)
- **Duration:** 6-7 calendar days
- **Milestone:** End of Week 2 + beginning of Week 3

---

## PHASE 3: USER INTERFACES (Week 3-4)

### 3.1 In-App Chat Sidebar

**Owner:** Frontend Dev  
**Duration:** 3-4 days  
**Inputs:** QA API from Phase 2  
**Outputs:** React sidebar component in admin panel  

**Tasks:**

| # | Task | Details | Effort | Owner | Status |
|---|------|---------|--------|-------|--------|
| 3.1.1 | Design Chat UI Mockup | Sidebar, message bubbles, input field (Figma/Sketch) | 2h | Frontend Dev | TODO |
| 3.1.2 | Build Chat Component | React component: message list, input, send button | 6h | Frontend Dev | TODO |
| 3.1.3 | Connect to QA API | Call `/api/ask` endpoint, stream responses | 4h | Frontend Dev | TODO |
| 3.1.4 | Add Chat History | Store messages in localStorage, persist per session | 4h | Frontend Dev | TODO |
| 3.1.5 | Context Awareness | Detect current admin page → suggest related topics | 4h | Frontend Dev | TODO |
| 3.1.6 | Export as Guide | Save conversation as markdown guide for sharing | 4h | Frontend Dev | TODO |
| 3.1.7 | Test & Polish | UX testing, accessibility, responsive design | 6h | Frontend Dev + QA | TODO |
| **Total** | | | **30h** | | |

**Deliverables:**
- React sidebar component
- Chat API integration
- History persistence
- Context-aware suggestions
- Export to markdown

---

### 3.2 CLI Tool for Developers

**Owner:** Full-Stack Dev  
**Duration:** 2-3 days  
**Inputs:** QA API from Phase 2  
**Outputs:** Standalone CLI tool (`ai-help` command)  

**Tasks:**

| # | Task | Details | Effort | Owner | Status |
|---|------|---------|--------|-------|--------|
| 3.2.1 | Build CLI Command | Argument parsing (question, format, language) | 4h | Full-Stack Dev | TODO |
| 3.2.2 | Rich Text Formatting | Colors, tables, code blocks (using Chalk + table libs) | 4h | Full-Stack Dev | TODO |
| 3.2.3 | Local Cache | Cache answers locally to avoid repeated API calls | 3h | Full-Stack Dev | TODO |
| 3.2.4 | Offline Mode | Fallback to cached answers if API unavailable | 2h | Full-Stack Dev | TODO |
| 3.2.5 | npm Package Publishing | Create npm package, publish to npmjs.com | 4h | Full-Stack Dev | TODO |
| 3.2.6 | Installation Guide | Document installation + usage | 2h | Tech Writer | TODO |
| 3.2.7 | Developer Testing | Internal testing, feedback from dev team | 4h | Developer Team | TODO |
| **Total** | | | **23h** | | |

**Deliverables:**
- CLI npm package (`npx ai-help`)
- Installation + usage guide
- Offline capability
- Local caching

---

### 3.3 Smart Help Buttons

**Owner:** Frontend Dev  
**Duration:** 2-3 days  
**Inputs:** QA API + admin page analysis  
**Outputs:** Context-sensitive help system  

**Tasks:**

| # | Task | Details | Effort | Owner | Status |
|---|------|---------|--------|-------|--------|
| 3.3.1 | Identify Help Locations | Find complex features needing help buttons | 4h | Frontend Dev + Product | TODO |
| 3.3.2 | Build Help Button Component | Small icon button, triggers modal with AI answer | 4h | Frontend Dev | TODO |
| 3.3.3 | Context-to-Query Mapping | Map page + feature to predefined question | 4h | Frontend Dev | TODO |
| 3.3.4 | Tooltip/Inline Help | Show quick tips without opening modal | 4h | Frontend Dev | TODO |
| 3.3.5 | Keyboard Shortcut | Add Cmd+Shift+? to access help | 2h | Frontend Dev | TODO |
| 3.3.6 | Test Coverage | Test all help buttons, verify accuracy | 4h | QA | TODO |
| **Total** | | | **22h** | | |

**Deliverables:**
- Help button component
- Context-to-question mapping
- Keyboard shortcuts
- Integration on 10+ key pages

---

### Phase 3 Subtotal
- **Total Effort:** 75 hours
- **Team:** 1 Frontend Dev, 1 Full-Stack Dev, 1 Tech Writer, QA (part-time)
- **Duration:** 5-6 calendar days
- **Milestone:** End of Week 3 + beginning of Week 4

---

## PHASE 4: LOCAL LLM INTEGRATION (Week 4-5)

### 4.1 Local LLM Setup

**Owner:** ML Engineer  
**Duration:** 2-3 days  
**Inputs:** None (infrastructure setup)  
**Outputs:** Running Ollama instance with models  

**Tasks:**

| # | Task | Details | Effort | Owner | Status |
|---|------|---------|--------|-------|--------|
| 4.1.1 | Ollama Installation | Setup Ollama on dev/staging/prod machines | 2h | ML Engineer | TODO |
| 4.1.2 | Model Download | Pull Llama2-7B-chat (or Phi-2 for lightweight) | 2h | ML Engineer | TODO |
| 4.1.3 | Model Quantization | Optional: 4-bit quantization to save memory | 4h | ML Engineer | TODO |
| 4.1.4 | Ollama API Server | Configure REST API endpoint + port | 2h | ML Engineer | TODO |
| 4.1.5 | Create Installation Guide | Step-by-step for team members | 2h | Tech Writer | TODO |
| 4.1.6 | Benchmark Model | Measure latency + accuracy on test Q&As | 2h | ML Engineer | TODO |
| **Total** | | | **14h** | | |

**Deliverables:**
- Ollama running on port 11434
- Model loaded and tested
- Installation documentation

---

### 4.2 QA API Enhancement for Local LLM

**Owner:** Full-Stack Dev + ML Engineer  
**Duration:** 2-3 days  
**Inputs:** Existing QA API, local LLM service  
**Outputs:** Updated QA API with local LLM fallback  

**Tasks:**

| # | Task | Details | Effort | Owner | Status |
|---|------|---------|--------|-------|--------|
| 4.2.1 | Fallback Logic | Try local LLM first, fallback to cloud (OpenAI) | 4h | Full-Stack Dev | TODO |
| 4.2.2 | Health Check | Monitor local LLM health, auto-switch if down | 3h | Full-Stack Dev | TODO |
| 4.2.3 | Response Latency Optimization | Cache responses, batch requests | 4h | ML Engineer | TODO |
| 4.2.4 | Update Prompts | Optimize for Llama2 vs. GPT-3.5 differences | 4h | ML Engineer + Senior Dev | TODO |
| 4.2.5 | Performance Testing | Benchmark with 100+ concurrent requests | 4h | ML Engineer + QA | TODO |
| **Total** | | | **19h** | | |

**Deliverables:**
- Updated QA API (with local LLM support)
- Fallback logic + health checks
- Performance benchmarks

---

### 4.3 Offline Mode & Caching

**Owner:** Full-Stack Dev  
**Duration:** 1-2 days  
**Inputs:** Local LLM + caching strategy  
**Outputs:** Persistent cache layer  

**Tasks:**

| # | Task | Details | Effort | Owner | Status |
|---|------|---------|--------|-------|--------|
| 4.3.1 | Persistent Cache DB | SQLite for frequently-asked Q&As | 2h | Full-Stack Dev | TODO |
| 4.3.2 | Cache Warming | Pre-populate cache with top 100 Q&As | 2h | Full-Stack Dev | TODO |
| 4.3.3 | Cache Invalidation | Clear cache on KB updates (CI/CD trigger) | 2h | Full-Stack Dev | TODO |
| 4.3.4 | Offline Detection | Detect no-internet mode, use only cache | 2h | Full-Stack Dev | TODO |
| **Total** | | | **8h** | | |

**Deliverables:**
- Persistent cache (SQLite)
- Cache warming script
- Offline mode detection

---

### 4.4 Integration Testing & Launch Prep

**Owner:** QA + Full-Stack Dev  
**Duration:** 2-3 days  
**Inputs:** All Phase 4 components  
**Outputs:** Ready-to-launch system  

**Tasks:**

| # | Task | Details | Effort | Owner | Status |
|---|------|---------|--------|-------|--------|
| 4.4.1 | End-to-End Tests | Full Q → Answer flow (local LLM path) | 6h | QA + Full-Stack Dev | TODO |
| 4.4.2 | Fallback Testing | Cloud API fallback when LLM fails | 4h | QA | TODO |
| 4.4.3 | Performance Testing | Latency, throughput, memory under load | 6h | ML Engineer | TODO |
| 4.4.4 | Documentation | Setup guide, troubleshooting, FAQ | 4h | Tech Writer | TODO |
| 4.4.5 | Launch Checklist | Pre-flight checks before rollout | 2h | Full-Stack Dev | TODO |
| **Total** | | | **22h** | | |

**Deliverables:**
- Integration test suite (50+ tests)
- Performance reports
- Launch documentation
- Go/No-Go checklist

---

### Phase 4 Subtotal
- **Total Effort:** 63 hours
- **Team:** 1 ML Engineer, 1 Full-Stack Dev, 1 QA, 1 Tech Writer
- **Duration:** 5-7 calendar days
- **Milestone:** End of Week 4

---

## PHASE 5: LAUNCH & MAINTENANCE (Week 5 onwards)

### 5.1 Private Alpha (Internal Team Only)

**Duration:** 3-5 days  
**Scope:** Sidebar chat only, limited to 5-10 internal users  
**Goals:** Gather feedback, fix critical bugs, verify accuracy  

**Tasks:**
- Deploy to staging
- Invite team members to test
- Collect feedback (Slack channel or form)
- Fix top 5 issues
- Measure: Adoption rate, user satisfaction, accuracy

---

### 5.2 Internal Beta (Developers)

**Duration:** 3-5 days  
**Scope:** CLI tool + chat, limited to dev team  
**Goals:** Developer feedback, polish UX, optimize performance  

**Tasks:**
- Release CLI as npm package
- Invite all developers to test
- Gather feature requests
- Optimize based on feedback
- Measure: CLI usage, response times, satisfaction

---

### 5.3 Production Soft Launch

**Duration:** 1-2 weeks  
**Scope:** Chat + CLI + help buttons, all users but optional  
**Goals:** Monitor for issues, gather metrics, build confidence  

**Tasks:**
- Deploy to production (feature-flagged)
- Monitor error rates, response times
- Collect user feedback
- Make adjustments based on data
- Measure: Adoption rate, support ticket reduction

---

### 5.4 Full Production Launch

**Duration:** Ongoing  
**Scope:** All UIs active, default feature for all users  
**Goals:** Full rollout, continuous improvement  

**Tasks:**
- Activate all features
- Monitor daily
- Collect usage analytics
- Plan Phase 5 (continuous learning)

---

### 5.5 Continuous Learning & Maintenance

**Ongoing (1 developer part-time)**

- **Auto-rebuild KB** on each commit (CI/CD)
- **Weekly doc sync** + retraining
- **User feedback loop** → improve retrieval
- **New issues** → extract learnings
- **Quarterly audits** → gap-filling + improvements

---

## RESOURCE ALLOCATION

### Week-by-Week Team Utilization

```
WEEK 1 (Knowledge Phase)
┌─────────────────────────────────────────────────────┐
│ Senior Dev 1      : 40h (Codebase analysis)        │
│ Senior Dev 2      : 20h (Documentation)            │
│ ML Engineer       : 20h (Vector DB setup)          │
│ Tech Writer       : 10h (Doc consolidation)        │
│ Full-Stack Dev    : 10h (Infrastructure)           │
└─────────────────────────────────────────────────────┘
Total: 100h (but 5 people × 5 days = 200h capacity)
Utilization: 50% → room for other tasks

WEEK 2 (QA Engine + KB Completion)
┌─────────────────────────────────────────────────────┐
│ Senior Dev        : 20h (Advisory)                 │
│ ML Engineer       : 40h (QA engine)                │
│ Full-Stack Dev    : 30h (QA engine)                │
│ Tech Writer       : 15h (Training data)            │
│ QA                : 10h (Test suite)               │
└─────────────────────────────────────────────────────┘
Total: 115h
Utilization: 60%

WEEK 3 (UI Development + QA Engine Finalization)
┌─────────────────────────────────────────────────────┐
│ Frontend Dev      : 40h (Chat sidebar + buttons)   │
│ Full-Stack Dev    : 30h (QA API + CLI)             │
│ ML Engineer       : 20h (Optimization)             │
│ QA                : 20h (UI testing)               │
│ Tech Writer       : 10h (Documentation)            │
│ Senior Dev        : 10h (Review)                   │
└─────────────────────────────────────────────────────┘
Total: 130h
Utilization: 65%

WEEK 4 (LLM Integration + UI Polish)
┌─────────────────────────────────────────────────────┐
│ ML Engineer       : 30h (Ollama + optimization)    │
│ Full-Stack Dev    : 25h (API enhancement)          │
│ Frontend Dev      : 20h (Bug fixes + polish)       │
│ QA                : 20h (Integration testing)      │
│ Tech Writer       : 10h (Setup guide)              │
└─────────────────────────────────────────────────────┘
Total: 105h
Utilization: 52%

WEEK 5 (Launch Prep + Final QA)
┌─────────────────────────────────────────────────────┐
│ QA                : 30h (Launch testing)           │
│ Full-Stack Dev    : 20h (Bug fixes)                │
│ Frontend Dev      : 10h (UX polish)                │
│ Tech Writer       : 10h (Final docs)               │
│ ML Engineer       : 5h (Monitoring setup)          │
└─────────────────────────────────────────────────────┘
Total: 75h
Utilization: 38%
```

**Total Project Effort:** 525 hours (roughly 130 hours/week average)

---

## TEAM ROLE DEFINITIONS

| Role | Primary Responsibilities | Effort/Week | Tools |
|------|--------------------------|-------------|-------|
| **Senior Dev** | Architecture decisions, code review, knowledge extraction, mentoring | 10-15h | TypeScript, AST, Git |
| **Full-Stack Dev** | QA API, CLI tool, caching, fallback logic | 20-30h | Node.js, Express, TypeScript |
| **Frontend Dev** | Chat UI, help buttons, UX/accessibility | 15-25h | React, TypeScript, TailwindCSS |
| **ML Engineer** | LLM setup, embeddings, retrieval, optimization | 15-25h | Python (optional), Ollama, Chroma |
| **QA** | Test suite, validation, integration testing, bug reports | 10-20h | Manual testing, automated tests |
| **Tech Writer** | Documentation, training data, setup guides | 5-10h | Markdown, technical writing |

---

## DEPENDENCIES & CRITICAL PATH

```
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 1: Knowledge Ingestion                                   │
│ ├─ 1.1 Codebase Analysis (5-6 days)                           │
│ ├─ 1.2 Doc Consolidation (3-4 days, parallel)                 │
│ ├─ 1.3 Schema Documentation (3-4 days, parallel)              │
│ └─ 1.4 Knowledge Graph (4-5 days, after 1.1-1.3)             │
│    └─ MILESTONE: Knowledge DB ready (end Week 1)              │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│ PHASE 2: QA Engine                                             │
│ ├─ 2.1 Query Understanding (3-4 days)                         │
│ ├─ 2.2 Retrieval System (3-4 days, parallel)                 │
│ ├─ 2.3 Answer Generation (3-4 days, after 2.1-2.2)          │
│ └─ 2.4 Quality Assurance (2-3 days)                          │
│    └─ MILESTONE: QA API ready (mid Week 2)                   │
└──────────────────────────┬──────────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
┌───────▼────────┐ ┌───────▼────────┐ ┌──────▼────────┐
│ PHASE 3a:      │ │ PHASE 3b:      │ │ PHASE 4:      │
│ Chat Sidebar   │ │ CLI + Buttons  │ │ LLM Setup     │
│ (Week 3-4)     │ │ (Week 3-4)     │ │ (Week 4)      │
└────────────────┘ └────────────────┘ └────────────────┘
        │                  │                  │
        └──────────────────┼──────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│ PHASE 5: Launch Prep                                           │
│ ├─ Integration Testing                                        │
│ ├─ Launch Checklist                                           │
│ └─ MILESTONE: Production Ready (end Week 4/5)               │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                    SOFT LAUNCH (Week 5)
                           │
                    FULL LAUNCH (Week 6)
```

**Critical Path:** Phase 1 → Phase 2 → Phase 3 & 4 (parallel) → Phase 5

---

## SUCCESS CRITERIA (Go/No-Go for Each Phase)

### Phase 1 Go-Gate
- [ ] Knowledge DB contains > 10,000 embeddings
- [ ] Schema documentation 100% complete
- [ ] No critical gaps in codebase knowledge
- [ ] Vector search latency < 500ms

### Phase 2 Go-Gate
- [ ] QA accuracy > 80% on 200 test cases
- [ ] Retrieval precision > 0.75
- [ ] Answer latency < 3s (with cloud API fallback)
- [ ] No hallucinations on error codes

### Phase 3 Go-Gate
- [ ] Chat UI responds to questions in < 2s
- [ ] CLI tool outputs formatted answers correctly
- [ ] Help buttons appear on 10+ key pages
- [ ] No accessibility issues (WCAG AA compliant)

### Phase 4 Go-Gate
- [ ] Local LLM responds in < 5s for typical questions
- [ ] Fallback to cloud API works seamlessly
- [ ] Offline mode uses cache correctly
- [ ] Memory usage < 2GB (on typical machine)

### Phase 5 Go-Gate
- [ ] All integration tests pass (50+ tests)
- [ ] Performance benchmarks acceptable
- [ ] No critical bugs in launch checklist
- [ ] Team training completed

---

## RISK MITIGATION

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| Knowledge too large → slow retrieval | MEDIUM | HIGH | Implement intelligent chunking + caching |
| LLM hallucinations | HIGH | HIGH | Confidence scoring + fact-check layer + fallback |
| Team member unavailable | MEDIUM | MEDIUM | Cross-train + flexible roles |
| Integration issues at launch | MEDIUM | MEDIUM | Extensive testing + feature flags |
| User adoption too low | LOW | MEDIUM | Gather feedback early + iterate UX |
| Performance degradation | MEDIUM | MEDIUM | Optimize early + monitor closely |

---

## DELIVERABLES CHECKLIST

### Phase 1
- [ ] `knowledge-db/chroma/` (vector store)
- [ ] `knowledge/*.json` (all catalogs)
- [ ] Embeddings generated (10,000+)
- [ ] Setup documentation

### Phase 2
- [ ] `/api/ask` endpoint (REST)
- [ ] Intent classifier + entity extractor
- [ ] QA test suite (200 cases)
- [ ] FAQ database

### Phase 3
- [ ] Chat sidebar React component
- [ ] CLI npm package (`ai-help`)
- [ ] Help button system
- [ ] Integration on 10+ pages

### Phase 4
- [ ] Ollama instance running
- [ ] Local LLM fallback logic
- [ ] Offline cache layer
- [ ] Performance benchmarks

### Phase 5
- [ ] Production deployment
- [ ] Monitoring + alerts setup
- [ ] Launch documentation
- [ ] User feedback system

---

## NEXT ACTIONS

1. **Get team alignment** on concept & timeline
2. **Allocate resources** (5 people for 5 weeks)
3. **Setup infrastructure** (Chroma, Ollama, CI/CD)
4. **Kickoff Phase 1** (Week 1)
5. **Weekly progress sync** (Monday 10am)
6. **Launch retrospective** (Post-Week 5)

---

**Project Status: READY FOR KICKOFF**

Questions? Contact the Senior Dev + ML Engineer.

