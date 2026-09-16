FROM busybox:1.37

COPY index.html app.css app.js schedule.js /www/
COPY docker-entrypoint.sh /docker-entrypoint.sh

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=2s \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1

ENTRYPOINT ["/bin/sh", "/docker-entrypoint.sh"]
