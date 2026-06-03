#!/bin/sh
# Generates .htpasswd from Railway environment variables at container startup.
# Set BASIC_AUTH_USER and BASIC_AUTH_PASSWORD in Railway → Variables.

if [ -z "$BASIC_AUTH_USER" ] || [ -z "$BASIC_AUTH_PASSWORD" ]; then
  echo "WARNING: BASIC_AUTH_USER or BASIC_AUTH_PASSWORD not set. Disabling auth."
  sed -i '/auth_basic/d' /etc/nginx/nginx.conf
else
  echo "Basic Auth enabled for user: $BASIC_AUTH_USER"
  htpasswd -bc /etc/nginx/.htpasswd "$BASIC_AUTH_USER" "$BASIC_AUTH_PASSWORD"
fi

exec nginx -g "daemon off;"
