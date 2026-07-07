/**
 * Orgit programmatic API. Exposes the engine and its building blocks so Orgit can be
 * embedded in other tools, not only used through the CLI.
 */
export { buildContext, type RunContext } from "./engine/context.js";
export { Engine } from "./engine/engine.js";
export { loadConfig, ConfigSchema, DEFAULT_CONFIG, type OrgitConfig } from "./config/config.js";
export {
  resolveWorkspace,
  ensureWorkspace,
  workspaceExists,
  type Workspace,
} from "./config/workspace.js";
export { createProvider, completeJson } from "./providers/factory.js";
export { DEFAULT_MODEL, MODEL_ALIASES, resolveModel } from "./providers/models.js";
export type { ClaudeProvider, CompleteOptions } from "./providers/types.js";
export { buildMentalModel, summariseModel } from "./analysis/model.js";
export { computeHealth, type Health } from "./analysis/health.js";
export { detectOpportunities } from "./detectors/detect.js";
export { detectSemanticDuplication } from "./detectors/semantic.js";
export {
  loadConventions,
  saveConventions,
  deriveConventions,
  renderConventions,
  type Conventions,
} from "./memory/conventions.js";
export { loadHistory, appendHistory, renderTrend, type HistoryEntry } from "./report/history.js";
export {
  loadDecisions,
  appendDecision,
  recordTaskDecision,
  renderDecisions,
  type DecisionEntry,
} from "./memory/decisions.js";
export {
  generateEdit,
  applyEdit,
  isStale,
  executeTask,
  type GeneratedEdit,
} from "./executor/execute.js";
export {
  generateChangeDoc,
  buildChangeDoc,
  writeChangeDocs,
  type ChangeDocEntry,
} from "./docs/codedoc.js";
export { mapWithConcurrency } from "./util/concurrency.js";
export { executeInWorktrees, partitionIndependent } from "./executor/worktree.js";
export {
  createMission,
  loadMission,
  saveMission,
  renderMission,
  progressOf,
  nextRunnableStep,
  runnableSteps,
  type Mission,
  type MissionStep,
} from "./mission/mission.js";
export { PlannerAgent } from "./mission/planner.js";
export { startMission, runMission, type MissionRunResult } from "./mission/runner.js";
export { ReviewerAgent, type Review, type Reviewer } from "./agents/reviewer.js";
export { TesterAgent, type Tester, type TestOutcome } from "./agents/tester.js";
export type { Agent, AgentRole } from "./agents/agents.js";
export { prioritize } from "./planner/prioritize.js";
export { buildPlan } from "./planner/plan.js";
export { startServer, type ServerHandle } from "./server/server.js";
export { buildStateSnapshot, type StateSnapshot } from "./server/state.js";
export { subscribeToLog, type LogEvent, type LogLevel } from "./util/log.js";
export * from "./core/types.js";
