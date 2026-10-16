
external_url '${GITLAB_EXTERNAL_URL}'

registry_external_url '${GITLAB_REGISTRY_URL}'

### Settings used by GitLab application
gitlab_rails['registry_enabled'] = true
${DISABLE_INSECURE_REGISTRY}gitlab_rails['registry_host'] = "${GITLAB_REGISTRY_HOST}"
${DISABLE_INSECURE_REGISTRY}gitlab_rails['registry_port'] = 5050

### Settings used by Registry application
registry['enable'] = true
registry['registry_http_addr'] = "0.0.0.0:5050"
nginx['enable'] = true
nginx['client_max_body_size'] = "900m"
nginx['redirect_http_to_https'] = false
nginx['listen_port'] = 80
nginx['listen_https'] = false
registry_nginx['enable'] = false

# some optimizations
gitlab_rails['sentry_enabled'] = false
prometheus_monitoring['enable'] = false
node_exporter['enable'] = false
prometheus['enable'] = false

gitlab_rails['object_store']['enabled'] = false
