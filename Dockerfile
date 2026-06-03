FROM nginx:alpine

# Install apache2-utils for the htpasswd command
RUN apk add --no-cache apache2-utils

# Copy all app files into nginx web root
COPY . /usr/share/nginx/html

# Use custom nginx config
COPY nginx.conf /etc/nginx/nginx.conf

# Copy startup script and make it executable
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80

ENTRYPOINT ["/entrypoint.sh"]
