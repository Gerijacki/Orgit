import pc from "picocolors";

/**
 * Minimal, dependency-light logger. Orgit favours predictable, explainable output
 * (a design principle from INSTRUCTIONS.md), so logging is structured by intent
 * rather than by severity alone.
 */

let verbose = false;

export function setVerbose(v: boolean): void {
  verbose = v;
}

export type LogLevel = "info" | "step" | "success" | "warn" | "error" | "debug" | "heading";
export interface LogEvent {
  level: LogLevel;
  /** Plain (uncoloured) message text — suitable for a web UI. */
  message: string;
}

// Sinks let another surface (e.g. the web UI's SSE stream) observe log output without
// changing any call site. Console output is unaffected.
const sinks = new Set<(e: LogEvent) => void>();

/** Subscribe to log events. Returns an unsubscribe function. */
export function subscribeToLog(fn: (e: LogEvent) => void): () => void {
  sinks.add(fn);
  return () => sinks.delete(fn);
}

function emit(level: LogLevel, message: string): void {
  for (const fn of sinks) {
    try {
      fn({ level, message });
    } catch {
      /* a broken sink must never break logging */
    }
  }
}

export const log = {
  info(msg: string): void {
    console.log(msg);
    emit("info", msg);
  },
  step(msg: string): void {
    console.log(`${pc.cyan("→")} ${msg}`);
    emit("step", msg);
  },
  success(msg: string): void {
    console.log(`${pc.green("✓")} ${msg}`);
    emit("success", msg);
  },
  warn(msg: string): void {
    console.warn(`${pc.yellow("!")} ${msg}`);
    emit("warn", msg);
  },
  error(msg: string): void {
    console.error(`${pc.red("✗")} ${msg}`);
    emit("error", msg);
  },
  debug(msg: string): void {
    if (verbose) console.log(pc.dim(`  ${msg}`));
    if (verbose) emit("debug", msg);
  },
  heading(msg: string): void {
    console.log(`\n${pc.bold(msg)}`);
    emit("heading", msg);
  },
  dim(msg: string): string {
    return pc.dim(msg);
  },
};
