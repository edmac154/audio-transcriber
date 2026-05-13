FROM node:20

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN mkdir -p /app/storage/uploads \
    /app/storage/normalized \
    /app/storage/transcripts \
    /app/storage/exports \
    /app/storage/waveforms \
    /app/storage/stems

ENV STORAGE_BASE=/app/storage

EXPOSE 4000

CMD ["npm", "run", "dev"]
