/**
 * The entire web dashboard as one self-contained HTML string (inline CSS + JS, no
 * framework, no build, no external requests). Stored as a plain template literal, so the
 * client script intentionally avoids backticks and ${ } to prevent server-side
 * interpolation. Served verbatim by the server at `/`.
 */
export const UI_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Orgit dashboard</title>
<style>
  :root {
    --bg: #ffffff; --fg: #1c2024; --muted: #6b7280; --card: #f6f7f9; --border: #e5e7eb;
    --accent: #6366f1; --teal: #2dd4bf; --ok: #16a34a; --warn: #d97706; --err: #dc2626;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0d1117; --fg: #e6edf3; --muted: #8b949e; --card: #161b22; --border: #30363d;
      --accent: #818cf8; --teal: #2dd4bf; --ok: #3fb950; --warn: #d29922; --err: #f85149;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background: var(--bg); color: var(--fg); }
  header { display: flex; align-items: center; gap: 14px; padding: 16px 24px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
  header .mark { width: 30px; height: 30px; border-radius: 50%; border: 5px solid var(--accent); border-right-color: transparent; }
  h1 { font-size: 18px; margin: 0; letter-spacing: -0.5px; }
  .grow { flex: 1; }
  main { max-width: 1100px; margin: 0 auto; padding: 20px; display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 16px; }
  .card h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.6px; color: var(--muted); margin: 0 0 12px; }
  .full { grid-column: 1 / -1; }
  .score { font-size: 44px; font-weight: 800; line-height: 1; }
  .grade { font-size: 20px; font-weight: 700; color: var(--accent); }
  .muted { color: var(--muted); }
  .row { display: flex; justify-content: space-between; padding: 3px 0; border-bottom: 1px dashed var(--border); }
  .row:last-child { border-bottom: 0; }
  .pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px; background: var(--bg); border: 1px solid var(--border); margin: 2px 4px 2px 0; }
  .steps li { list-style: none; padding: 4px 0; }
  .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 8px; vertical-align: middle; }
  .s-done { background: var(--ok); } .s-blocked { background: var(--err); }
  .s-pending { background: var(--muted); } .s-in-progress { background: var(--warn); }
  .bar { height: 8px; border-radius: 999px; background: var(--border); overflow: hidden; margin: 8px 0; }
  .bar > i { display: block; height: 100%; background: linear-gradient(90deg, var(--teal), var(--accent)); }
  .controls { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  button { font: inherit; font-weight: 600; padding: 7px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg); color: var(--fg); cursor: pointer; }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  input, select { font: inherit; padding: 6px 8px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg); color: var(--fg); }
  label { font-size: 13px; color: var(--muted); display: inline-flex; gap: 5px; align-items: center; }
  #log { background: #0b0e14; color: #cdd9e5; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; padding: 12px; border-radius: 10px; height: 260px; overflow: auto; white-space: pre-wrap; }
  #log .warn { color: #d29922; } #log .error { color: #f85149; } #log .success { color: #3fb950; } #log .step { color: #58a6ff; }
  a { color: var(--accent); cursor: pointer; }
  pre#report { white-space: pre-wrap; max-height: 420px; overflow: auto; }
</style>
</head>
<body>
<header>
  <div class="mark"></div>
  <h1>Orgit</h1>
  <span class="muted" id="root"></span>
  <span class="grow"></span>
  <span class="muted" id="conn">connecting…</span>
  <button onclick="refresh()">Refresh</button>
</header>
<main id="app">
  <div class="card full">
    <h2>Run</h2>
    <div class="controls">
      <button onclick="run('analyze')">Analyze</button>
      <button onclick="run('audit')">Audit</button>
      <button onclick="run('plan')">Plan</button>
      <button class="primary" onclick="run('evolve')">Evolve</button>
      <button onclick="run('mission-run')">Mission run</button>
      <span style="width:12px"></span>
      <label><input type="checkbox" id="dryRun" checked /> dry-run</label>
      <label>max <input type="number" id="max" min="1" style="width:64px" /></label>
      <label>docs
        <select id="docsLevel">
          <option value="">off</option>
          <option value="minimal">minimal</option>
          <option value="standard">standard</option>
          <option value="detailed">detailed</option>
        </select>
      </label>
      <label>model <input type="text" id="model" placeholder="opus / sonnet…" style="width:120px" /></label>
    </div>
  </div>

  <div class="card">
    <h2>Health</h2>
    <div class="score" id="score">–</div>
    <div><span class="grade" id="grade"></span> <span class="muted" id="trend"></span></div>
    <div id="metrics" class="muted" style="margin-top:10px"></div>
  </div>

  <div class="card">
    <h2>Analysis</h2>
    <div id="totals"></div>
    <div id="languages" style="margin-top:8px"></div>
  </div>

  <div class="card">
    <h2>Opportunities</h2>
    <div id="opps"></div>
  </div>

  <div class="card">
    <h2>Modules</h2>
    <div id="modules"></div>
  </div>

  <div class="card full" id="missionCard" style="display:none">
    <h2>Mission</h2>
    <div id="missionGoal" style="font-weight:600"></div>
    <div class="bar"><i id="missionBar" style="width:0%"></i></div>
    <div class="muted" id="missionProgress"></div>
    <ul class="steps" id="missionSteps" style="padding:0;margin:8px 0 0"></ul>
  </div>

  <div class="card">
    <h2>Decision memory</h2>
    <div id="decisions" class="muted">–</div>
  </div>

  <div class="card">
    <h2>Conventions &amp; memory</h2>
    <div id="conventions" class="muted"></div>
  </div>

  <div class="card full">
    <h2>Reports</h2>
    <div id="reports" class="muted"></div>
    <pre id="report"></pre>
  </div>

  <div class="card full">
    <h2>Live log</h2>
    <div id="log"></div>
  </div>
</main>
<script>
  var esc = function (s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  };
  var byId = function (id) { return document.getElementById(id); };
  var running = false;

  function setRunning(v) {
    running = v;
    var btns = document.querySelectorAll(".controls button");
    for (var i = 0; i < btns.length; i++) btns[i].disabled = v;
  }

  function run(command) {
    if (running) return;
    var options = {
      dryRun: byId("dryRun").checked,
      docs: byId("docsLevel").value !== "",
      docsLevel: byId("docsLevel").value || undefined
    };
    var max = parseInt(byId("max").value, 10);
    if (max > 0) options.max = max;
    var model = byId("model").value.trim();
    if (model) options.model = model;
    logLine("step", "› launching " + command + "…");
    fetch("/api/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: command, options: options })
    }).then(function (r) {
      if (r.status === 409) logLine("warn", "a run is already in progress");
      else setRunning(true);
    }).catch(function (e) { logLine("error", String(e)); });
  }

  function logLine(level, message) {
    var el = byId("log");
    var line = document.createElement("div");
    line.className = level;
    line.textContent = message;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
  }

  function refresh() {
    fetch("/api/state").then(function (r) { return r.json(); }).then(render)
      .catch(function (e) { logLine("error", "state: " + e); });
  }

  function render(s) {
    byId("root").textContent = s.root;
    byId("score").textContent = s.health.score;
    byId("grade").textContent = "grade " + s.health.grade;
    byId("trend").textContent = s.trend;
    var m = s.health.metrics;
    byId("metrics").innerHTML =
      "large files: " + m.largeFiles + " · long fns: " + m.longFunctions +
      " · duplication: " + m.duplication + " · doc ratio: " + Math.round(m.docRatio * 100) + "%";

    byId("totals").innerHTML =
      "<div class='row'><span>Files</span><span>" + s.totals.files + "</span></div>" +
      "<div class='row'><span>Lines</span><span>" + s.totals.lines + "</span></div>" +
      "<div class='row'><span>Indexed chunks</span><span>" + s.memoryChunks + "</span></div>";
    var langs = "";
    for (var k in s.languages) langs += "<span class='pill'>" + esc(k) + " " + s.languages[k] + "</span>";
    byId("languages").innerHTML = langs || "<span class='muted'>no languages</span>";

    var opps = "<div class='row'><span><b>Total</b></span><span><b>" + s.opportunities.total + "</b></span></div>";
    var bk = s.opportunities.byKind;
    for (var kind in bk) opps += "<div class='row'><span>" + esc(kind) + "</span><span>" + bk[kind] + "</span></div>";
    byId("opps").innerHTML = opps;

    var mods = "";
    for (var i = 0; i < s.modules.length; i++) {
      mods += "<div class='row'><span>" + esc(s.modules[i].name) + "</span><span>" + s.modules[i].files + "</span></div>";
    }
    byId("modules").innerHTML = mods || "<span class='muted'>–</span>";

    if (s.mission) {
      byId("missionCard").style.display = "";
      byId("missionGoal").textContent = s.mission.goal + "  (" + s.mission.status + ")";
      byId("missionBar").style.width = s.mission.progress.percent + "%";
      byId("missionProgress").textContent =
        s.mission.progress.done + "/" + s.mission.progress.total + " steps done · " +
        s.mission.progress.blocked + " blocked";
      var steps = "";
      for (var j = 0; j < s.mission.steps.length; j++) {
        var st = s.mission.steps[j];
        steps += "<li><span class='dot s-" + st.status + "'></span>" + esc(st.title) + "</li>";
      }
      byId("missionSteps").innerHTML = steps;
    } else {
      byId("missionCard").style.display = "none";
    }

    if (s.decisions.count) {
      var dec = "<div>" + s.decisions.count + " recorded change(s) across runs</div>";
      for (var d = 0; d < s.decisions.recent.length; d++) {
        dec += "<div class='row'><span>" + esc(s.decisions.recent[d].summary) + "</span></div>";
      }
      byId("decisions").innerHTML = dec;
    } else {
      byId("decisions").textContent = "none yet";
    }

    var c = s.conventions;
    byId("conventions").innerHTML =
      "indent: " + esc(c.indent) + " · quotes: " + esc(c.quotes) + " · semicolons: " + esc(c.semicolons) +
      (c.testFramework ? " · tests: " + esc(c.testFramework) : "");

    var reps = "";
    for (var r = 0; r < s.reports.length; r++) {
      var name = s.reports[r];
      reps += "<a onclick=\\"openReport('" + esc(name) + "')\\">" + esc(name) + "</a>  ";
    }
    byId("reports").innerHTML = reps || "no reports yet — run audit or plan";
  }

  function openReport(name) {
    fetch("/api/report?name=" + encodeURIComponent(name))
      .then(function (r) { return r.json(); })
      .then(function (d) { byId("report").textContent = d.markdown || d.error || ""; });
  }

  var es = new EventSource("/api/events");
  es.addEventListener("hello", function (e) {
    byId("conn").textContent = "connected";
    setRunning(JSON.parse(e.data).running);
  });
  es.addEventListener("log", function (e) {
    var d = JSON.parse(e.data);
    logLine(d.level, d.message);
  });
  es.addEventListener("run-start", function (e) {
    setRunning(true);
    logLine("step", "run started: " + JSON.parse(e.data).command);
  });
  es.addEventListener("run-done", function (e) {
    var d = JSON.parse(e.data);
    setRunning(false);
    logLine(d.ok ? "success" : "error", "run finished: " + d.command + (d.ok ? " ✓" : " ✗ " + (d.error || "")));
    refresh();
  });
  es.onerror = function () { byId("conn").textContent = "disconnected"; };

  refresh();
</script>
</body>
</html>`;
