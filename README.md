# renovate-vs-dependabot-demo

A single repo with **both Renovate and Dependabot configured side by side** on the same
deliberately vulnerable TypeScript API, so you can compare the PRs they open on identical
input instead of comparing marketing pages.

- Dependabot: [`.github/dependabot.yml`](.github/dependabot.yml) — configured *well*, not as a strawman.
- Renovate: [`renovate.json`](renovate.json) — annotated inline via `description` keys.
- Results of the live run: [`RESULTS.md`](RESULTS.md)
- Corporate evaluation, Artifactory/Xray integration and pricing: [`ENTERPRISE.md`](ENTERPRISE.md)
- **Where Renovate actually wins over Dependabot** (Dependabot can group too — this separates real capability gaps from configuration verbosity): [`ENTERPRISE.md` §7](ENTERPRISE.md#7-where-renovate-actually-wins)

> **Honesty note.** Dependabot in 2026 is not the tool it was in 2022. It has grouped
> updates, cooldowns, per-ecosystem schedules, PR limits, and it does bump transitive npm
> dependencies for security advisories. This README does **not** claim otherwise. What is
> compared below is only what actually still differs.

---

## The codebase

A small Express API that genuinely uses every vulnerable dependency, so updates are real
updates and not dead weight in `package.json`.

```
src/index.ts                     Express server, three routes
src/auth.ts                      jsonwebtoken — sign/verify session tokens
src/client.ts                    axios + lodash — upstream HTTP client
services/go-api/                 Go: gin + yaml.v2 + abandoned dgrijalva/jwt-go
services/py-worker/              Python: flask + requests + urllib3 + jinja2
Dockerfile                       old node base image + ARG tool versions
.github/workflows/ci.yml         typecheck + lint + build for all three languages
```

### Polyglot: one config, four managers

`services/go-api` and `services/py-worker` exist to show manager auto-discovery.
Renovate finds `gomod`, `pip_requirements`, `npm`, `dockerfile`, `github-actions` and
the custom regex manager from **one** `renovate.json`, with no directory list.
`.github/dependabot.yml` needs a separate `updates:` block per ecosystem **per
directory** — five hand-written blocks for the same repo.

The Go module also carries `github.com/dgrijalva/jwt-go`, which is abandoned.
Renovate's `replacements:all` preset (part of `config:recommended`) proposes swapping
it for `golang-jwt/jwt` — a package *replacement*, not a version bump. Dependabot has
no equivalent: it can only offer newer versions of a package you already depend on.

### Seeded vulnerabilities ("before" state)

Output of `npm audit` on a clean checkout — **10 vulnerabilities (3 low, 7 high)**:

| Package | Severity | Kind | Vulnerable range | Advisories | Fix |
|---|---|---|---|---|---|
| `axios` | high | direct | `1.0.0 - 1.17.0` | 30 | `axios@1.19.0` |
| `express` | high | direct | `<=4.21.2` | 2 | `express@4.22.2` |
| `jsonwebtoken` | high | direct | `<=8.5.1` | 3 | `jsonwebtoken@9.0.3` (**major**) |
| `lodash` | high | direct | `<=4.17.23` | 5 | `lodash@4.18.1` |
| `body-parser` | high | transitive | `<=1.20.5` | 2 | parent `express` bump |
| `path-to-regexp` | high | transitive | `<=0.1.12` | 3 | parent `express` bump |
| `qs` | high | transitive | `<=6.14.1` | 3 | parent `express` bump |
| `cookie` | low | transitive | `<0.7.0` | 1 | parent `express` bump |
| `send` | low | transitive | `<0.19.0` | 1 | parent `express` bump |
| `serve-static` | low | transitive | `<=1.16.0` | 1 | parent `express` bump |

Every version in `package.json` is **pinned exactly** (no `^`). Without that, a fresh
install silently resolves to fixed versions and the demo evaporates.

The seeded cases were chosen to cover distinct update shapes:

- **Patch/minor security fix** — `lodash`, low-risk, ideal automerge candidate.
- **Many-advisory package** — `axios` carries 30 advisories in one bump; PR body quality matters.
- **Major-only security fix** — `jsonwebtoken@8.5.1` is only fixed in `9.x`, which is breaking.
  This is exactly where changelogs and adoption data change the decision.
- **Transitive fixed via parent** — six packages under `express`, one parent bump.
- **Transitive fixed by nothing but a lockfile refresh** — see `lockFileMaintenance` below.
- **Monorepo family** — `eslint` + `@typescript-eslint/*`, the classic PR-flood case.
- **Noise** — `typescript`, `jest`, `@types/*`, where scheduling and limits earn their keep.
- **Non-npm** — Docker base image, GitHub Actions, and raw version strings in a `Dockerfile`.

---

## What actually differs

| # | Capability | Renovate | Dependabot |
|---|---|---|---|
| 1 | **Dependency Dashboard** — one issue listing every pending, rate-limited, blocked and errored update, with checkboxes that create the PR on demand | ✅ `:dependencyDashboard` | ❌ none |
| 2 | **Merge Confidence** — crowd-sourced "% of repos whose tests passed on this exact upgrade", per package/version pair, rendered in the PR body | ✅ badges in PR body | ⚠️ compatibility score only, coarser and not shown per-PR the same way |
| 3 | **Native automerge** | ✅ `automerge: true` on any packageRule | ❌ needs a separate workflow calling `gh pr merge --auto` |
| 4 | **Grouping presets** | ✅ `group:monorepos` groups `@typescript-eslint/*` with zero config, from a maintained list | ⚠️ grouping exists, but every pattern is hand-written and hand-maintained |
| 5 | **Lockfile maintenance** — scheduled PR that regenerates the lockfile and refreshes transitives that no manifest change touches | ✅ `lockFileMaintenance` | ❌ transitives move only when an advisory names them |
| 6 | **Custom (regex) managers** — update a version string in *any* file | ✅ `customManagers` | ❌ ecosystem manifests only |
| 7 | **Advisory source** | ✅ `osvVulnerabilityAlerts` reads `osv.dev` directly, platform-independent | ⚠️ GitHub's alert pipeline; must be enabled in repo settings |
| 8 | **Rule granularity** | ✅ per-package `schedule`, `labels`, `prPriority`, `automerge`, `groupName` in one `packageRules` array | ⚠️ per-ecosystem block; no priority ordering, no per-package schedule |
| 9 | **PR body content** | ✅ release notes + changelog + adoption/confidence data | ⚠️ release notes + compatibility score |
| 10 | **Config reuse** | ✅ shareable/extendable presets (`config:recommended`, org-wide presets) | ❌ no preset mechanism; copy the YAML |

Where Dependabot is genuinely fine: basic grouped version updates, security updates for
direct *and* transitive npm dependencies, weekly scheduling, PR limits, and zero setup —
it is already there in every GitHub repo. If that is all you need, it is the smaller
moving part.

---

## Setup (one-time, manual — cannot be scripted)

1. **Install the Renovate GitHub App** on this repo: <https://github.com/apps/renovate>
   (choose "Only select repositories" → this repo).
2. Renovate opens an **onboarding PR** titled *"Configure Renovate"*. It will detect the
   existing `renovate.json` and show a preview of what it will do. **Merge it.** Nothing
   happens until you do.
3. **Enable Dependabot**: repo *Settings → Advanced Security* →
   - Dependabot alerts: **on**
   - Dependabot security updates: **on**
   (Dependabot *version* updates start on their own from `.github/dependabot.yml`.)
4. Wait. Renovate's hosted app runs roughly hourly; Dependabot version updates follow the
   Monday schedule in its config, but security updates fire as soon as alerts are enabled.
   To force Dependabot immediately: *Insights → Dependency graph → Dependabot →
   "Check for updates"*.

> `renovate.json` sets `"timezone": "Europe/Kyiv"`. Change it if that is not yours —
> it is what all the `schedule` entries are relative to.

---

## Demo script — what to look at, in order

**1. The Dependency Dashboard issue.**
Open the issue titled *🤖 Renovate Dependency Dashboard*. One place showing every update
Renovate knows about: open PRs, rate-limited ones, blocked ones, detected-but-not-yet-created
ones, and any errors. Tick a checkbox → the PR appears. There is no Dependabot equivalent;
Dependabot's state lives only in the PR list and the alerts tab.

**2. Grouping: one PR vs several.**
Look for Renovate's **`eslint`** PR — it contains `eslint`, `@typescript-eslint/parser` and
`@typescript-eslint/eslint-plugin` together. `@typescript-eslint/*` grouped itself from the
`group:monorepos` preset; `eslint` was joined to it by one `packageRules` entry.
Dependabot produces the same shape here **only because the group was hand-written** in
`.github/dependabot.yml`. That is the real difference: maintained preset vs manual patterns.

**3. Merge Confidence badges.**
Open the `lodash` or `axios` PR from Renovate. The body carries Merge Confidence badges —
age, adoption %, and passing-test % across other public repos that made the same jump.
Compare against Dependabot's compatibility score on its equivalent PR.

**4. The major-version security fix.**
`jsonwebtoken@8.5.1 → 9.x` is a **breaking** security fix. Both bots will offer it.
Compare the PR bodies: this is the case where changelog rendering and adoption data
decide whether you merge today or schedule the work. Renovate labels it `major` and refuses
to automerge it (`prPriority: -1`, `automerge: false`).

**5. Automerged devDependency.**
Watch a devDependency patch/minor PR (`@types/*`, `jest`, `typescript`) merge itself once CI
goes green — no workflow file involved, just `automerge: true` on a packageRule.
To match this, Dependabot needs an extra GitHub Actions workflow that calls
`gh pr merge --auto` on `dependabot[bot]` PRs.

**6. Lockfile maintenance.**
Every Monday morning Renovate opens a *"Lock file maintenance"* PR that regenerates
`package-lock.json` wholesale. Diff it: transitive packages move to newer patch releases
with **no change to `package.json`**. Dependabot never opens this PR — it only touches
transitives when an advisory names them. To see it immediately, tick its checkbox on the
dashboard instead of waiting.

**7. Custom manager PR.**
Open the `Dockerfile`. Three different things get updated by three different mechanisms:
- `FROM node:20.11-alpine` → the built-in `docker` manager (both bots handle this)
- `ARG PNPM_VERSION=8.6.0` → Renovate's `customManagers` regex, via the
  `# renovate: datasource=npm depName=pnpm` annotation above it
- `ARG HADOLINT_VERSION=2.12.0` → same mechanism, `github-releases` datasource

Dependabot updates the `FROM` line and **ignores both ARGs entirely** — they are not a
manifest, so no ecosystem owns them. This is the capability with no workaround.

**8. Priority and scheduling.**
`typescript`, `jest` and `@types/*` are batched into one weekly **`toolchain`** PR
(`schedule` on a `packageRules` entry). `axios`/`express`/`jsonwebtoken`/`lodash` carry
`prPriority: 5` so they surface first when limits bite. Dependabot schedules the whole npm
ecosystem at once and has no ordering control.

**9. Security PRs.**
`osvVulnerabilityAlerts: true` sources advisories straight from `osv.dev`, so security PRs
appear even if GitHub's Dependabot alerts are switched off. They carry the `security` label
and ignore every schedule (`"schedule": ["at any time"]`).

---

## Local verification

```bash
npm ci
npm run typecheck            # tsc --noEmit, must be clean
npm run build
npm audit                    # the 10 seeded vulnerabilities above

# validate the Renovate config
npx --package renovate@latest renovate-config-validator

# dry-run Renovate against the working copy (no PRs, no network writes)
LOG_LEVEL=debug npx --package renovate@latest renovate --platform=local --dry-run=full
```

CI (`.github/workflows/ci.yml`) runs `npm ci` + typecheck + build + test on every push and
PR. Green checks are what make the automerge demo work — without CI there is nothing for
`automerge` to wait on.

---

## Scope / safety

- The vulnerable versions are **pinned, never exercised**. There is no exploit code here.
- No self-hosted Renovate infrastructure — the hosted Mend app only.
- Do not deploy this. It is a fixture.
