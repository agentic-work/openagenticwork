# Copyright (c) 2026 Agenticwork LLC
# For all inquiries, please contact:
# Agenticwork LLC
# hello@agenticwork.io

# Build stage for UI
FROM node:20-slim AS ui-builder

# Install dependencies
WORKDIR /app

# Use ARG to get the source path (default to services/agenticwork-ui for GitHub Actions)
ARG SRC_PATH=services/agenticwork-ui

# Copy package files
COPY ${SRC_PATH}/package*.json ./
COPY ${SRC_PATH}/tsconfig*.json ./
COPY ${SRC_PATH}/tailwind.config.js ./
COPY ${SRC_PATH}/postcss.config.js ./

# Install dependencies
RUN npm install

# Add cache-busting ARG
ARG CACHEBUST=1

# Build info arguments
ARG GIT_COMMIT=unknown
ARG GIT_SHORT_COMMIT=unknown
ARG GIT_BRANCH=unknown
ARG BUILD_TIME=unknown

# Copy source files
COPY ${SRC_PATH}/src ./src
COPY ${SRC_PATH}/public ./public
COPY ${SRC_PATH}/index.html ./
COPY ${SRC_PATH}/vite.config.ts ./

# Clean build artifacts
RUN rm -rf dist node_modules/.cache .vite

# NOTE: Documentation page removed from UI - docs are no longer bundled

# Pure Frontend - Only needs API URL
ARG API_URL
ARG VITE_ENABLE_IMAGE_ANALYSIS=true
ARG VITE_ENABLE_DIAGRAM_CREATION=true
ARG VITE_ENABLE_AUTO_EXPORT=true

# Set environment variables for build
ENV NODE_ENV=production
ENV VITE_API_URL=${API_URL}
ENV VITE_ENABLE_IMAGE_ANALYSIS=${VITE_ENABLE_IMAGE_ANALYSIS}
ENV VITE_ENABLE_DIAGRAM_CREATION=${VITE_ENABLE_DIAGRAM_CREATION}
ENV VITE_ENABLE_AUTO_EXPORT=${VITE_ENABLE_AUTO_EXPORT}
ENV VITE_GIT_COMMIT=${GIT_COMMIT}
ENV VITE_GIT_SHORT_COMMIT=${GIT_SHORT_COMMIT}
ENV VITE_GIT_BRANCH=${GIT_BRANCH}
ENV VITE_BUILD_TIME=${BUILD_TIME}

# Build the application
RUN npm run build

# Production stage
FROM nginx:alpine

# Re-declare ARG for the production stage
ARG SRC_PATH=services/agenticwork-ui

# Create agentic user
RUN addgroup -g 1001 -S agentic && adduser -u 1001 -S agentic -G agentic

# Copy built UI files from ui-builder
COPY --chown=agentic:agentic --from=ui-builder /app/dist /usr/share/nginx/html

# Copy nginx config template (will be processed by entrypoint)
COPY ${SRC_PATH}/nginx.conf.template /etc/nginx/conf.d/default.conf.template

# Copy entrypoint script with proper ownership
COPY --chown=agentic:agentic ${SRC_PATH}/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Create health check endpoint
RUN echo "OK" > /usr/share/nginx/html/health && chown agentic:agentic /usr/share/nginx/html/health

# Set environment variables for runtime
ENV API_BASE_URL=/api \
    NGINX_WORKER_PROCESSES=auto \
    NGINX_WORKER_CONNECTIONS=1024

# Expose port 80
EXPOSE 80

# Health check
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost/health || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]