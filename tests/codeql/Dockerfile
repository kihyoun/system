FROM node:24.22.0-bookworm@sha256:925de64a85319052d6971ae81ef2417da956e8a3a2c4a0fac732327970f017f5
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl zstd \
 && rm -rf /var/lib/apt/lists/*
RUN curl --fail --location --retry 3 --max-time 600 \
      https://github.com/github/codeql-action/releases/download/codeql-bundle-v2.27.4/codeql-bundle-linux64.tar.zst \
      --output /tmp/codeql.tar.zst \
 && printf '%s  %s\n' da3e952c7fe978a0b6b93e75d9cbabbdf8535667ca0810bd4b2ae37bc840ffee /tmp/codeql.tar.zst | sha256sum --check - \
 && tar --zstd -xf /tmp/codeql.tar.zst -C /opt \
 && chmod -R a+rX /opt/codeql \
 && rm /tmp/codeql.tar.zst \
 && mkdir /reports && chown node:node /reports
COPY source /source
ENV HOME=/reports/home
USER node
WORKDIR /source
ENTRYPOINT ["sh", "/source/tests/codeql/scan.sh"]
