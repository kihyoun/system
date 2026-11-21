FROM mcr.microsoft.com/playwright:v1.64.1-noble@sha256:7852dc5a7d72f5fe458a597d690f6c42fbc8e9e26ddfa95f8e6ef552558d9bbf
WORKDIR /smoke
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY .system-bootstrapper/build-v1/smoke/package.json .system-bootstrapper/build-v1/smoke/package-lock.json ./
RUN npm ci --ignore-scripts --no-fund
COPY .system-bootstrapper/build-v1/smoke/check.js ./check.js
CMD ["node", "check.js"]
