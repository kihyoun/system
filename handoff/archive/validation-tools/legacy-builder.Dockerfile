FROM wizard-suggestions-deps AS deps
FROM node:13.12.0-alpine
COPY --from=deps /tmp/wizard /tmp/wizard
WORKDIR /tmp/wizard
