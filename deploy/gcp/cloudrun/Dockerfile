# The GCP failover copy of tukuk.org, served by nginx from inside the image.
# Content is baked in at build time (see cloudrun-mirror-rebuild.sh) so a cold start
# never touches the network.
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY site/ /usr/share/nginx/html/
