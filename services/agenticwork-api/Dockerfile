# Copyright (c) 2026 Agenticwork LLC  
# For all inquiries, please contact:
# Agenticwork LLC
# hello@agenticwork.io

# Smart Dockerfile that works for both docker-compose and standalone builds
# Usage:
#   Standalone: docker build .
#   Compose: docker build --build-arg SRC_PATH=services/agenticwork-api .

# Build stage
FROM node:20-slim AS api-builder

WORKDIR /app

# Install build dependencies including canvas requirements
RUN apt-get update && apt-get upgrade -y && \
    apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    python3-pip \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    libpixman-1-dev \
    pkg-config \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Install pnpm
RUN npm install -g pnpm

# Path prefix for docker-compose builds (empty for standalone)
ARG SRC_PATH=.

# Copy package files AND prisma schema first (before install)
COPY ${SRC_PATH}/package.json ./
COPY ${SRC_PATH}/pnpm-lock.yaml* ./
COPY ${SRC_PATH}/prisma ./prisma

# Install all dependencies (including dev dependencies for build)
# This will also run prisma generate as postinstall with the correct schema
RUN pnpm install --no-frozen-lockfile

# Force rebuild canvas module to generate native bindings
RUN pnpm rebuild canvas

# Add cache-busting ARG
ARG CACHEBUST=1

# Copy source code
COPY ${SRC_PATH}/src ./src
COPY ${SRC_PATH}/tsconfig.json ./

# Clean any existing build artifacts
RUN rm -rf dist node_modules/.cache .tsbuildinfo

# Generate Prisma client with retry logic
# Note: Flowise schema removed in open source version
ENV PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1
RUN apt-get update && apt-get install -y openssl ca-certificates && \
    for i in 1 2 3; do pnpm prisma generate && break || sleep 5; done

# Build TypeScript (skip prisma generate since we already ran it above)
RUN pnpm tsc

# Production image
FROM node:20-slim

# Install system dependencies including canvas requirements and netcat for health checks
RUN apt-get update && apt-get upgrade -y && \
    apt-get install -y --no-install-recommends \
    curl \
    netcat-openbsd \
    ca-certificates \
    build-essential \
    python3 \
    python3-pip \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    libpixman-1-dev \
    pkg-config \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Install diagram rendering tools: Mermaid CLI and PlantUML
# Mermaid CLI for technical diagrams (flowcharts, sequence, architecture)
# PlantUML for customer-facing diagrams with professional stencils and styling
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    default-jre-headless \
    graphviz \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Set Puppeteer to use installed Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Enable pnpm in production
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

# Path prefix for docker-compose builds
ARG SRC_PATH=.

# Copy package.json for production
COPY ${SRC_PATH}/package.json ./

# Install production dependencies only
RUN pnpm install --production --no-frozen-lockfile

# Copy built code and prisma from builder
# Note: Flowise generated client removed in open source version
COPY --from=api-builder /app/dist ./dist
COPY --from=api-builder /app/node_modules ./node_modules
COPY ${SRC_PATH}/prisma ./prisma

# Copy entrypoint script
COPY ${SRC_PATH}/docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Create uploads and logs directories
RUN mkdir -p uploads logs

EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:8000/api/health || exit 1

# Use entrypoint script
ENTRYPOINT ["./docker-entrypoint.sh"]