# The System (System Bootstrapper)

A Development Environment Bootstrapper for the [System-Web](https://github.com/kihyoun/system-web)

## Intro

What is the `System`?

> „Software Engineering: The establishment and use of sound engineering principles in order to obtain economically software that is reliable and runs on real machines." - Friedrich Ludwig Bauer, 1968

The above cite, made by Ludwig Bauer on a Nato Conference in 1968, describes the Goal of the `System`.

A full functional software development lifecycle and environment based on Gitlab and Docker for the Development of "`X`". 

This is the Bootstrapper for the `System-Web`, which aims to be a fully functional Development Environment and Self-Contained System for the Development of the Web Application written in React. It features a full functional Environment and Workflow for the [Gitlab Review Apps](https://docs.gitlab.com/ee/ci/review_apps/)

The `System Bootstrapper` aims to fully automate the `Bootstrap` of the Environment and maintenance for `System-Web`.

![https://raw.githubusercontent.com/kihyoun/system/main/overview.png](https://raw.githubusercontent.com/kihyoun/system/main/overview.png)

### Architecture
The Host is a Docker Host, which runs a NGINX Container in Host Network Mode, the Master NGINX. All HTTP/HTTPS Requests are handled by this Container. 

Another Container is running Gitlab/CE. The Gitlab Container is created before the NGINX Master. The internal IP of the Container is published to the Master NGINX config. Requests to the `gitlab` and `registry` Subdomain are SSL encrypted and then routed as upstream with proxy_pass to the gitlab container. 

All remaining Subdomains should be routed to dynamically created containers at runtime, a deployment Network.

We could publish the internal IP of the container to the Master. But this approach would require the Master to restart and more difficult Maintenance and configuration.

Instead, we use [jwilder/nginx-proxy](https://hub.docker.com/r/jwilder/nginx-proxy) and create three instances with static internal IP's. Let's call them the Production, Beta and Review Proxy. The IPs are published to the Master before the master startup. (The Master can anytime be refreshed with the `start.sh` command, this will also renew the Configuration with the IPs of the Gitlab Container and the Proxies).

Subdomains `www` and `beta` are routed SSL encrypted to the Beta and Production Proxy. 
All other Subdomains go unencrypted to the Review Proxy.

During a successful Pipeline, the following will happen in the Test-Stage on a Merge-Request:
1. The Container starts in detached Mode in the Review Proxy Network (see the [.gitlab-ci.yml](https://github.com/kihyoun/system-web/blob/main/.gitlab-ci.yml#L70) from the System-Web Example)
2. The Subdomain, which is the Branchname, is published as VIRTUAL_HOST to the Review Proxy. **The Application will be served under the given Subdomain without restarting the Master.**

## Preperation

- [Install Docker](https://docs.docker.com/engine/install/ubuntu/)
- Create .docker.env - [.docker.env.example](https://github.com/kihyoun/system/blob/main/.docker.env.example)
- Install SSL Certificates (this Project uses [Certbot](https://ceratbot.eff.org/lets-encrypt/ubuntufocal-other))
- Setup Nginx nginx/templates/*.conf.template 

## Get started

```bash
./start.sh
```
The initial Run may take a few minutes, depending on Network. 

Your Container Network should look like this:
```bash
─[$] docker ps                                                                                                                                                                                                               [3:43:24]
CONTAINER ID        IMAGE                                             COMMAND                  CREATED             STATUS                    PORTS                                 NAMES
ed1a591be903        nginx                                             "/docker-entrypoint.…"   14 minutes ago      Up 14 minutes                                                   nginx_web_1
c5225722761c        jwilder/nginx-proxy                               "/app/docker-entrypo…"   14 minutes ago      Up 14 minutes             80/tcp                                nginx-proxy_review_1
a3a9e673a45a        jwilder/nginx-proxy                               "/app/docker-entrypo…"   14 minutes ago      Up 14 minutes             80/tcp                                nginx-proxy_prod_1
1dbe7969f2d1        jwilder/nginx-proxy                               "/app/docker-entrypo…"   14 minutes ago      Up 14 minutes             80/tcp                                nginx-proxy_beta_1
51594d8a84d3        gitlab/gitlab-ce:latest                           "/assets/wrapper"        14 minutes ago      Up 14 minutes (healthy)   80/tcp, 0.0.0.0:22->22/tcp, 443/tcp   gitlab_gitlab_1
```

If the Containers are running, open your Gitlab URL and Setup a Project with the [System-Web Repository](https://github.com/kihyoun/system-web)

## Gitlab Runners
After initial Setup, go to Settings->CI/CD and obtain your Runners Token. Add this to GITLAB_RUNNER_TOKEN in `.docker.env`.

Start the Runners:

```bash
cd gitlab-runner; ./start.sh
```

Visit Settings->CI/CD and check the Runners Section. The Runners will now show up.

## Maintaining

Use `stop.sh`/`start.sh` from the Root Folder. They gracefully shutdown and cleanup orphaned volumes and images.

However, all Services can individually be started/stopped with the `stop.sh`/`start.sh` Script inside each Folder for debugging and reconfiguration.

### Backup
1. (optional) Shutdown the System:
```bash
./stop.sh
```
2. Setup `BACKUPDIR` and `LIVEDIR` in `.docker.env`
3. Run the Backup Script: 
```bash
./backup.sh
```

Hint: You can run the backup Script without shutting down everything, as it uses rsync, and watch the Sync Procedure

### Gitlab

The GITLAB Service has no dependencies and can be started/stopped at any time using the start/stop scripts. 

On startup, the Gitlab Service will create a .docker.env with the IP Address, and reconfigure itself with the IP Address. This is because we are using an external Registry Address, which is Proxied through our Main NGINX

### Gitlab Runner

Stop the Gitlab Runners only if the Gitlab is running. If the Gitlab Instance is not running, and you stop the Gitlab Runners, they will not unregister, and on next startup they will register again. That will create duplicate Runners entries. You can clean them up using the `--all-runners` Option in the stop Script.

The Number Docker Runners can be changed with GITLAB_RUNNER_DOCKER_SCALE in the `.docker.env`
They use the [docker-compose scale](https://docs.docker.com/compose/compose-file/compose-file-v2/#scale) Feature, introduced in [Compose Version 2.2](https://docs.docker.com/compose/compose-file/compose-versioning/#version-22)

### NGINX Proxy

The NGINX Proxy Services handle each different Networks. One for Production, for for the Beta Test (both SSL Secured), and one for the dynamic [Review Apps](https://docs.gitlab.com/ee/ci/review_apps/) Network.
 
The NGINX Proxies create 3 independent Subnetworks:

* nginx-proxy_prod
* nginx-proxy_beta
* nginx-proxy_review

If the NGINX Proxy gets incoming Traffic from the NGINX Master, the Traffic will be sent to the Container running in the same Network, with the matching VIRTUAL_HOST. See the [Gitlab CI Example from System-Web](https://github.com/kihyoun/system-web/blob/main/.gitlab-ci.yml#L70)

### NGINX 

The NGINX Server is running in Host Mode. It manages all incoming HTTP/HTTPS Requests and routing the Traffic to one of the internal NGINX Proxy or the Gitlab Container.





