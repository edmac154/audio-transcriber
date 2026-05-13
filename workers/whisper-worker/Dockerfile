FROM ubuntu:22.04 AS whisper-build

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    git \
    wget \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN git clone https://github.com/ggerganov/whisper.cpp.git /whisper.cpp \
  && cd /whisper.cpp \
  && cmake -B build \
  && cmake --build build --config Release -j$(nproc)

RUN mkdir -p /models && \
    cd /whisper.cpp && \
    bash models/download-ggml-model.sh base

FROM node:20

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY --from=whisper-build /whisper.cpp/build/bin/whisper-cli /usr/local/bin/whisper-cli
COPY --from=whisper-build /whisper.cpp/models/ggml-base.bin /app/models/ggml-base.bin

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN mkdir -p /app/storage/normalized /app/storage/transcripts

ENV WHISPER_BIN=whisper-cli
ENV WHISPER_MODEL=/app/models/ggml-base.bin
ENV STORAGE_BASE=/app/storage

CMD ["npm", "start"]
