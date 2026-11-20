FROM mcr.microsoft.com/playwright:v1.64.1-noble@sha256:7852dc5a7d72f5fe458a597d690f6c42fbc8e9e26ddfa95f8e6ef552558d9bbf
COPY .system-bootstrapper/build-v2/runtime /opt/system-bootstrapper/runtime
COPY .system-bootstrapper/build-v2/bootstrapper/ca /opt/system-bootstrapper/bootstrapper/ca
RUN node /opt/system-bootstrapper/runtime/project-ci.cjs refresh-ca /opt/system-bootstrapper
WORKDIR /smoke
ENV NODE_OPTIONS=--use-openssl-ca
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY .system-bootstrapper/build-v2/smoke/package.json .system-bootstrapper/build-v2/smoke/package-lock.json ./
RUN npm ci --ignore-scripts --no-fund
COPY .system-bootstrapper/build-v2/smoke/check.js ./check.js
CMD ["node", "check.js"]
