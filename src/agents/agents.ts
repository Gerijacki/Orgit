/**
 * Orgit's multi-agent roles. A mission is carried out by cooperating agents:
 *
 * - **Coordinator** — owns the persistent mission, decides what runs next, records
 *   progress. (Implemented by `src/mission/runner.ts`.)
 * - **Planner** — decomposes a large goal into an ordered, step-by-step plan.
 *   (`src/mission/planner.ts`.)
 * - **Worker** — executes one step: generates and applies its edit. Many workers run
 *   in parallel for independent steps. (Wraps `src/executor/`.)
 * - **Reviewer** — verifies an edit matches its intent before commit. (`agents/reviewer.ts`.)
 * - **Tester** — writes and runs tests for the changed code after it lands. (`agents/tester.ts`.)
 *
 * Keeping the roles explicit makes the system genuinely multi-agent and easy to extend
 * without entangling the orchestration.
 */
export type AgentRole = "coordinator" | "planner" | "worker" | "reviewer" | "tester";

export interface Agent {
  readonly role: AgentRole;
  readonly name: string;
}
