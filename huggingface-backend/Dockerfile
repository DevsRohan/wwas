# ============================================================
# WhatsApp CRM Engine — Hugging Face Spaces
# ============================================================
FROM node:18-slim

ENV DEBIAN_FRONTEND=noninteractive

# Install System Chromium via apt-get
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        chromium \
        ca-certificates \
        fonts-liberation \
        wget \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production

WORKDIR /app
RUN mkdir -p /app/wa_session /app/logs /app/tmp

COPY package*.json ./

RUN npm install --omit=dev && npm cache clean --force

COPY . .

RUN chown -R node:node /app
USER node

EXPOSE 7860
CMD ["node", "server.js"]
