#! /bin/bash
docker-compose up --build --remove-orphans -d
printf "REVIEW_PROXY=" > .docker.env
docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' nginx-proxy_review_1 >> .docker.env

printf "PROD_PROXY=" >> .docker.env
docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' nginx-proxy_prod_1 >> .docker.env

printf "BETA_PROXY=" >> .docker.env
docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' nginx-proxy_beta_1 >> .docker.env

