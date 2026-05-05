# AI Specialist Agents (Local GGUF)

This workspace now includes a local multi-agent layer powered by GGUF via node-llama-cpp.

## Available Agents

- data-analyst: Analyze module data, detect patterns, identify root causes, suggest KPI optimization.
- backend-engineer: Propose backend redesign, bug fixes, API/data consistency, performance upgrades.
- frontend-engineer: Propose frontend redesign/UX improvements, state/render optimization, bug fixes.
- qa-optimizer: Build testing strategy, testcase matrix, QA report template, and optimization roadmap.

## API Endpoints (tRPC)

- aiSpecialistAgent.listAgents
- aiSpecialistAgent.run
- aiSpecialistAgent.runWorkflowChain
- aiSpecialistAgent.listSessions
- aiSpecialistAgent.getSessionDetail

## Workflow Chain Example

Run sequential chain: Data Analyst -> Backend + Frontend -> QA.

```ts
await trpc.aiSpecialistAgent.runWorkflowChain.mutate({
  objective: "Nang cap module production dashboard de giam loi timeout va cai thien UX",
  moduleName: "productionDashboard",
  includeBackend: true,
  includeFrontend: true,
  includeQa: true,
  techStack: ["Node.js", "tRPC", "React", "PostgreSQL"],
  files: [
    "server/routers/productionDashboardRouter.ts",
    "server/services/productionDashboardService.ts",
    "client/src/pages/ProductionDashboard.tsx"
  ],
  constraints: [
    "Khong pha vo API contract hien tai",
    "Dam bao backward compatibility"
  ],
  saveHistory: true,
  language: "vi"
});
```

## Session History Tracking

- Every run (single or workflow) can be saved into DB with step-level metrics.
- Tables:
  - ai_specialist_sessions
  - ai_specialist_session_steps
- Use:
  - aiSpecialistAgent.listSessions to get timeline by user/module/status
  - aiSpecialistAgent.getSessionDetail to inspect each step output and token/time metrics

## Minimal Usage Example

```ts
await trpc.aiSpecialistAgent.run.mutate({
  agentId: "backend-engineer",
  objective: "Fix intermittent timeout in production dashboard summary API",
  moduleName: "productionDashboard",
  currentBehavior: "API randomly times out after 8-12 seconds",
  desiredBehavior: "P95 < 2s with stable response structure",
  techStack: ["Node.js", "tRPC", "PostgreSQL", "Drizzle"],
  files: [
    "server/routers/productionDashboardRouter.ts",
    "server/services/productionDashboardService.ts"
  ],
  constraints: [
    "Do not break response contract",
    "Keep backward compatibility for existing clients"
  ],
  acceptanceCriteria: [
    "No timeout under 200 concurrent requests",
    "P95 response time lower than 2s"
  ],
  language: "vi"
});
```

## GGUF Prerequisites

- Install dependency: node-llama-cpp
- Put model files under: uploads/gguf-models
- Optional env:
  - GGUF_DEFAULT_MODEL=<your-model>.gguf
  - GGUF_GPU=false to force CPU mode
  - GGUF_MODELS_DIR=<custom-path>

## Notes

- The agent outputs strict JSON for easier UI rendering and workflow automation.
- The service uses low temperature for more stable engineering recommendations.
- To create DB tables, run migration: node run-0083-migration.mjs
