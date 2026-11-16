# Railway deployment: the static site served by Caddy.
# Only the website files are copied; tools, tests and the Streamlit prototype stay out.
FROM caddy:2.8-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY index.html about.html manifest.webmanifest sw.js /srv/
COPY assets /srv/assets
