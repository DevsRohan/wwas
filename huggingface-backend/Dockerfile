# ============================================================
# WWAS WhatsApp Engine - Hugging Face Spaces Dockerfile
# Node.js 20 on Debian Bullseye (11) + Chromium for whatsapp-web.js
#
# WHY BULLSEYE not BOOKWORM:
#   Debian Bookworm removed several packages that Chromium/Puppeteer
#   depends on (libxss1, etc). Bullseye has a stable, complete set
#   of all required X11 and media libraries.
#   node:20-bullseye is the proven working base for whatsapp-web.js.
# ============================================================

FROM node:20-bullseye-slim

# Install Chromium and all required system dependencies for Puppeteer
# All packages below exist on Debian Bullseye (confirmed).
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

# Tell Puppeteer / whatsapp-web.js to use the system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Create app directory
WORKDIR /app

# Copy package files first (better Docker layer caching)
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production

# Copy all application source files
COPY . .

# Create session and logs directories
# NOTE: On HF free tier these are ephemeral (lost on restart).
# On paid HF tier with persistent storage, mount to /app/wa_session.
RUN mkdir -p /app/wa_session /app/logs \
    && chmod 755 /app/wa_session /app/logs

# Hugging Face Spaces binds to port 7860
EXPOSE 7860

# Docker health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost:7860/health || exit 1

# Start the Node.js server
CMD ["node", "server.js"]
