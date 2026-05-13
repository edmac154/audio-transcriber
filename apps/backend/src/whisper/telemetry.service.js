class TelemetryService {
  constructor(jobId) {
    this.jobId = jobId;
    this.startTime = Date.now();
    this.lastProgressTime = Date.now();
    this.lastPercent = 0;
    this.segmentCount = 0;
    this.stage = 'initializing';
    this.listeners = new Map();
  }

  addListener(id, callback) {
    this.listeners.set(id, callback);
  }

  removeListener(id) {
    this.listeners.delete(id);
  }

  updateProgress(percent) {
    const now = Date.now();
    const elapsed = now - this.startTime;
    const delta = percent - this.lastPercent;

    let eta = null;
    if (percent > 0 && delta > 0) {
      const rate = elapsed / percent;
      const remaining = rate * (100 - percent);
      eta = Math.round(remaining / 1000);
    }

    this.lastPercent = percent;
    this.lastProgressTime = now;

    const payload = {
      jobId: this.jobId,
      type: 'progress',
      progress: percent,
      eta: eta !== null ? this.formatEta(eta) : '--',
      etaSeconds: eta,
      elapsed: Math.round(elapsed / 1000),
      segmentCount: this.segmentCount,
      stage: this.stage,
      timestamp: now
    };

    this.broadcast(payload);
    return payload;
  }

  updateStage(stage) {
    this.stage = stage;
    this.broadcast({
      jobId: this.jobId,
      type: 'stage',
      stage,
      timestamp: Date.now()
    });
  }

  addSegment() {
    this.segmentCount++;
    this.broadcast({
      jobId: this.jobId,
      type: 'segment',
      segmentCount: this.segmentCount,
      timestamp: Date.now()
    });
  }

  complete(result) {
    const elapsed = Date.now() - this.startTime;
    const payload = {
      jobId: this.jobId,
      type: 'complete',
      progress: 100,
      eta: '00:00',
      elapsed: Math.round(elapsed / 1000),
      segmentCount: this.segmentCount,
      stage: 'completed',
      result,
      timestamp: Date.now()
    };
    this.broadcast(payload);
    return payload;
  }

  error(message) {
    this.broadcast({
      jobId: this.jobId,
      type: 'error',
      error: message,
      stage: 'failed',
      timestamp: Date.now()
    });
  }

  broadcast(payload) {
    for (const callback of this.listeners.values()) {
      try {
        callback(payload);
      } catch (_) {}
    }
  }

  formatEta(seconds) {
    if (seconds <= 0) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
}

const activeTelemetry = new Map();

function createTelemetry(jobId) {
  const t = new TelemetryService(jobId);
  activeTelemetry.set(jobId, t);
  return t;
}

function getTelemetry(jobId) {
  return activeTelemetry.get(jobId) || null;
}

function removeTelemetry(jobId) {
  activeTelemetry.delete(jobId);
}

module.exports = {
  TelemetryService,
  createTelemetry,
  getTelemetry,
  removeTelemetry
};
