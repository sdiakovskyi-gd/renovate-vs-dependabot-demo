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

## 7. Honest limits

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
