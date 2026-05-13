FROM node:20

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    git \
  && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/demucs-env \
  && /opt/demucs-env/bin/pip install --no-cache-dir --upgrade pip \
  && /opt/demucs-env/bin/pip install --no-cache-dir demucs

ENV PATH="/opt/demucs-env/bin:$PATH"

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN mkdir -p /app/storage/stems /app/storage/exports

ENV STORAGE_BASE=/app/storage

CMD ["npm", "start"]
