FROM node:13.12.0-alpine@sha256:cc85e728fab3827ada20a181ba280cae1f8b625f256e2c86b9094d9bfe834766 AS checked
WORKDIR /app
ENV CYPRESS_INSTALL_BINARY=0
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . ./
# Only this known-safe preflight setting is imported, never private dotenv files.
RUN cp .system-bootstrapper/preflight.env .env
RUN CI=true npm test -- --watch=false --runInBand
# Preserve the baseline CRA warning policy; CI=true applies to Jest above.
RUN CI= npm run build
FROM nginx:stable-alpine@sha256:970364228b1e4f932abc22d321932816782cca8a20b85a77552a7cfe9acfb3b5
COPY --from=checked /app/build /usr/share/nginx/html
COPY --from=checked /app/nginx/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
