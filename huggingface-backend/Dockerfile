# ============================================================
# WWAS WhatsApp Engine - Hugging Face Spaces Dockerfile
# Uses Node.js 20 + Chromium for Puppeteer/whatsapp-web.js
# ============================================================

FROM node:20-slim

# Install Chromium and required system dependencies for Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-driver \
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
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libxss1 \
    libxtst6 \
    wget \
    ca-certificates \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set Puppeteer to use installed Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Create app directory
WORKDIR /app

# Copy package files first for layer caching
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy application source
COPY . .

# Create session directory (ephemeral but needed at runtime)
RUN mkdir -p /app/wa_session && chmod 755 /app/wa_session

# Create logs directory
RUN mkdir -p /app/logs && chmod 755 /app/logs

# Hugging Face Spaces uses port 7860
EXPOSE 7860

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost:7860/health || exit 1

# Start the server
CMD ["node", "server.js"]
