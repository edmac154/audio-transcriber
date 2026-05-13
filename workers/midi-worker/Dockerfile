FROM node:20

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
  && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/midi-env \
  && /opt/midi-env/bin/pip install --no-cache-dir --upgrade pip \
  && /opt/midi-env/bin/pip install --no-cache-dir basic-pitch

ENV PATH="/opt/midi-env/bin:$PATH"

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN mkdir -p /app/storage/midi /app/storage/exports

ENV STORAGE_BASE=/app/storage

CMD ["npm", "start"]
