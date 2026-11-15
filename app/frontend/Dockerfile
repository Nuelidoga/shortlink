# Unprivileged Nginx image: runs as a non-root user and listens on 8080.
FROM nginxinc/nginx-unprivileged:stable-alpine

# Templates in this folder are rendered with envsubst when the container starts.
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY html/ /usr/share/nginx/html/

ENV API_URL=http://api:3000
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost:8080/healthz || exit 1
