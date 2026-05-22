import { useState } from 'react';
import { X } from 'lucide-react';

interface Props {
  onClose: () => void;
  onCreate: (provider: string, model?: string) => Promise<void>;
}

const PROVIDERS = [
  {
    id: 'ANTHROPIC',
    label: 'Anthropic',
    models: ['claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001', 'claude-opus-4-20250514'],
    color: '#d4713a',
  },
  {
    id: 'OPENAI',
    label: 'OpenAI',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo'],
    color: '#10a37f',
  },
  {
    id: 'GEMINI',
    label: 'Google Gemini',
    models: ['gemini-1.5-flash', 'gemini-1.5-pro'],
    color: '#4285f4',
  },
];

export function NewConversationModal({ onClose, onCreate }: Props) {
  const [provider, setProvider] = useState('ANTHROPIC');
  const [model, setModel] = useState(PROVIDERS[0].models[0]);
  const [loading, setLoading] = useState(false);

  const selectedProvider = PROVIDERS.find(p => p.id === provider)!;

  const handleProviderChange = (id: string) => {
    const p = PROVIDERS.find(x => x.id === id)!;
    setProvider(id);
    setModel(p.models[0]);
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await onCreate(provider, model);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>New Conversation</h2>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="modal-body">
          <label className="field-label">Provider</label>
          <div className="provider-grid">
            {PROVIDERS.map(p => (
              <button
                key={p.id}
                className={`provider-card ${provider === p.id ? 'selected' : ''}`}
                style={{ '--accent': p.color } as React.CSSProperties}
                onClick={() => handleProviderChange(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>

          <label className="field-label" style={{ marginTop: '1.25rem' }}>Model</label>
          <select
            className="select"
            value={model}
            onChange={e => setModel(e.target.value)}
          >
            {selectedProvider.models.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Creating…' : 'Start Chat'}
          </button>
        </div>
      </div>
    </div>
  );
}
