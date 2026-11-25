FROM mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27
WORKDIR /smoke
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY .system-bootstrapper/build-v1/smoke/package.json .system-bootstrapper/build-v1/smoke/package-lock.json ./
RUN npm ci --ignore-scripts --no-fund
COPY .system-bootstrapper/build-v1/smoke/check.js ./check.js
CMD ["node", "check.js"]
