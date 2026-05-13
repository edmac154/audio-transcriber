# Final Architecture

Clients
 ├── Web
 ├── Mobile
 ├── Desktop
 └── SDK

 ↓

Realtime Gateway

 ↓

Backend API

 ↓

BullMQ Queues

 ↓

DSP Workers
 ├── Whisper
 ├── Demucs
 └── MIDI

 ↓

Storage Layer

 ↓

Exports
