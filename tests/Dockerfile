# Isolated checks only: no Docker daemon, live credentials or private configuration.
FROM node:24.22.0-bookworm-slim
WORKDIR /candidate
COPY sync/package.json sync/package-lock.json ./sync/
RUN cd sync && npm ci --ignore-scripts --no-audit --no-fund
COPY sync/src ./sync/src
COPY sync/tsconfig.json ./sync/tsconfig.json
COPY project-bootstrap ./project-bootstrap
COPY gitlab/*.js gitlab/*.sh gitlab/gitlab.rb ./gitlab/
COPY gitlab-runner/*.js gitlab-runner/*.sh ./gitlab-runner/
COPY nginx/*.sh ./nginx/
COPY nginx/.templates ./nginx/.templates
COPY nginx-proxy/*.sh ./nginx-proxy/
COPY system/.docker.env.example system/start-intermediate.sh ./system/
COPY tests ./tests
RUN cd sync && ./node_modules/.bin/tsc --project tsconfig.json
ENV SYSTEM_TEST_ISOLATED=1
ENTRYPOINT ["node", "tests/run.js"]
CMD ["all"]
