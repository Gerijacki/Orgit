import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { buildContext } from "../engine/context.js";
import { resolveWorkspace } from "../config/workspace.js";
import { subscribeToLog } from "../util/log.js";
import { log } from "../util/log.js";
import { buildStateSnapshot } from "./state.js";
import { UI_HTML } from "./ui.js";
import { analyzeCmd, auditCmd, planCmd, evolveCmd, missionRunCmd } from "../cli/commands.js";

export interface ServerHandle {
  url: string;
  port: number;
  close: () => Promise<void>;
}

interface RunRequest {
  command?: string;
  options?: Record<string, unknown>;
}

/** Commands the dashboard may launch, mapped to the existing CLI command functions. */
async function dispatch(command: string, cwd: string, o: Record<string, unknown>): Promise<void> {
  switch (command) {
    case "analyze":
      return analyzeCmd({ cwd });
    case "audit":
      return auditCmd({ cwd });
    case "plan":
      return planCmd({ cwd });
    case "evolve":
      return evolveCmd({
        cwd,
        // Default to a dry run — mutating the repo from a browser must be explicit.
        dryRun: o.dryRun !== false,
        max: typeof o.max === "number" ? o.max : undefined,
        concurrency: typeof o.concurrency === "number" ? o.concurrency : undefined,
        docs: Boolean(o.docs),
        docsLevel: o.docsLevel as "none" | "minimal" | "standard" | "detailed" | undefined,
        review: Boolean(o.review),
        test: Boolean(o.test),
      });
    case "mission-run":
      return missionRunCmd({
        cwd,
        max: typeof o.max === "number" ? o.max : undefined,
        review: o.review === undefined ? undefined : Boolean(o.review),
        parallel: Boolean(o.parallel),
        test: Boolean(o.test),
        continuous: Boolean(o.continuous),
      });
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(data);
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * A tiny local dashboard server. Zero external deps (Node's built-in `http`), bound to
 * localhost only. Serves a single self-contained page, a read-only state API, and an SSE
 * stream of log events, and can launch a run in-process (one at a time). Model/provider
 * for a run follow the same env the CLI uses (`ORGIT_MODEL`/`ORGIT_PROVIDER`).
 */
export async function startServer(
  root: string,
  opts: { port?: number; host?: string } = {},
): Promise<ServerHandle> {
  const host = opts.host ?? "127.0.0.1";
  const clients = new Set<http.ServerResponse>();
  let running = false;

  const broadcast = (event: string, data: unknown): void => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(payload);
  };
  const unsubscribe = subscribeToLog((e) => broadcast("log", e));

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (!res.headersSent) sendJson(res, 500, { error: (err as Error).message });
    });
  });

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${host}`);
    const route = url.pathname;

    if (route === "/" || route === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(UI_HTML);
      return;
    }

    if (route === "/api/state") {
      const ctx = await buildContext(root, { withoutProvider: true });
      sendJson(res, 200, await buildStateSnapshot(ctx));
      return;
    }

    if (route === "/api/report") {
      // ?name=evolve-latest.md — only from the reports dir, no path traversal.
      const name = url.searchParams.get("name") ?? "";
      const ws = resolveWorkspace(root);
      const safe = path.basename(name);
      if (!safe.endsWith(".md")) return sendJson(res, 400, { error: "invalid report" });
      try {
        const md = await fs.readFile(path.join(ws.reportsDir, safe), "utf8");
        sendJson(res, 200, { name: safe, markdown: md });
      } catch {
        sendJson(res, 404, { error: "not found" });
      }
      return;
    }

    if (route === "/api/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
      });
      res.write(`event: hello\ndata: ${JSON.stringify({ running })}\n\n`);
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }

    if (route === "/api/run" && req.method === "POST") {
      if (running) return sendJson(res, 409, { error: "a run is already in progress" });
      const body = (await readBody(req).then(safeParse)) as RunRequest;
      const command = body.command ?? "";
      const options = body.options ?? {};
      running = true;
      broadcast("run-start", { command });
      // Fire and forget: the client watches /api/events for progress + completion.
      void (async () => {
        const prevModel = process.env.ORGIT_MODEL;
        try {
          if (typeof options.model === "string") process.env.ORGIT_MODEL = options.model;
          await dispatch(command, root, options);
          broadcast("run-done", { command, ok: true });
        } catch (err) {
          log.error(`${command} failed: ${(err as Error).message}`);
          broadcast("run-done", { command, ok: false, error: (err as Error).message });
        } finally {
          if (prevModel === undefined) delete process.env.ORGIT_MODEL;
          else process.env.ORGIT_MODEL = prevModel;
          running = false;
        }
      })();
      sendJson(res, 202, { started: true, command });
      return;
    }

    sendJson(res, 404, { error: "not found" });
  }

  const port = await new Promise<number>((resolve, reject) => {
    server.on("error", reject);
    server.listen(opts.port ?? 4319, host, () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : (opts.port ?? 4319));
    });
  });

  return {
    url: `http://${host}:${port}`,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        unsubscribe();
        for (const res of clients) res.end();
        clients.clear();
        server.close(() => resolve());
      }),
  };
}

function safeParse(text: string): unknown {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}
