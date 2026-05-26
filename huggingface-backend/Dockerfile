# ============================================================
# WWAS WhatsApp Engine - Hugging Face Spaces Dockerfile
# Node.js 20 on Debian Bookworm + Chromium for whatsapp-web.js
#
# FIX: node:20-slim uses Debian Bookworm where:
#   - libxss1 does NOT exist (removed in Bookworm)
#   - chromium-driver is NOT a separate package
#   - libx11-xcb1 replaces some xcb deps
# Solution: use node:20-bookworm-slim explicitly and remove
#   packages that don't exist in Bookworm.
# ============================================================

FROM node:20-bookworm-slim

# Install Chromium and all required system dependencies
# NOTE: libxss1 is NOT available in Debian Bookworm — it was removed.
# chromium already pulls in all required X11/xcb libs on Bookworm.
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libxtst6 \
    wget \
    ca-certificates \
    gnupg \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer / whatsapp-web.js to use the system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Create app directory
WORKDIR /app

# Copy package files first (separate layer = better cache on HF)
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy all application source files
COPY . .

# Create session and logs directories
# These are ephemeral on HF free tier — lost on restart.
# On paid HF tier, mount persistent storage to /app/wa_session.
RUN mkdir -p /app/wa_session /app/logs \
    && chmod 755 /app/wa_session /app/logs

# Hugging Face Spaces binds to port 7860
EXPOSE 7860

# Docker health check (used by HF to determine if Space is running)
HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost:7860/health || exit 1

# Start the Node.js server
CMD ["node", "server.js"]
