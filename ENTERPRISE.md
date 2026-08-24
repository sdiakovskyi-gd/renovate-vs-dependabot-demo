# Renovate for corporate infrastructure — evaluation

Scope of this assessment:

- corporate GitHub, **private repositories**
- **many repos, high PR volume per repo**
- private **JFrog Artifactory** as the package/image registry, **Xray** scanning on push
- primary goal: **fewer PRs, and the ones that remain must be safe to merge**
- ~100 developers

Evidence for the behavioural claims comes from the live run recorded in
[RESULTS.md](RESULTS.md) — same repo, same hour, Renovate and Dependabot side by side.

---

## 1. Executive answer

| Question | Answer |
|---|---|
| Does Renovate solve the PR-volume problem? | Yes. Measured on this repo: **12 PRs → 3 per week**, one of which merges itself. |
| Does it make PRs safer? | Yes, by defaults plus five stackable gates. Measured: **0 red Renovate PRs vs 4 red Dependabot PRs.** |
| Can it use private Artifactory? | Yes, `hostRules` + `registryUrls`, npm/Docker/Maven/PyPI/Go all supported. |
| Can Xray results land in the PR? | Yes — as a required CI check on any tier, or natively in the PR body if self-hosted. |
| **Do we need to buy it?** | **Not to start.** Self-hosted Renovate is free and covers every requirement above. Buy when you need a support SLA, cloud scale, or Merge Confidence Workflows. |
| Cost if we do buy | **Up to $250 per developer per year** → **≤ $25,000/yr for 100 devs** at list. "Up to" is a ceiling; volume pricing is negotiated. |

---

## 2. Cutting PR volume

### What actually happened here

`renovate.json` was rewritten from per-package rules to four lanes. One config edit:

| | before | after |
|---|---|---|
| Renovate open PRs | 12 | 8 |
| Renovate PRs in a steady week | 12 | **3** + lockfile |
| Major-version PRs sitting open | 2 | **0** (6 parked on the dashboard) |
| Dependabot, unchanged | 14 | 14 |

The four lanes:

| Lane | Matches | Outcome |
|---|---|---|
| 1 | npm `devDependencies`, patch/minor/pin | 1 grouped PR/week, **automerged** — nobody reviews it |
| 2 | npm `dependencies`, patch/minor/pin | 1 grouped PR/week, reviewed |
| 3 | `dockerfile` + `github-actions` + `custom.regex`, patch/minor/digest | 1 grouped PR/week |
| 4 | **any major**, recent | no PR until a human ticks a checkbox, after a 21-day soak |
| 5 | **any major**, where the version in use is > 3 months old | checkbox gate lifts automatically — the PR opens itself, labelled `overdue` |
| 6 | **devDependency majors** | automerged after a 30-day soak, if CI is green |

Security updates deliberately sit outside all four — ungrouped, unscheduled, immediate.

### The mechanism that matters at scale: `dependencyDashboardApproval`

Majors are detected every run, tracked, and **never opened as a PR** until someone
ticks their box on the dashboard issue. They are visible and dormant, not ignored:
if `eslint` goes 10 → 11 while the box stays unticked, the pending entry silently
retargets to 11.

This is the answer to "we turned the bot off because of PR noise". You don't turn it
off, you queue it. Dependabot's only options are *open the PR* or *`ignore` forever*.
There is no holding pen.

### Majors must not depend on anyone remembering

A queue nobody drains is a queue that rots. `dependencyDashboardApproval` alone
assumes a human ticks the box; in practice nobody does, and the estate quietly ages.

The fix is not to automerge majors — that is precisely the Dependabot failure above.
The fix is to make the gate **expire**:

```json
{
  "matchUpdateTypes": ["major"],
  "matchCurrentAge": "> 3 months",
  "dependencyDashboardApproval": false,
  "labels": ["dependencies", "major", "overdue"]
}
```

While the version you are running is recent, majors wait behind the checkbox. Once it
is more than three months old, the gate lifts by itself and the PR opens, labelled
`overdue`. Nothing can be forgotten indefinitely, and nothing merges without review.
Tune `> 3 months` to your risk appetite — `> 6 weeks` for a service, `> 1 year` for a
library with a slow release cadence.

`matchCurrentAge` measures the age of the version **currently in the repo**, not the
age of the update, so it targets exactly the dependencies that have been neglected.

**Where automerging a major is defensible:** devDependencies and tooling, after a long
soak, *only when CI actually exercises the tool*. `tsc --noEmit` caught `typescript 7`
here (`TS5108`), so a TypeScript major automerge is genuinely gated. A repo with no
lint step would automerge an `eslint` major completely unverified. Runtime
dependencies should never automerge on a major: `jsonwebtoken 8 → 9` typechecks
cleanly and still changes signature-verification defaults at runtime.

**Do not group majors to reduce noise.** That is precisely what put Dependabot PRs #3
and #5 into a permanent red state here — a breaking major folded into a batch,
with no way to tell which member broke the build. Gate them; don't batch them.

### Grouping key: use the resolver unit, not convenience

Collapsing everything into one PR is not the goal — a PR that cannot be merged is
worth nothing. Group by **the unit the dependency resolver operates on**:

| Ecosystem | Safe to split? | Why |
|---|---|---|
| npm | ✅ | `package-lock.json` regenerated per update |
| gomod | ✅ | resolves transitively |
| **pip (`requirements.txt`)** | ❌ | exact pins, no resolver step at update time |
| Maven | ❌ | no lockfile |

Splitting a pin-exact `requirements.txt` across two PRs produced two manifests that
could not install — `flask 2.0.3` caps `Jinja2<3.1`, `flask 3.1.3` requires
`Jinja2>=3.1.2`, so neither half was internally consistent. Python must move as one
group. The real fix in a production repo is to adopt a resolver — `pip-compile`,
`uv` or Poetry — so Renovate regenerates a full lock and partial bumps stop being
representable.

**Isolate independent majors; group peer-coupled ones.** "Never group majors" is too
blunt. `eslint`, `@typescript-eslint/*` and `typescript` peer-depend on each other, so
isolating their majors made *every one of them* unmergeable alone: eslint 10 conflicts
with the installed `@typescript-eslint 5.62`, and typescript 6 falls outside its peer
range `">=4.8.4 <5.1.0"`. All three resolve fine **together**. The grouping boundary is
the peer-dependency graph, not the update type.

**Never group unrelated majors.** Grouping a breaking major into a batch is what leaves
Dependabot PRs #3 and #5 permanently red in `RESULTS.md`, and it did the same to a
Renovate group here: `typescript 7.0.2` collided with
`peer typescript ">=4.8.4 <6.1.0"` from `@typescript-eslint/parser@8.65.0` and took
seven unrelated updates down with it. Isolate majors and gate them instead.

**A red PR is not always the dependency's fault.** When a grouped or isolated update
fails `npm ci` with `EUSAGE`/`ERESOLVE`, check whether Renovate managed to regenerate
the lockfile at all. If `package.json` moved and `package-lock.json` did not, the
lockfile step itself hit a peer conflict and gave up — the manifest change was
committed alone. That is a grouping problem, not a broken release.

**Suppress updates that cannot resolve.** When an ecosystem is not ready — TypeScript
7 ahead of typescript-eslint — `allowedVersions` stops the PR being raised at all.
A suppressed update beats a permanently red PR that trains people to ignore CI.

### Projected at your scale

Rough model, 200 repos on the four-lane config:

| | unmanaged | four lanes |
|---|---|---|
| PRs per repo per month | 10–15 | 3–4 |
| of which automerged | 0 | ~1 (dev lane) |
| **human-reviewed PRs / repo / month** | **10–15** | **~2** |
| org-wide human-reviewed PRs / month | 2,000–3,000 | **~400** |

Majors are excluded from those numbers entirely — they arrive only when requested.

### The lever that only exists at org scale: shared presets

This is the single biggest corporate advantage and it does not show up in a
single-repo demo.

Put one config in a `myorg/renovate-config` repo. Every other repo contains:

```json
{ "extends": ["local>myorg/renovate-config"] }
```

Change the policy once — new lane, new schedule, new automerge rule, a package
banned org-wide — and all 200 repos follow on their next run. No PR to 200 repos,
no drift, no repo running a two-year-old policy.

Dependabot has **no preset mechanism at all**. Org-wide policy means copying YAML
into every repository and keeping 200 copies in sync by hand.

---

## 3. Making PRs safe to merge

Six independent gates. Stack as many as the risk warrants.

| # | Gate | Config | What it stops |
|---|---|---|---|
| 1 | Major/minor separation | `separateMajorMinor` (**on by default**) | breaking change riding inside a routine batch — the exact Dependabot failure here |
| 2 | **Release soak** | `"minimumReleaseAge": "7 days"` globally, `21 days` for majors, `null` inside `vulnerabilityAlerts` | compromised or yanked releases. A malicious npm publish is usually pulled within hours; a 7-day soak means you never see it |
| 3 | Skip unstable internals | `"internalChecksFilter": "strict"` | PRs for versions that fail Renovate's own pending/stability checks |
| 4 | Human gate on majors | `dependencyDashboardApproval` | anything breaking reaching the PR queue unasked |
| 4b | **Expiring gate** | `matchCurrentAge: "> 3 months"` | the opposite failure — a neglected major nobody ever ticks |
| 5 | **Required CI + Xray check** | branch protection | any PR, from any lane, that fails build or policy scan |
| 6 | Merge Confidence | badges free; **Workflows paid** | low-adoption releases. Workflows can hold a PR until the update reaches *High* confidence across Mend's corpus |

`minimumReleaseAge` deserves emphasis for a corporate setting: it is the cheapest
supply-chain control available and it is one line. Dependabot's equivalent
(`cooldown`) exists but is configured per-ecosystem, not per-package.

Automerge is only safe because gates 1–5 sit in front of it. Renovate's automerge
waits on branch status by default (`ignoreTests` is false), so **every check you add
becomes an automerge gate for free** — no wiring required.

---

## 4. Artifactory + Xray

### 4a. Resolving through Artifactory

```json
{
  "packageRules": [
    { "matchDatasources": ["npm"],    "registryUrls": ["https://artifactory.example.com/api/npm/npm-virtual"] },
    { "matchDatasources": ["docker"], "registryUrls": ["https://artifactory.example.com/docker-virtual"] },
    { "matchDatasources": ["maven"],  "registryUrls": ["https://artifactory.example.com/libs-release"] }
  ],
  "hostRules": [
    {
      "hostType": "docker",
      "matchHost": "artifactory.example.com",
      "username": "renovate-bot",
      "encrypted": { "password": "wcFMA/xxxx..." }
    }
  ]
}
```

Self-hosted takes credentials from environment variables instead, which is usually
what a corporate security review prefers — no registry credential ever leaves the
network.

### 4b. Getting Xray findings into the PR — four routes

**Route A — Xray as a required CI check. Works on every tier, recommended.**

Renovate pushes branches to your own repo (not a fork), so `pull_request` workflows
get secrets. Build the candidate image, push to a scratch Artifactory repo, scan,
post one sticky comment, and expose a gating check.

```yaml
name: xray-scan
on:
  pull_request:
    paths: ["Dockerfile", "package-lock.json"]

permissions:
  contents: read
  pull-requests: write

jobs:
  scan:
    if: startsWith(github.head_ref, 'renovate/')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: jfrog/setup-jfrog-cli@v4
        env:
          JF_URL: ${{ vars.JF_URL }}
          JF_ACCESS_TOKEN: ${{ secrets.JF_ACCESS_TOKEN }}

      - run: docker build -t "$JF_DOCKER_REPO/app:pr-${{ github.event.number }}" .
        env:
          JF_DOCKER_REPO: ${{ vars.JF_DOCKER_REPO }}

      # report pass - full JSON, rendered into one updating comment
      - name: Xray scan (report)
        run: |
          jf docker scan "$JF_DOCKER_REPO/app:pr-${{ github.event.number }}" \
            --format=simple-json --fail=false > xray.json
          jq -r '
            "| Severity | CVE | Component | Fixed in |",
            "|---|---|---|---|",
            (.vulnerabilities // [] | sort_by(.severity) | .[] |
              "| \(.severity) | \(.cves[0].cve // "-") | \(.impactedPackageName) | \(.fixedVersions[0] // "none") |")
          ' xray.json > table.md
          { echo "### 🔍 JFrog Xray — image scan"; echo; cat table.md; } > body.md
          gh pr comment ${{ github.event.number }} \
            --body-file body.md --edit-last --create-if-none
        env:
          JF_DOCKER_REPO: ${{ vars.JF_DOCKER_REPO }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      # gating pass - THIS is the required check Renovate's automerge waits on
      - name: Enforce Xray watch policy
        run: |
          jf docker scan "$JF_DOCKER_REPO/app:pr-${{ github.event.number }}" \
            --watches "${{ vars.JF_WATCH }}" --fail=true
        env:
          JF_DOCKER_REPO: ${{ vars.JF_DOCKER_REPO }}
```

`--edit-last --create-if-none` keeps one comment that updates on each rebase instead
of accumulating one per run. Make the gating step a required status check and
`automerge: true` physically cannot merge a PR that violates your Xray watch.

**Route B — JFrog Curation. Structural; do this as well as Route A.**

Curation blocks disallowed versions at the Artifactory proxy. Because Renovate
resolves *through* Artifactory (4a), a version your policy forbids is never offered
— there is no PR to annotate and no reviewer decision to make. Prevention beats
annotation. Route A then only handles what Curation policy deliberately permits.

**Route C — native, in the PR body. Self-hosted only.**

```json
{
  "postUpgradeTasks": {
    "commands": ["jf docker scan ... --format=simple-json > .renovate-xray.json"],
    "fileFilters": [".renovate-xray.json"],
    "executionMode": "branch"
  }
}
```

`postUpgradeTasks` requires `allowedCommands` in **self-hosted configuration**, so it
is unavailable on any Mend-hosted tier, free or paid. It also needs
`allowShellExecutorForPostUpgradeCommands` if the command needs a shell, which Mend's
own docs flag as a significant security risk (effectively arbitrary command execution
in the bot's context). Worth it only if you already self-host.

**Route D — Xray as the update trigger.** A nightly job pulls violations from the
Xray API and opens its own PRs. Duplicates Renovate, loses grouping and the
dashboard. Not recommended.

**Recommendation: B + A.** Curation to prevent, CI check to report and gate.

---

## 5. Language coverage

Relevant if the estate is polyglot. Every feature above is manager-agnostic — the
dashboard, grouping, automerge, scheduling, `prPriority`, `dependencyDashboardApproval`
and `customManagers` do not know what ecosystem a dependency came from.

| | Go | Python | Java | Ruby | Node |
|---|---|---|---|---|---|
| Managers | `gomod`, `golang-version` | `pip_requirements`, `pipenv`, `poetry`, `pep621` (pdm/uv/hatch/pixi), `pip-compile` | `maven`, `gradle`, `gradle-wrapper` | `bundler`, `ruby-version` | `npm`, `pnpm`, `yarn` |
| Lockfile updated | ✅ `go.sum` | ✅ `poetry.lock`, `Pipfile.lock`, `uv.lock`, `pdm.lock` | ⚠️ Gradle lockfiles only — Maven has none | ✅ `Gemfile.lock` | ✅ |
| `lockFileMaintenance` | ✅ | ✅ | ⚠️ Gradle only | ✅ | ✅ |
| Merge Confidence | ✅ `go` | ✅ `pypi` | ✅ `maven` (covers Gradle) | ✅ `rubygems` | ✅ `npm` |
| OSV alerts | ✅ | ✅ | ✅ | ✅ | ✅ |

Merge Confidence datasources are exactly `go, maven, npm, nuget, packagist, pypi,
rubygems` — npm is not privileged.

Language *support* is not the differentiator; Dependabot covers these too. The
differentiator is that one `renovate.json` auto-discovers every manager in a polyglot
repo and applies one policy across all of them, where `dependabot.yml` needs a
separate `updates:` block per ecosystem per directory.

`customManagers` are language-agnostic by construction: the regex that produced PR
#17 here (`pnpm` pinned in a Dockerfile `ARG`) works unchanged on a Go toolchain
version in a Makefile or a Java version in `.sdkmanrc`. **Dependabot cannot see any
of those files.**

---

## 6. Deployment options and cost

### What is free

| Option | Cost | Private repos | Notes |
|---|---|---|---|
| **Renovate CLI** (open source, Apache-2.0) | Free, unlimited | ✅ | Run it yourself via cron/CI. Full config surface **including `postUpgradeTasks`**. No scheduler, no webhooks, no job history — you build that. |
| **Mend Renovate Community Edition**, self-hosted | Free | ✅ | CLI plus job scheduler, webhook handling, priority queue, job history. Pre-generated key covers 10 repos; a free license key is available for unlimited repos. |
| **Mend Renovate Community Cloud** | Free | ✅ unlimited public and private | Zero ops. **1 concurrent job per org, 4-hour cadence, 30-min job timeout, 3 GB memory, 15 GB disk.** |

### What is paid

| Option | Notes |
|---|---|
| **Mend Renovate Enterprise Cloud** | 16 concurrent jobs per org, hourly scheduling, 60-min timeout, 8 GB memory, 40 GB disk, **Merge Confidence Workflows**, Mend helpdesk support |
| **Mend Renovate Enterprise Edition**, self-hosted | Same feature set, inside your network, with support |

Published list price: **up to $250 per contributing developer per year**, where a
contributing developer is anyone who writes or modifies the code or uses the Mend web
UI. Billing is per head, not per repo, per scan, or per GB.

### 100 developers

| | Annual |
|---|---|
| Renovate CLI or CE self-hosted | **$0** + infrastructure (one small VM or a CI runner) |
| Renovate Enterprise, 100 devs at list | **≤ $25,000** |

Treat $25k as a ceiling, not a quote. The "up to" phrasing and the per-head model
mean the number is negotiated, and Renovate Enterprise can also be bundled inside
Mend AppSec (listed at up to $1,000/dev/yr) rather than bought standalone.

### Do you need to buy it?

**No, not to start.** Every hard requirement in this evaluation is met by the free
self-hosted product:

- private repos — ✅ free
- private Artifactory with credentials that never leave the network — ✅ free, and *better* self-hosted
- Xray gating via CI check — ✅ free, tier-independent
- Xray results natively in the PR body — ✅ free, **but requires self-hosted**; unavailable on any cloud tier at any price
- four-lane grouping, dashboard, approval gating, automerge, `minimumReleaseAge` — ✅ all free, all open source
- Merge Confidence **badges** — ✅ free

**Buy when one of these becomes true:**

1. **You want the cloud and you have real scale.** Community Cloud's *1 concurrent job
   per org* and *4-hour cadence* is the binding constraint. Across hundreds of private
   repos that queue does not drain. Enterprise Cloud's 16 concurrent jobs and hourly
   cadence is what you are actually paying for.
2. **You want Merge Confidence Workflows.** This is the paid feature most aligned with
   "make PRs safe to merge": hold a PR until the update reaches High confidence, or
   automerge only at High. Badges alone are informational; Workflows are enforcement.
3. **You need a support SLA.** Self-hosting means you own upgrades, runner capacity,
   credential rotation and debugging. At 100 devs that is a real, if small, ongoing cost.

### Recommended path

1. **Now — pilot, $0.** Self-host Renovate CE against 5–10 repos. Point it at
   Artifactory. Add the Route A Xray check. Adopt the four-lane config from
   `renovate.json` via an org-level shared preset from day one, so the rollout pattern
   is right before the repo count grows.
2. **Then — measure.** Human-reviewed PRs per repo per month, before and after.
   Automerge rate. Mean time from CVE disclosure to merged fix. These are the numbers
   that justify or refute step 3.
3. **Then — decide.** If self-hosted operations are painful, or you want Merge
   Confidence Workflows enforcing your automerge policy, price Enterprise against the
   measured saving. At ~400 human PR reviews avoided per month, $25k/yr is roughly
   $5 per avoided review.

---

## 7. Where Renovate actually wins

Dependabot in 2026 is a real tool, not the one people remember from 2022. Before
claiming anything, here is what it **can** do, verified against GitHub's current
options reference:

- `groups` — grouped version updates, with `applies-to: security-updates` so
  **security fixes can be grouped too**
- `cooldown` — a release soak, with `default-days`, `semver-major-days`,
  `semver-minor-days`, `semver-patch-days` granularity
- `directories` — multiple paths per ecosystem, with glob support
- `schedule`, `open-pull-requests-limit`, `ignore` (including `versions`),
  `labels`, `commit-message`, `target-branch`, `vendor`, `registries`
- transitive security bumps for npm

Any comparison that ignores the above is dishonest and will be caught in the room.
The list below is what survives it.

### Tier 1 — capability gaps: Dependabot cannot do these at any configuration

| Capability | Renovate | Evidence in this repo |
|---|---|---|
| **Native automerge** | `"automerge": true` on a rule | PR #19 merged by `app/renovate` at 07:28:55Z with no workflow. Dependabot needs a hand-written Action calling `gh pr merge --auto` |
| **A queue you control** | Dependency Dashboard + `dependencyDashboardApproval` | Issue #27. Updates exist, are tracked, and raise no PR until a checkbox is ticked. Dependabot's only states are *open a PR* or *`ignore` forever* |
| **Updating non-manifest files** | `customManagers` regex | PRs #17/#18 update `ARG PNPM_VERSION` and `ARG HADOLINT_VERSION` in the `Dockerfile`. Dependabot updated the `FROM` line and **ignored both ARGs entirely** |
| **Lockfile maintenance** | `lockFileMaintenance` | Scheduled PR that refreshes transitives with **no manifest change**. Dependabot only moves a transitive when an advisory names it |
| **Package replacement** | `replacements:all` preset | `services/go-api` pins the abandoned `dgrijalva/jwt-go`; Renovate proposes swapping it for `golang-jwt/jwt`. Dependabot can only offer newer versions of a package you already depend on |
| **Shareable config presets** | `"extends": ["local>myorg/renovate-config"]` | One preset repo governs 200 repos. Dependabot has no preset mechanism — org policy means 200 copies of YAML kept in sync by hand |
| **PR priority ordering** | `prPriority` | Runtime packages surface first when limits bite. Dependabot has no ordering control |
| **Age-based rules** | `matchCurrentAge: "> 3 months"` | The expiring approval gate: majors wait behind a checkbox while fresh, then open by themselves once the version in use is stale. No Dependabot equivalent |
| **Computed group names** | Handlebars in `groupName`/`groupSlug` | See Tier 2 — this is the one that solved a real problem here |
| **Merge Confidence** | badges free, Workflows paid | Age + adoption + pass-rate per version pair, across `go`, `maven`, `npm`, `nuget`, `packagist`, `pypi`, `rubygems` |
| **Platform independence** | GitLab, Bitbucket, Gitea, Azure DevOps, self-hosted | Dependabot is GitHub-only |
| **Running your own code post-update** | `postUpgradeTasks` (self-hosted) | The only native route for putting Xray output into the PR body |

### Tier 2 — expressiveness: both can, but only one can say it once

This is the difference people underrate, and it is the one this repo demonstrated
by accident.

Grouping is not "on or off". The correct grouping key is **the unit the resolver
operates on**, and that differs per ecosystem in the same repo:

| Ecosystem | Safe to split? | Why |
|---|---|---|
| npm | ✅ | `package-lock.json` is regenerated per update |
| gomod | ✅ | resolves transitively |
| **pip (`requirements.txt`)** | ❌ | exact pins, no resolver step |
| Maven | ❌ | no lockfile |

We learned this the hard way. Security fixes were grouped by update type, which
produced two `requirements.txt` files that could not install:

```
PR A   flask==2.0.3   (caps Jinja2<3.1)      + jinja2==3.1.6   -> ResolutionImpossible
PR B   flask==3.1.3   (needs Jinja2>=3.1.2)  + jinja2==3.0.3   -> ResolutionImpossible
```

The rule that fixes it is "one PR per package, except Python, which moves as a
unit". In Renovate that is **one line**, because `groupName` accepts Handlebars:

```json
{
  "vulnerabilityAlerts": {
    "groupName": "security ({{#if (equals manager \"pip_requirements\")}}python{{else}}{{{depName}}}{{/if}})"
  }
}
```

Dependabot cannot express that at all. `groups` takes literal patterns, so the
same policy means enumerating every Python package by hand in one group and
accepting per-package behaviour everywhere else — and re-editing it every time a
dependency is added.

The same applies to the other conditional rules this repo relies on: "majors, but
only once the installed version is over three months old", "devDependency majors
only, after a 30-day soak, automerged", "cap `typescript` below the peer range
`@typescript-eslint` declares". Each is one `packageRules` entry. None has a
Dependabot equivalent.

**The honest framing:** Dependabot config is a list of per-ecosystem settings.
Renovate config is a rule engine with matchers, inheritance and templates. For a
handful of repos the difference is noise. For a fleet with a policy that must hold
across ecosystems, it is the whole argument.

### What happened when we tried to make Dependabot match

`.github/dependabot.yml` in this repo is not a strawman. It is a deliberate,
maximal attempt to reproduce every lane in `renovate.json`, plus
`.github/workflows/dependabot-automerge.yml` to approximate the one thing the
config format cannot express. What follows is the result of that attempt.

#### Reached parity

| Renovate | Dependabot equivalent | Verdict |
|---|---|---|
| grouped non-major, per manager | `groups` with `update-types` | ✅ equivalent |
| grouped security | `groups` + `applies-to: security-updates` | ✅ equivalent |
| security split major / non-major | two groups with `update-types` | ✅ equivalent |
| Python moves as one unit | `patterns: ["*"]` with no `update-types` filter | ✅ equivalent |
| peer-coupled toolchain family | `patterns: [eslint, "@typescript-eslint/*", typescript]` | ✅ equivalent, hand-maintained |
| `minimumReleaseAge: "7 days"` / `"21 days"` for majors | `cooldown` with `semver-major-days` | ✅ equivalent, per ecosystem not per package |
| `allowedVersions: "<6.1.0"` | `ignore: versions: [">=6.1.0"]` | ✅ equivalent |
| weekly schedule, PR limits, labels | native | ✅ equivalent |
| polyglot directories | one `updates:` block per ecosystem per directory | ✅ works, 5 blocks vs 0 extra lines |

#### Reached with extra machinery

| Renovate | Cost in Dependabot |
|---|---|
| `"automerge": true` on a packageRule | a 40-line workflow using `dependabot/fetch-metadata`, `pull_request_target`, `contents: write` + `pull-requests: write`, and re-deriving dependency type from metadata outputs. The policy now lives in a workflow instead of beside the update rules, and breaks silently if the action's outputs change |

#### Could not be reproduced at all

| Renovate | Why Dependabot cannot |
|---|---|
| **Dependency Dashboard** | no equivalent surface exists |
| **`dependencyDashboardApproval`** | the only way to defer a major is `ignore: update-types: [version-update:semver-major]`, which **hides it entirely** — untracked, invisible, never resurfaced. Deferring and hiding are different things |
| **`matchCurrentAge: "> 3 months"`** | no age-of-installed-version predicate exists, so an expiring gate cannot be built |
| **`customManagers`** | `ARG PNPM_VERSION` and `ARG HADOLINT_VERSION` in the `Dockerfile` are invisible. No ecosystem owns them |
| **`lockFileMaintenance`** | cannot refresh transitives without a manifest change |
| **`replacements:all`** | cannot propose `dgrijalva/jwt-go` → `golang-jwt/jwt` |
| **`prPriority`** | no ordering control |
| **templated `groupName`** | `groups` takes literal patterns. "One PR per package, except Python, which moves as a unit" cannot be written; it has to be enumerated per package and re-edited whenever a dependency is added |
| **shared presets** | no `extends`. This 130-line file is copied into every repository and maintained in N places |

#### The honest scorecard

Grouping is **not** where Renovate wins — Dependabot's grouping is genuinely good,
and this config proves it. What the exercise actually surfaced:

1. **Volume parity is achievable.** If your only goal is fewer PRs, Dependabot gets
   you there. Do not build the business case on PR count.
2. **Automerge costs a workflow**, and that workflow carries a
   `pull_request_target` + `contents: write` footgun that has to be reviewed.
3. **The gap is deferral, discoverability and reach.** No queue, no way to defer a
   major without hiding it, no visibility into versions that are not in a manifest,
   no lockfile refresh, no package replacement.
4. **The gap compounds with repository count.** One repo: this file is fine. Two
   hundred repos: it is 200 copies of a 130-line file, and every policy change is a
   200-repo pull request. That is the argument, and it is the only one that does not
   have a Dependabot answer.

### Tier 3 — do NOT claim these; they are parity

- grouped version updates
- grouped **security** updates (`applies-to: security-updates`)
- release soak (`cooldown` vs `minimumReleaseAge`) — Renovate's is per-package
  rather than per-ecosystem, which is a granularity difference, not a capability one
- scheduling, PR limits, ignore lists, labels, commit message control
- multiple directories per ecosystem (`directories` supports globs)
- transitive security updates for npm
- language coverage — Dependabot supports Go, Python, Java, Ruby, npm too

### Tier 4 — where Dependabot genuinely wins

- **Zero setup.** It is already in the repo. No app install, no third-party access
  to private code, no security review.
- **No SaaS dependency** if you would otherwise use Renovate's hosted app. Mend
  reading your private repositories is a real procurement conversation; Dependabot
  is first-party GitHub.
- **Fewer moving parts.** Self-hosting Renovate means you own upgrades, runners and
  credential rotation.
- **Defaults are not the argument.** The four red Dependabot PRs recorded in
  `RESULTS.md` came from grouping a breaking major into a batch. Adding
  `update-types` filters to its groups would have prevented them. That is a
  configuration mistake, not a capability gap, and saying otherwise invites a
  correction that costs you the room.

### The one-sentence version

> Dependabot can group, schedule, soak and limit. It cannot automerge, cannot hold
> work in a queue, cannot see a version that is not in a manifest, cannot refresh a
> lockfile on its own, cannot replace an abandoned package, and cannot share one
> policy across a fleet. Everything else is configuration.

## 8. Honest limits

- **Dependabot is not bad.** It grouped correctly where told, produced security PRs for
  all four direct and six transitive vulnerabilities, and needed zero installation. The
  four red PRs in `RESULTS.md` are a **defaults** problem — `update-types` filters on
  its groups would have prevented them.
- **Renovate has more configuration surface, which is also a liability.** A badly
  written `packageRules` array silently does nothing. Keep `renovate-config-validator`
  in CI on the shared preset repo.
- **Grouping trades attribution for volume.** When a grouped PR fails CI you know one
  of twelve deps broke it, not which. Mitigate by temporarily adding
  `{"matchPackageNames":["broken-pkg"],"enabled":false}` — Renovate rebuilds the group
  without it on the next run.
- **`postUpgradeTasks` is a genuine security consideration**, not just a feature. It
  executes commands in the bot's context. Allowlist narrowly, avoid the shell executor.
- The honest one-line claim:

  > Renovate's defaults were safe here, and where they aren't there are knobs.
  > Dependabot's defaults broke the build, and some of the knobs to fix that —
  > the dashboard queue, custom managers, lockfile maintenance, shared presets —
  > do not exist.

---

## Sources

Pricing and tier facts verified 2026-08-24:

- Mend.io pricing — <https://www.mend.io/pricing/>
- Mend-hosted Renovate tiers and limits — <https://docs.renovatebot.com/mend-hosted/overview/>
- Mend Renovate Community Edition (self-hosted) — <https://www.mend.io/mend-renovate-community/>
- Merge Confidence badges vs Workflows — <https://docs.renovatebot.com/merge-confidence/>
- Renovate CE/EE — <https://github.com/mend/renovate-ce-ee>

Commercial terms change and "up to" pricing is negotiated. Confirm with Mend sales
before budgeting.
