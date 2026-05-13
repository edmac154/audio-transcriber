const { Queue } = require('bullmq');
const { v4: uuid } = require('uuid');
const Redis = require('ioredis');

const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null
});

const transcriptQueue = new Queue('transcript', { connection });
const demucsQueue = new Queue('demucs', { connection });
const midiQueue = new Queue('midi', { connection });

const jobs = new Map();

function createJob(fileInfo) {
  const jobId = uuid();
  const job = {
    id: jobId,
    status: 'pending',
    filename: fileInfo.filename,
    originalName: fileInfo.originalName,
    filePath: fileInfo.filePath,
    createdAt: Date.now(),
    progress: 0,
    stages: {},
    results: {}
  };
  jobs.set(jobId, job);
  return job;
}

function getJob(jobId) {
  return jobs.get(jobId) || null;
}

function updateJob(jobId, updates) {
  const job = jobs.get(jobId);
  if (!job) return null;
  Object.assign(job, updates);
  jobs.set(jobId, job);
  return job;
}

function getAllJobs() {
  return Array.from(jobs.values()).sort((a, b) => b.createdAt - a.createdAt);
}

async function enqueueTranscript(jobId, filePath, options = {}) {
  const bullJob = await transcriptQueue.add('transcribe', {
    jobId,
    filePath,
    language: options.language || 'auto',
    threads: options.threads || 4
  }, {
    jobId,
    removeOnComplete: false,
    removeOnFail: false
  });
  return bullJob;
}

async function enqueueDemucs(jobId, filePath) {
  const bullJob = await demucsQueue.add('separate', {
    jobId,
    filePath
  }, {
    jobId,
    removeOnComplete: false,
    removeOnFail: false
  });
  return bullJob;
}

async function enqueueMidi(jobId, filePath) {
  const bullJob = await midiQueue.add('extract', {
    jobId,
    filePath
  }, {
    jobId,
    removeOnComplete: false,
    removeOnFail: false
  });
  return bullJob;
}

module.exports = {
  createJob,
  getJob,
  updateJob,
  getAllJobs,
  enqueueTranscript,
  enqueueDemucs,
  enqueueMidi,
  transcriptQueue,
  demucsQueue,
  midiQueue
};
