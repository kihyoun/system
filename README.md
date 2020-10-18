# The System-Web Bootstrapper

A Bootstrapper for the [System-Web Project](https://github.com/kihyoun/system-web)

## Preperation

- [Install Docker](https://docs.docker.com/engine/install/ubuntu/)
- Create .docker.env - [.docker.env.example](https://github.com/kihyoun/system/blob/main/.docker.env.example)
- Install SSL Certificates (this Project uses [Certbot](https://ceratbot.eff.org/lets-encrypt/ubuntufocal-other))
- Setup Nginx nginx/templates/*.conf.template 

## Get started

```bash
./start.sh
```

Open your Gitlab URL and Setup a Project with the [System-Web Repository](https://github.com/kihyoun/system-web)

## Gitlab Runners
After initial Setup, go to Settings->CI/CD and obtain your Runners Token. Add this to GITLAB_RUNNER_TOKEN in `.docker.env`.

Start the Runners:

```bash
cd gitlab-runner; ./start.sh
```

Visit Settings->CI/CD and check the Runners Section. The Runners will now show up.

