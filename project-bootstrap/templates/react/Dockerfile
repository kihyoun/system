FROM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS build
COPY .system-bootstrapper/refresh-ca.sh /opt/system-bootstrapper/refresh-ca.sh
COPY .system-bootstrapper/ca /opt/system-bootstrapper/ca
RUN sh /opt/system-bootstrapper/refresh-ca.sh

ENV NODE_OPTIONS=--use-openssl-ca
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
FROM nginx:stable-alpine@sha256:970364228b1e4f932abc22d321932816782cca8a20b85a77552a7cfe9acfb3b5
COPY .system-bootstrapper/refresh-ca.sh /opt/system-bootstrapper/refresh-ca.sh
COPY .system-bootstrapper/ca /opt/system-bootstrapper/ca
RUN sh /opt/system-bootstrapper/refresh-ca.sh

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/ /usr/share/nginx/html/
EXPOSE 80
