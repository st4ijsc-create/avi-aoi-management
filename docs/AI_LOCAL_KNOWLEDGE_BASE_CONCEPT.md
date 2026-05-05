# AI Local System Knowledge Base — Concept & Implementation Plan

**Date:** May 5, 2026  
**Status:** CONCEPT (Ready for feedback)  
**Scope:** Create an intelligent local knowledge system for avi-aoi-management platform  

---

## 1. CONCEPT OVERVIEW

### Problem Statement
- System has 60+ routers, 45+ services, 80+ pages, complex data models
- New developers, ops staff, and users frequently ask same questions
- Documentation is scattered (API docs, code comments, schema audit, scattered guides)
- No integrated Q&A system specific to this codebase
- Training burden on senior team members

### Vision
**"Local AI System Assistant"** — A lightweight, offline-capable AI model that:
1. Understands the entire avi-aoi-management architecture, APIs, data models, and workflows
2. Answers user/admin/developer questions in Vietnamese or English
3. Provides contextual help, troubleshooting, and best practices
4. Reduces dependency on senior team members for common questions
5. Available as:
   - **Chat interface** in admin panel (sidebar or modal)
   - **CLI tool** for developers (`npx ai-help --question "how to...?"`)
   - **Embedded widget** in documentation sites

### Key Capabilities

**For Users/Admins:**
- "How do I create a product model?" → Step-by-step UI guidance
- "What does this error mean?" → Troubleshooting advice
- "How do I export a report?" → Feature walkthrough
- "Why is my yield low?" → Guide to QA features

**For Developers:**
- "How do I create a new router?" → Architecture pattern + example
- "Where is the inspection image storage logic?" → Code location + explanation
- "How does the MQTT dual-broker work?" → System diagram + code flow
- "What's the SPC analysis algorithm?" → Math + implementation details

**For Ops/Support:**
- "How do I reset a user password?" → Admin steps
- "How to backup/restore database?" → Step-by-step
- "How do I integrate with external MQTT?" → Config guide
- "What are the performance tuning options?" → Optimization guide

---

## 2. TECHNICAL ARCHITECTURE

### 2.1 Knowledge Sources (Training Data)

**Priority 1 (Critical):**
- [ ] TypeScript codebase source:
  - All `server/routers/*.ts` (60+ routers — architecture, endpoints, logic)
  - All `server/services/*.ts` (45+ services — domain logic, algorithms)
  - `server/_core/trpc.ts` and `server/_core/index.ts` (setup & initialization)
  - `shared/` types and schemas (data contracts)

**Priority 2 (High):**
- [ ] Documentation (in `apidocs/`, `docs/`):
  - API protocols, authentication, error codes
  - MQTT architecture and configuration
  - Schema audit report (99 tables, relationships)
  - AI feature roadmap and upgrade plans
  - PDCA improvement reports

**Priority 3 (Medium):**
- [ ] Frontend codebase:
  - Page structure (`client/src/pages/*.tsx`)
  - Component patterns (Radix UI usage, state management)
  - Form & validation patterns (React Hook Form + Zod)

**Priority 4 (Low, Optional):**
- [ ] Config & deployment:
  - Environment variables and config files
  - Docker/deployment guides
  - Database migration patterns

### 2.2 Knowledge Representation

**Layers of Understanding:**

1. **Semantic Layer** (what happens)
   - API endpoints → input/output examples
   - User workflows → step-by-step flows
   - Data models → relationships and constraints
   - Common tasks → how-to guides

2. **Code Layer** (how it's implemented)
   - Service functions → purpose, algorithm, dependencies
   - Router procedures → middleware, validation, error handling
   - Database queries → Drizzle ORM patterns used

3. **Context Layer** (why it works this way)
   - Architectural decisions → trade-offs
   - Performance considerations → caching, indexing
   - Security model → authentication, permissions
   - Extension points → where to add new features

4. **Example Layer** (concrete instances)
   - API call examples (HTTP + error responses)
   - Feature usage examples (step-by-step with screenshots)
   - Code patterns (copy-paste ready snippets)

---

## 3. IMPLEMENTATION PHASES

### Phase 1: Knowledge Ingestion & Structuring (Week 1-2)

**Goal:** Build foundation knowledge base from codebase + docs

**Tasks:**
1. **Codebase Analysis Automation**
   - [ ] Parse all `.ts` files: routers, services, types
   - [ ] Extract function signatures, JSDoc comments, error patterns
   - [ ] Build a "code map" (what calls what, data flow)
   - [ ] Generate summaries per router (endpoints, permissions, cache, rate limits)
   - [ ] Tool: Custom TypeScript analyzer + LLM summarizer

2. **Documentation Consolidation**
   - [ ] Index all existing docs (API, MQTT, schema, guides)
   - [ ] Extract key information into structured format:
     - Task → Steps → Expected result
     - Concept → Explanation → Code example
     - Error code → Cause → Solution
   - [ ] Fill gaps with inline code documentation mining

3. **Schema & Data Model Documentation**
   - [ ] Generate table relationship diagram (100 tables)
   - [ ] Create entity dictionary (1 page per main entity)
   - [ ] Document data constraints and validation rules
   - [ ] List common query patterns

4. **Knowledge Graph Construction**
   - [ ] Create embeddings of all knowledge chunks
   - [ ] Build semantic relationships (e.g., "inspection" links to "image storage", "quality gates", "AI inference")
   - [ ] Store in vector DB (Chroma/Milvus or local SQLite)

**Output:** Structured knowledge base (10,000+ chunks, 500MB+ embeddings)

---

### Phase 2: Question-Answering Engine (Week 2-3)

**Goal:** Build QA system that understands questions and retrieves relevant knowledge

**Components:**

1. **Query Understanding**
   - [ ] Natural language question processor
   - [ ] Question intent classification (how-to, troubleshooting, explanation, architecture)
   - [ ] Entity extraction (API names, feature names, error codes)
   - [ ] Multi-language support (Vietnamese ↔ English)

2. **Retrieval System**
   - [ ] Semantic search via embeddings (top-5 relevant chunks)
   - [ ] Keyword search fallback (BM25 or SQL full-text)
   - [ ] Context ranking (prioritize recent/popular docs)
   - [ ] Relevance filtering (only return chunks with high confidence)

3. **Answer Generation**
   - [ ] LLM-based synthesis (ChatGPT, Llama2, or smaller model)
   - [ ] Template-based answers (for common FAQ)
   - [ ] Multi-source answers (combine 3-5 relevant chunks)
   - [ ] Citation tracking (reference source doc/code)

4. **Quality Assurance**
   - [ ] Confidence scoring (high/medium/low answer confidence)
   - [ ] Fallback to "I don't know" + escalation links
   - [ ] User feedback loop (thumbs up/down on answers)

**Output:** Production-ready QA API (REST endpoint + response format)

---

### Phase 3: User Interfaces (Week 3-4)

**Goal:** Make AI knowledge accessible in multiple contexts

**Interface 1: In-App Chat Sidebar (Admin Panel)**
- [ ] Add sidebar widget to existing admin pages
- [ ] Real-time chat interface (React component)
- [ ] Chat history per user session
- [ ] Context awareness (current page → suggest related topics)
- [ ] Export conversation as guide

**Interface 2: CLI Tool (Developer Helper)**
- [ ] Create `ai-help` command: `npx ai-help --question "..."`
- [ ] Output: Formatted text + code examples
- [ ] Rich formatting (colors, tables, code blocks)
- [ ] Offline mode support
- [ ] Cache recent answers for instant response

**Interface 3: Smart Help Buttons**
- [ ] Add "?" help buttons on complex features
- [ ] Inline documentation tooltips
- [ ] Context-sensitive AI suggestions
- [ ] Keyboard shortcut access (e.g., Cmd+Shift+?)

**Interface 4: Documentation Site (Optional)**
- [ ] Read-only web interface for public/shared help
- [ ] Search + browse knowledge base
- [ ] Community answers section

**Output:** 3 working UIs, integrated into existing apps

---

### Phase 4: Local LLM Integration (Week 4-5)

**Goal:** Enable fully offline operation with local LLM

**Options:**

1. **Option A: Llama2-7B (Recommended)**
   - Size: ~14GB GPU memory / ~26GB RAM (CPU mode)
   - Accuracy: 85-90% for this domain
   - Setup: Ollama + llama2-7b-chat
   - Response time: ~2-5s (GPU) / ~30-60s (CPU)

2. **Option B: Mistral-7B**
   - Size: ~14GB GPU memory
   - Accuracy: 88-92% (slightly better)
   - Response time: Similar to Llama2
   - Startup: Faster than Llama2

3. **Option C: Phi-2 (Lightweight)**
   - Size: ~4GB RAM (CPU mode)
   - Accuracy: 80-85% (acceptable for FAQ)
   - Response time: ~5-10s (CPU)
   - Best for: Laptop/low-resource environments

**Implementation:**
- [ ] Setup local LLM service (Ollama or LM Studio)
- [ ] Fallback to cloud API (OpenAI/Anthropic) if local unavailable
- [ ] Lazy-load model on first question
- [ ] Persistent cache of Q&As (avoid re-running same query)

**Output:** Fully offline-capable knowledge system

---

### Phase 5: Continuous Learning (Ongoing)

**Goal:** Keep knowledge base current as system evolves

**Mechanisms:**
- [ ] Auto-rebuild on each codebase commit (CI/CD integration)
- [ ] Weekly doc sync + retraining
- [ ] User feedback → improve retrieval ranking
- [ ] New issue/feature → extract learnings and update KB
- [ ] Quarterly manual audit + gap-filling

**Output:** Self-maintaining knowledge system

---

## 4. TECHNICAL STACK

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| **Knowledge DB** | Chroma (vector) + SQLite (metadata) | Local, zero-setup, good for RAG |
| **Embeddings** | all-MiniLM-L6-v2 (384 dims, fast) or OpenAI Embeddings | Local option is free; cloud has higher quality |
| **LLM** | Ollama + Llama2-7B or Phi-2 | Local + offline + open-source |
| **Backend** | Node.js Express (existing stack) | Reuse tech stack, easy integration |
| **Frontend (Chat)** | React component (TailwindCSS + Shadcn/ui) | Consistent with existing UI |
| **Frontend (CLI)** | TypeScript + Chalk + Inquirer | Developer-friendly, colorful output |
| **API Format** | REST JSON | Simple integration |
| **Caching** | Redis (existing) or local file-based | Avoid redundant LLM calls |

---

## 5. DATA FLOW DIAGRAM

```
User Question (Vietnamese/English)
        ↓
[Input Processor]
  - Translate to English (if needed)
  - Extract intent + entities
        ↓
[Hybrid Retrieval]
  ┌─────────────────────────────────┐
  │ Semantic Search (Embeddings)    │ → Top 5 relevant chunks
  │ + Keyword Search (BM25)         │
  │ + Reranking (relevance score)   │
  └─────────────────────────────────┘
        ↓
[Context Assembly]
  - Select top 3 chunks
  - Add code examples
  - Add diagrams/links
        ↓
[Answer Generation]
  ┌─────────────────────────────────┐
  │ Local LLM (Llama2) or           │
  │ Template-based (for FAQ)        │
  │ with source citations           │
  └─────────────────────────────────┘
        ↓
[Quality Check]
  - Confidence score
  - Fact verification
  - Add disclaimers if needed
        ↓
[Format & Present]
  - For UI: JSON response
  - For CLI: Colored text + code blocks
  - For Chat: Markdown with syntax highlighting
        ↓
User receives answer
(with sources + "Was this helpful?" feedback)
```

---

## 6. SUCCESS METRICS

| Metric | Target | How Measured |
|--------|--------|--------------|
| **Knowledge Coverage** | 90% of user questions answerable | User satisfaction survey |
| **Answer Accuracy** | 85%+ correct (for domain questions) | QA testing + user feedback |
| **Response Latency** | <2s (UI), <3s (CLI) | Performance profiling |
| **Adoption Rate** | 60% of daily active users use 1x/week | Analytics |
| **Support Reduction** | 30% fewer "how-to" support tickets | Support ticket analysis |
| **System Uptime** | 99.5% | Monitoring |
| **Offline Capability** | Works 100% without internet | Regular testing |

---

## 7. RISKS & MITIGATION

| Risk | Severity | Mitigation |
|------|----------|-----------|
| **Outdated knowledge** | HIGH | Auto-rebuild KB on code changes + version tracking |
| **Hallucinations (wrong answers)** | HIGH | Confidence scoring + fact-checking layer + easy fallback |
| **Performance (slow responses)** | MEDIUM | Caching + optimization + async processing |
| **Privacy (data leakage in LLM)** | MEDIUM | Local LLM only (no cloud) + no user data sent to model |
| **Maintenance burden** | MEDIUM | Automate ingestion + CI/CD integration |
| **Language accuracy** | MEDIUM | Template-based answers for critical paths + human review |

---

## 8. ROLLOUT PLAN

### Phase Timing
- **Phase 1 (Knowledge):** Week 1-2 (in parallel with current work)
- **Phase 2 (QA Engine):** Week 2-3
- **Phase 3 (UIs):** Week 3-4
- **Phase 4 (Local LLM):** Week 4-5
- **Phase 5 (Maintenance):** Ongoing

### Go-Live Sequence
1. **Private Alpha** (Week 3): Team-only chat interface, gather feedback
2. **Internal Beta** (Week 4): CLI tool for developers, expand test group
3. **Production Soft Launch** (Week 5): Chat in admin panel, optional feature
4. **Full Launch** (Week 6): All UIs active, community docs available

### Rollback Plan
- If accuracy < 70% after 1 week: Disable public UI, keep internal CLI
- If performance > 5s response: Fallback to template-based mode
- If LLM model fails: Use keyword search + static FAQ

---

## 9. RESOURCE REQUIREMENTS

| Resource | Effort | Who |
|----------|--------|-----|
| **Knowledge Extraction** | 40-50h | 1 Senior Dev + AI analysis tools |
| **QA Engine Dev** | 30-40h | 1 Full-Stack Dev (familiar with LLMs) |
| **UI Development** | 20-30h | 1 Frontend Dev |
| **LLM Setup & Tuning** | 15-20h | 1 ML Engineer or ML-savvy Dev |
| **Testing & QA** | 20-30h | QA Team |
| **Documentation** | 10-15h | 1 Technical Writer |
| **TOTAL** | 135-185h | 5-person team, 4-5 weeks |

### Budget Estimate (if hiring):
- Cloud API costs (OpenAI fallback): ~$200-500/month
- GPU rental (if needed for model serving): ~$100-300/month
- Storage (vector DB + cache): ~$50/month
- Monitoring & logging: ~$50/month
- **Total:** ~$400-1000/month (optional, for cloud enhancements)

---

## 10. SUCCESS STORIES (Post-Launch)

**Use Case 1: New Developer Onboarding**
- Day 1: "How do I create a new router?" → AI provides pattern + example
- Day 2: "Where is inspection image storage?" → AI points to code + explains
- Day 3: "How does caching work?" → AI explains Redis + code locations
- Result: 70% faster onboarding vs. manual training

**Use Case 2: Admin Support**
- User: "Error: 'Yield threshold not found'" → AI explains → step-by-step fix
- Result: No ticket needed, user self-resolves in 5 minutes

**Use Case 3: Feature Discovery**
- Power user: "Can I export a quality report?" → AI shows feature location + how-to
- Result: User discovers feature they didn't know existed

**Use Case 4: Developer Productivity**
- Dev: `ai-help --question "How does SPC analysis work?"` → Get algorithm + code
- Result: 30 minutes saved vs. code reading + asking senior dev

---

## 11. NEXT STEPS

1. **Get Approval** on concept + tech stack
2. **Allocate Team** for 4-5 week sprint
3. **Prepare Data Sources**:
   - Export codebase in structured format
   - Gather all docs + links
   - Audit schema + API for accuracy
4. **Setup Infrastructure**:
   - Local LLM environment (Ollama setup guide)
   - Vector DB (Chroma instance)
   - Development pipeline
5. **Begin Phase 1** (Week 1): Knowledge ingestion

---

**Status: Ready for review and feedback.**

Would you like to:
- [ ] Refine the concept further?
- [ ] Deep-dive into any phase?
- [ ] Adjust tech stack / timelines?
- [ ] Start with Phase 1 implementation?

