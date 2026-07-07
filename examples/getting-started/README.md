# Getting started with Orgit

A complete, runnable walkthrough on a throwaway project. Nothing here touches your real
repositories.

## 1. Build Orgit and expose the CLI

```bash
git clone https://github.com/Gerijacki/Orgit.git
cd Orgit
pnpm install
pnpm build
npm link            # makes `orgit` available on your PATH
```

Check your environment and which Claude backend Orgit will use:

```bash
orgit doctor
```

You should see either the `claude` CLI (subscription) or the Anthropic API detected.

## 2. Create a sample project to evolve

```bash
mkdir /tmp/sample && cd /tmp/sample
git init
cat > package.json <<'JSON'
{ "name": "sample", "version": "1.0.0", "scripts": { "test": "node -e \"process.exit(0)\"" } }
JSON
mkdir src
# a file with obvious dead code
cat > src/dead.js <<'JS'
function compute(items) {
  const unused1 = items.map((x) => x * 2);
  const unused2 = items.filter((x) => x > 0);
  return items.length;
}
module.exports = { compute };
JS
git add -A && git commit -m "init"
```

## 3. Understand, then audit — no changes yet

```bash
orgit analyze -C /tmp/sample     # builds the mental model + indexes memory
orgit audit   -C /tmp/sample     # reports opportunities; writes .orgit/reports/
orgit plan    -C /tmp/sample     # turns them into a task plan
```

## 4. Preview and apply

```bash
orgit evolve -C /tmp/sample --dry-run    # see the edits Orgit would make
orgit evolve -C /tmp/sample --max 1       # apply the top task as one validated commit
git -C /tmp/sample log --oneline
```

Each applied task is a separate commit with a full justification, and any change that
breaks `npm test` is rolled back automatically.

## 5. Ask questions about the code

```bash
orgit explain -C /tmp/sample "what does compute do and is anything unused?"
```
