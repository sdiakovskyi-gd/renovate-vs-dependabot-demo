# The `docker` manager updates this FROM line.
# Pinned deliberately old so both bots have something to bump.
FROM node:26.7-alpine

# --- custom regex manager target -------------------------------------------
# These ARGs are NOT image references, so no built-in manager understands them.
# Renovate picks them up via the `customManagers` entry in renovate.json.
# Dependabot has no equivalent feature.
# renovate: datasource=npm depName=pnpm
ARG PNPM_VERSION=8.6.0
# renovate: datasource=github-releases depName=hadolint packageName=hadolint/hadolint
ARG HADOLINT_VERSION=2.12.0
# ---------------------------------------------------------------------------

WORKDIR /app

RUN npm install -g pnpm@${PNPM_VERSION}

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

EXPOSE 3000
CMD ["node", "dist/index.js"]
