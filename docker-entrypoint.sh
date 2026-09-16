#!/bin/sh
#
# PID 1 has no default signal actions: the kernel ignores SIGTERM/SIGINT for it
# unless the process installs a handler, and busybox httpd installs none. Without
# this forwarder, `docker stop` waits out its whole grace period and Ctrl+C on
# `docker run` never reaches httpd.
#
# `wait` is what lets the traps run; it also makes the container exit the moment
# httpd does, with httpd's status, so a crash is not masked.

stopping=
trap 'stopping=1; kill -TERM "${pid:-}" 2>/dev/null' TERM INT

httpd -f -p 8080 -h /www -u nobody:nobody &
pid=$!

status=0
wait "$pid" || status=$?

if [ -n "$stopping" ]; then
  exit 0
fi
exit "$status"
