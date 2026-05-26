# ============================================================
# WWAS WhatsApp Engine - Hugging Face Spaces
# Base: node:20-bullseye-slim (Debian 11)
# ============================================================

FROM node:20-bullseye-slim

# Install Chromium and dependencies (all confirmed on Bullseye)
RUN apt-get update && apt-get install -y \
    ca-certificates \
    wget \
    fonts-liberation \
    fonts-noto-color-emoji \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    chromium \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Puppeteer: use system chromium, skip bundled download
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# HF Spaces runs as non-root user — create working dirs first
WORKDIR /app

# Create required directories with proper permissions BEFORE copying files
RUN mkdir -p /app/logs /app/wa_session \
    && chmod 777 /app/logs /app/wa_session

# Copy and install dependencies
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Copy application source
COPY . .

# HF Spaces uses port 7860
EXPOSE 7860

# Health check - longer start period for Chromium init
HEALTHCHECK --interval=30s --timeout=15s --start-period=120s --retries=5 \
    CMD wget --quiet --tries=1 --spider http://localhost:7860/health || exit 1

CMD ["node", "server.js"]
