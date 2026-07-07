import * as readline from "node:readline/promises";

/** A user's decision when Orgit asks whether to apply a task in interactive mode. */
export type Approval = "apply" | "skip" | "quit";

/** How Orgit asks for approval. Injectable so the engine stays testable and non-blocking. */
export type Approver = (question: string) => Promise<Approval>;

export interface InteractiveApprover {
  approve: Approver;
  close: () => void;
}

/**
 * Interactive approver backed by readline. Used when `--interactive` is set: Orgit
 * pauses before each task and asks apply / skip / quit ("va preguntant"). The caller
 * must `close()` it when done so the process can exit. Any unrecognized answer
 * defaults to apply.
 */
export function createInteractiveApprover(): InteractiveApprover {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return {
    approve: async (question: string): Promise<Approval> => {
      const answer = (await rl.question(`${question} [Y/n/q] `)).trim().toLowerCase();
      if (answer === "n" || answer === "no" || answer === "skip") return "skip";
      if (answer === "q" || answer === "quit") return "quit";
      return "apply";
    },
    close: () => rl.close(),
  };
}
