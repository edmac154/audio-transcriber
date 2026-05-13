'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

const STAGES = {
  idle: { label: 'Listo para procesar', color: '#666' },
  uploading: { label: 'Subiendo archivo...', color: '#3b82f6' },
  queued: { label: 'En cola...', color: '#f59e0b' },
  normalizing: { label: 'Normalizando audio...', color: '#8b5cf6' },
  transcribing: { label: 'Transcribiendo con Whisper...', color: '#22c55e' },
  separating_stems: { label: 'Separando stems con Demucs...', color: '#ec4899' },
  extracting_midi: { label: 'Extrayendo MIDI...', color: '#f97316' },
  generating_docx: { label: 'Generando DOCX...', color: '#06b6d4' },
  finalizing: { label: 'Finalizando...', color: '#22c55e' },
  completed: { label: 'Procesamiento completado', color: '#22c55e' },
  failed: { label: 'Error en el procesamiento', color: '#ef4444' }
};

export default function Home() {
  const [jobId, setJobId] = useState(null);
  const [stage, setStage] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [eta, setEta] = useState('--');
  const [elapsed, setElapsed] = useState(0);
  const [segmentCount, setSegmentCount] = useState(0);
  const [error, setError] = useState(null);
  const [metadata, setMetadata] = useState(null);
  const [exports, setExports] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [lastSegmentText, setLastSegmentText] = useState('');
  const [backendStatus, setBackendStatus] = useState('checking');

  const eventSourceRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    fetch(`${API}/health`, { signal: AbortSignal.timeout(5000) })
      .then(res => res.json())
      .then(data => {
        if (data.status === 'ok') setBackendStatus('online');
        else setBackendStatus('offline');
      })
      .catch(() => setBackendStatus('offline'));
  }, []);

  const connectSSE = useCallback((id) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource(`${API}/api/sse/${id}`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'progress') {
          setProgress(data.progress || 0);
          if (data.eta !== undefined) {
            setEta(typeof data.eta === 'number' ? formatEta(data.eta) : data.eta);
          }
          if (data.elapsed) setElapsed(data.elapsed);
          if (data.segmentCount) setSegmentCount(data.segmentCount);
          if (data.stage) setStage(data.stage);
        }

        if (data.type === 'stage') {
          setStage(data.stage);
        }

        if (data.type === 'segment') {
          setSegmentCount(data.segmentCount || 0);
          if (data.text) setLastSegmentText(data.text);
        }

        if (data.type === 'complete') {
          setProgress(100);
          setStage('completed');
          setEta('00:00');
          if (data.elapsed) setElapsed(data.elapsed);
          if (data.segmentCount) setSegmentCount(data.segmentCount);
          fetchExports(id);
        }

        if (data.type === 'error') {
          setStage('failed');
          setError(data.error || 'Unknown error');
        }
      } catch (_) {}
    };

    es.onerror = () => {
      console.warn('SSE connection error');
    };
  }, []);

  function formatEta(seconds) {
    if (!seconds || seconds <= 0) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  async function fetchExports(id) {
    try {
      const res = await fetch(`${API}/api/exports/${id}`);
      const data = await res.json();
      setExports(data.files || []);
    } catch (_) {}
  }

  async function handleUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (backendStatus !== 'online') {
      setError('Backend no disponible. Ejecuta: docker compose -f docker-compose.full.yml up --build');
      setStage('failed');
      return;
    }

    setUploading(true);
    setError(null);
    setStage('uploading');
    setProgress(0);
    setEta('--');
    setElapsed(0);
    setSegmentCount(0);
    setExports([]);
    setLastSegmentText('');

    const formData = new FormData();
    formData.append('audio', file);

    try {
      const res = await fetch(`${API}/api/uploads/audio`, {
        method: 'POST',
        body: formData
      });

      const data = await res.json();

      if (!data.success) {
        setError(data.error || 'Upload failed');
        setStage('failed');
        setUploading(false);
        return;
      }

      setJobId(data.jobId);
      setMetadata(data.metadata || null);
      setStage('queued');
      setUploading(false);

      connectSSE(data.jobId);
    } catch (err) {
      setError('No se pudo conectar al backend. Asegurate de que Docker esté corriendo.');
      setStage('failed');
      setUploading(false);
    }
  }

  async function handleGenerateDocx() {
    if (!jobId) return;
    setStage('generating_docx');

    try {
      const res = await fetch(`${API}/api/jobs/${jobId}/generate-docx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (data.success) {
        setStage('completed');
        fetchExports(jobId);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleBundle() {
    if (!jobId) return;
    try {
      const res = await fetch(`${API}/api/jobs/${jobId}/bundle`, {
        method: 'POST'
      });
      const data = await res.json();
      if (data.success) {
        fetchExports(jobId);
      }
    } catch (_) {}
  }

  function downloadFile(filename) {
    window.open(`${API}/api/exports/${jobId}/download/${filename}`, '_blank');
  }

  const stageInfo = STAGES[stage] || STAGES.idle;
  const progressBarColor = stageInfo.color;

  const progressBlocks = Math.floor(progress / 5);
  const progressBar = '█'.repeat(progressBlocks) + '░'.repeat(20 - progressBlocks);

  return (
    <main style={{
      padding: '40px 40px 80px',
      background: '#0a0a0a',
      color: '#e0e0e0',
      minHeight: '100vh',
      fontFamily: "'Inter', 'SF Pro', -apple-system, sans-serif",
      maxWidth: 900,
      margin: '0 auto'
    }}>
      <div style={{ marginBottom: 40 }}>
        <h1 style={{
          fontSize: 32,
          fontWeight: 700,
          color: '#fff',
          marginBottom: 8
        }}>
          Audio Transcriber
        </h1>
        <p style={{ color: '#888', fontSize: 14 }}>
          Transcripción y procesamiento de audio local — Whisper · Stems · MIDI
        </p>
      </div>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 24,
        padding: '10px 16px',
        background: backendStatus === 'online' ? '#0a1a0a' : backendStatus === 'checking' ? '#1a1a0a' : '#1a0a0a',
        border: `1px solid ${backendStatus === 'online' ? '#22c55e33' : backendStatus === 'checking' ? '#f59e0b33' : '#ef444433'}`,
        borderRadius: 8
      }}>
        <span style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: backendStatus === 'online' ? '#22c55e' : backendStatus === 'checking' ? '#f59e0b' : '#ef4444',
          display: 'inline-block'
        }} />
        <span style={{
          fontSize: 13,
          color: backendStatus === 'online' ? '#22c55e' : backendStatus === 'checking' ? '#f59e0b' : '#ef4444'
        }}>
          {backendStatus === 'online' && 'Backend conectado'}
          {backendStatus === 'checking' && 'Verificando conexión al backend...'}
          {backendStatus === 'offline' && `Backend offline — Ejecuta Docker localmente para procesar audio`}
        </span>
        <span style={{ fontSize: 11, color: '#555', marginLeft: 'auto' }}>
          {API}
        </span>
      </div>

      <div style={{
        background: '#111',
        borderRadius: 12,
        padding: 24,
        marginBottom: 24,
        border: '1px solid #222'
      }}>
        <h2 style={{ fontSize: 16, marginBottom: 16, color: '#ccc' }}>Subir Audio</h2>

        <div
          onClick={() => backendStatus === 'online' ? fileInputRef.current?.click() : null}
          style={{
            border: '2px dashed #333',
            borderRadius: 8,
            padding: '40px 20px',
            textAlign: 'center',
            cursor: backendStatus === 'online' ? 'pointer' : 'not-allowed',
            transition: 'border-color 0.2s',
            opacity: backendStatus === 'online' ? 1 : 0.5
          }}
          onMouseOver={e => backendStatus === 'online' && (e.currentTarget.style.borderColor = '#555')}
          onMouseOut={e => e.currentTarget.style.borderColor = '#333'}
        >
          <p style={{ fontSize: 18, marginBottom: 8 }}>
            {uploading ? 'Subiendo...' : 'Click para seleccionar archivo de audio'}
          </p>
          <p style={{ fontSize: 12, color: '#666' }}>
            MP3, WAV, FLAC, OGG, AAC, M4A — hasta 500MB
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,.mp3,.wav,.flac,.ogg,.aac,.m4a,.wma,.webm"
            onChange={handleUpload}
            style={{ display: 'none' }}
          />
        </div>
      </div>

      {backendStatus === 'offline' && stage === 'idle' && (
        <div style={{
          background: '#111',
          borderRadius: 12,
          padding: 24,
          marginBottom: 24,
          border: '1px solid #222'
        }}>
          <h2 style={{ fontSize: 16, marginBottom: 12, color: '#ccc' }}>Para comenzar</h2>
          <p style={{ fontSize: 13, color: '#888', marginBottom: 12 }}>
            El backend necesita Docker para ejecutar whisper-cli, demucs y basic-pitch localmente.
          </p>
          <pre style={{
            background: '#0a0a0a',
            padding: 16,
            borderRadius: 8,
            fontSize: 13,
            color: '#22c55e',
            overflowX: 'auto'
          }}>
{`git clone https://github.com/edmac154/audio-transcriber.git
cd audio-transcriber
docker compose -f docker-compose.full.yml up --build`}
          </pre>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 12,
            marginTop: 16
          }}>
            <FeatureCard title="Transcripción" desc="Whisper.cpp local con timestamps" icon="T" color="#22c55e" />
            <FeatureCard title="Stem Separation" desc="Demucs: vocals, drums, bass, other" icon="S" color="#ec4899" />
            <FeatureCard title="MIDI Export" desc="Basic-pitch melody extraction" icon="M" color="#f97316" />
            <FeatureCard title="DOCX Export" desc="Documento con timestamps formateados" icon="D" color="#3b82f6" />
          </div>
        </div>
      )}

      {stage !== 'idle' && (
        <div style={{
          background: '#111',
          borderRadius: 12,
          padding: 24,
          marginBottom: 24,
          border: '1px solid #222'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ color: stageInfo.color, fontWeight: 600, fontSize: 14 }}>
              {stageInfo.label}
            </span>
            <span style={{ color: '#888', fontSize: 14 }}>
              {progress}%
            </span>
          </div>

          <div style={{
            width: '100%',
            height: 8,
            background: '#222',
            borderRadius: 4,
            overflow: 'hidden',
            marginBottom: 12
          }}>
            <div style={{
              width: `${progress}%`,
              height: '100%',
              background: `linear-gradient(90deg, ${progressBarColor}, ${progressBarColor}dd)`,
              borderRadius: 4,
              transition: 'width 0.3s ease'
            }} />
          </div>

          <pre style={{
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontSize: 14,
            color: progressBarColor,
            marginBottom: 12,
            letterSpacing: 1
          }}>
            {progressBar} {progress}%
          </pre>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: 12
          }}>
            <Stat label="ETA restante" value={eta} />
            <Stat label="Tiempo transcurrido" value={formatEta(elapsed)} />
            <Stat label="Segmentos" value={segmentCount} />
          </div>

          {lastSegmentText && stage === 'transcribing' && (
            <div style={{
              marginTop: 12,
              padding: '8px 12px',
              background: '#1a1a1a',
              borderRadius: 6,
              fontSize: 13,
              color: '#aaa',
              fontStyle: 'italic'
            }}>
              Último segmento: &quot;{lastSegmentText}&quot;
            </div>
          )}
        </div>
      )}

      {error && (
        <div style={{
          background: '#1a0000',
          border: '1px solid #ef4444',
          borderRadius: 12,
          padding: 16,
          marginBottom: 24,
          color: '#ef4444',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span><strong>Error:</strong> {error}</span>
          <button
            onClick={() => { setError(null); setStage('idle'); }}
            style={{
              background: 'transparent',
              border: '1px solid #ef4444',
              color: '#ef4444',
              borderRadius: 6,
              padding: '4px 12px',
              cursor: 'pointer',
              fontSize: 12
            }}
          >
            Cerrar
          </button>
        </div>
      )}

      {metadata && (
        <div style={{
          background: '#111',
          borderRadius: 12,
          padding: 24,
          marginBottom: 24,
          border: '1px solid #222'
        }}>
          <h2 style={{ fontSize: 16, marginBottom: 16, color: '#ccc' }}>Metadata del Audio</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            <Stat label="Duración" value={metadata.duration ? `${Math.round(parseFloat(metadata.duration))}s` : '--'} />
            <Stat label="Bitrate" value={metadata.bit_rate ? `${Math.round(metadata.bit_rate / 1000)}kbps` : '--'} />
            <Stat label="Formato" value={metadata.format_name || '--'} />
            <Stat label="Tamaño" value={metadata.size ? `${(metadata.size / 1024 / 1024).toFixed(1)}MB` : '--'} />
          </div>
        </div>
      )}

      {stage === 'completed' && (
        <div style={{
          background: '#0a1a0a',
          border: '1px solid #22c55e',
          borderRadius: 12,
          padding: 24,
          marginBottom: 24
        }}>
          <h2 style={{ fontSize: 18, color: '#22c55e', marginBottom: 16 }}>
            &#10004; Procesamiento Completado
          </h2>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <ActionButton label="Generar DOCX" onClick={handleGenerateDocx} color="#3b82f6" />
            <ActionButton label="Crear ZIP Bundle" onClick={handleBundle} color="#8b5cf6" />
          </div>

          {exports.length > 0 && (
            <div>
              <h3 style={{ fontSize: 14, color: '#888', marginBottom: 12 }}>Archivos Exportados</h3>
              {exports.map((file, i) => (
                <div key={i} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '10px 12px',
                  background: '#111',
                  borderRadius: 8,
                  marginBottom: 6,
                  border: '1px solid #222'
                }}>
                  <div>
                    <span style={{ color: '#e0e0e0', fontSize: 14 }}>{file.name}</span>
                    <span style={{ color: '#666', fontSize: 12, marginLeft: 8 }}>
                      {(file.size / 1024).toFixed(1)}KB
                    </span>
                  </div>
                  <button
                    onClick={() => downloadFile(file.name)}
                    style={{
                      background: '#22c55e',
                      color: '#000',
                      border: 'none',
                      borderRadius: 6,
                      padding: '6px 16px',
                      cursor: 'pointer',
                      fontSize: 13,
                      fontWeight: 600
                    }}
                  >
                    Download
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </main>
  );
}

function Stat({ label, value }) {
  return (
    <div style={{
      background: '#1a1a1a',
      borderRadius: 8,
      padding: '10px 14px'
    }}>
      <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 16, color: '#fff', fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function ActionButton({ label, onClick, color }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: color,
        color: '#fff',
        border: 'none',
        borderRadius: 8,
        padding: '10px 20px',
        cursor: 'pointer',
        fontSize: 14,
        fontWeight: 600,
        transition: 'opacity 0.2s'
      }}
      onMouseOver={e => e.currentTarget.style.opacity = '0.8'}
      onMouseOut={e => e.currentTarget.style.opacity = '1'}
    >
      {label}
    </button>
  );
}

function FeatureCard({ title, desc, icon, color }) {
  return (
    <div style={{
      background: '#0a0a0a',
      borderRadius: 8,
      padding: 16,
      border: '1px solid #222'
    }}>
      <div style={{
        width: 32,
        height: 32,
        borderRadius: 6,
        background: `${color}22`,
        color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: 14,
        marginBottom: 8
      }}>
        {icon}
      </div>
      <div style={{ fontSize: 14, color: '#e0e0e0', fontWeight: 600, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 12, color: '#666' }}>{desc}</div>
    </div>
  );
}
