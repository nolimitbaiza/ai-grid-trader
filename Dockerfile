# Railway deployment: the static site served by Caddy.
# Only the website files are copied; tools, tests and the Streamlit prototype stay out.
FROM caddy:2.8-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY index.html ai-grid-trader.html ai-grid-trader-case-study.html battery-wear-cost.html perfect-hindsight-benchmark.html about.html 404.html robots.txt sitemap.xml manifest.webmanifest sw.js /srv/
COPY assets /srv/assets
# Stamp this build into file addresses (style.css?v=…) and the offline cache name, so every deploy
# is fetched fresh by browsers and Cloudflare instead of mixing new pages with old cached files.
RUN BUILD=$(date -u +%Y%m%d%H%M%S) && \
    sed -i "s/__BUILD__/$BUILD/g" /srv/index.html /srv/ai-grid-trader.html /srv/ai-grid-trader-case-study.html /srv/battery-wear-cost.html /srv/perfect-hindsight-benchmark.html /srv/sw.js /srv/assets/app.js
# Fail the build, not the live site, if the server configuration is invalid.
RUN caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
