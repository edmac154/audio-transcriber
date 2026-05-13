const fs = require('fs');
const path = require('path');

function parseWhisperJson(jsonPath) {
  const raw = fs.readFileSync(jsonPath, 'utf-8');
  const data = JSON.parse(raw);

  const segments = (data.transcription || []).map(seg => ({
    start: seg.offsets?.from ?? seg.timestamps?.from ?? 0,
    end: seg.offsets?.to ?? seg.timestamps?.to ?? 0,
    text: (seg.text || '').trim()
  }));

  return {
    language: data.result?.language || 'unknown',
    segments,
    fullText: segments.map(s => s.text).join(' ')
  };
}

function parseWhisperTxt(txtPath) {
  const raw = fs.readFileSync(txtPath, 'utf-8');
  return raw.trim();
}

function parseWhisperStderr(line) {
  const result = {
    type: 'unknown',
    data: null
  };

  const progressMatch = line.match(/whisper_full_with_state:.*progress\s*=\s*(\d+)%/);
  if (progressMatch) {
    result.type = 'progress';
    result.data = { percent: parseInt(progressMatch[1], 10) };
    return result;
  }

  const timeMatch = line.match(/\[\s*(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})\s*\]\s*(.*)/);
  if (timeMatch) {
    result.type = 'segment';
    result.data = {
      from: timeMatch[1],
      to: timeMatch[2],
      text: timeMatch[3].trim()
    };
    return result;
  }

  const modelMatch = line.match(/whisper_model_load|whisper_init_from_file/);
  if (modelMatch) {
    result.type = 'loading';
    result.data = { message: 'Loading model...' };
    return result;
  }

  const systemMatch = line.match(/system_info/);
  if (systemMatch) {
    result.type = 'system';
    result.data = { message: line.trim() };
    return result;
  }

  return result;
}

function formatTimestamp(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function timestampToMs(timestamp) {
  const parts = timestamp.split(':');
  if (parts.length === 3) {
    const [h, m, rest] = parts;
    const [s, ms] = rest.split('.');
    return (parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s)) * 1000 + parseInt(ms || 0);
  }
  if (parts.length === 2) {
    const [m, rest] = parts;
    const [s, ms] = rest.split('.');
    return (parseInt(m) * 60 + parseInt(s)) * 1000 + parseInt(ms || 0);
  }
  return 0;
}

module.exports = {
  parseWhisperJson,
  parseWhisperTxt,
  parseWhisperStderr,
  formatTimestamp,
  timestampToMs
};
