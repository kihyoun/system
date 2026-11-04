FROM nginx:stable-alpine@sha256:970364228b1e4f932abc22d321932816782cca8a20b85a77552a7cfe9acfb3b5
COPY .system-bootstrapper/refresh-ca.sh /opt/system-bootstrapper/refresh-ca.sh
COPY .system-bootstrapper/ca /opt/system-bootstrapper/ca
RUN sh /opt/system-bootstrapper/refresh-ca.sh

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html main.js styles.css /usr/share/nginx/html/
EXPOSE 80
