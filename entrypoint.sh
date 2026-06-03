#!/bin/sh
# Generates .htpasswd and config.js from Railway environment variables at container startup.
# Required Railway Variables:
#   BASIC_AUTH_USER, BASIC_AUTH_PASSWORD
#   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

# 1. Basic Auth setup
if [ -z "$BASIC_AUTH_USER" ] || [ -z "$BASIC_AUTH_PASSWORD" ]; then
  echo "WARNING: BASIC_AUTH_USER or BASIC_AUTH_PASSWORD not set. Disabling auth."
  sed -i '/auth_basic/d' /etc/nginx/nginx.conf
else
  echo "Basic Auth enabled for user: $BASIC_AUTH_USER"
  htpasswd -bc /etc/nginx/.htpasswd "$BASIC_AUTH_USER" "$BASIC_AUTH_PASSWORD"
fi

# 2. Generate config.js from environment variables (secrets never stored in repo)
cat > /usr/share/nginx/html/config.js <<EOF
export const SUPABASE_URL = '${SUPABASE_URL:-https://placeholder.supabase.co}';
export const SUPABASE_ANON_KEY = '${SUPABASE_ANON_KEY:-placeholder}';
export const TELEGRAM_BOT_TOKEN = '${TELEGRAM_BOT_TOKEN:-}';
export const TELEGRAM_CHAT_ID = '${TELEGRAM_CHAT_ID:-}';
EOF
echo "config.js generated from environment variables."

exec nginx -g "daemon off;"
