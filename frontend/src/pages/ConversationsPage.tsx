import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, XCircle, Trash2, Play, Clock } from 'lucide-react';
import { api, Conversation } from '../lib/api';

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: '#22c55e',
  CANCELLED: '#ef4444',
  COMPLETED: '#6b7280',
};

const PROVIDER_LABELS: Record<string, string> = {
  ANTHROPIC: 'Anthropic',
  OPENAI: 'OpenAI',
  GEMINI: 'Gemini',
};

export function ConversationsPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const load = async () => {
    try {
      const data = await api.conversations.list();
      setConversations(data.conversations);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCancel = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await api.conversations.cancel(id);
    setConversations(prev =>
      prev.map(c => c.id === id ? { ...c, status: 'CANCELLED' } : c)
    );
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm('Delete this conversation?')) return;
    await api.conversations.delete(id);
    setConversations(prev => prev.filter(c => c.id !== id));
  };

  const handleResume = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    navigate(`/chat/${id}`);
  };

  if (loading) return <div className="page-loading">Loading conversations…</div>;
  if (error) return <div className="page-error">{error}</div>;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Conversations</h1>
        <span className="count-badge">{conversations.length} total</span>
      </div>

      {conversations.length === 0 ? (
        <div className="empty-state">
          <MessageSquare size={48} opacity={0.2} />
          <p>No conversations yet. Start one using "New Chat".</p>
        </div>
      ) : (
        <div className="conversation-list">
          {conversations.map(conv => (
            <div
              key={conv.id}
              className="conversation-card"
              onClick={() => navigate(`/chat/${conv.id}`)}
            >
              <div className="conv-card-main">
                <div className="conv-card-title">
                  {conv.title || 'Untitled conversation'}
                </div>
                <div className="conv-card-meta">
                  <span className="provider-tag">{PROVIDER_LABELS[conv.provider]}</span>
                  <span className="model-tag">{conv.model}</span>
                  <span className="msg-count">
                    <MessageSquare size={12} />
                    {conv._count?.messages ?? 0} messages
                  </span>
                  <span className="timestamp">
                    <Clock size={12} />
                    {new Date(conv.updatedAt).toLocaleDateString()}
                  </span>
                </div>
              </div>

              <div className="conv-card-actions">
                <span
                  className="status-dot"
                  style={{ background: STATUS_COLORS[conv.status] }}
                  title={conv.status}
                />
                {conv.status === 'ACTIVE' && (
                  <>
                    <button
                      className="icon-btn icon-btn-sm"
                      title="Resume"
                      onClick={e => handleResume(e, conv.id)}
                    >
                      <Play size={14} />
                    </button>
                    <button
                      className="icon-btn icon-btn-sm danger"
                      title="Cancel"
                      onClick={e => handleCancel(e, conv.id)}
                    >
                      <XCircle size={14} />
                    </button>
                  </>
                )}
                <button
                  className="icon-btn icon-btn-sm danger"
                  title="Delete"
                  onClick={e => handleDelete(e, conv.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
