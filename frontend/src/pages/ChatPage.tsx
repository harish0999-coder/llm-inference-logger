import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Send, XCircle, ArrowLeft, Zap, Clock } from 'lucide-react';
import { api, Conversation, Message, streamChat } from '../lib/api';

export function ChatPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState('');
  const [lastLatency, setLastLatency] = useState<number | null>(null);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!conversationId) return;
    api.conversations.get(conversationId).then(({ conversation: c }) => {
      setConversation(c);
      setMessages(c.messages || []);
    }).catch(() => navigate('/conversations'));
  }, [conversationId, navigate]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamBuffer]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || streaming || !conversationId) return;
    if (conversation?.status === 'CANCELLED') return;

    const userText = input.trim();
    setInput('');
    setError('');
    setStreaming(true);
    setStreamBuffer('');

    // Optimistically add user message
    const tempUserMsg: Message = {
      id: `temp-${Date.now()}`,
      conversationId: conversationId!,
      role: 'user',
      content: userText,
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, tempUserMsg]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      let assistantContent = '';
      let assistantMsgId = '';

      for await (const chunk of streamChat(conversationId!, userText, controller.signal)) {
        if (chunk.type === 'delta' && chunk.content) {
          assistantContent += chunk.content;
          setStreamBuffer(assistantContent);
        } else if (chunk.type === 'done') {
          assistantMsgId = (chunk as { assistantMessageId?: string }).assistantMessageId || '';
          const inferLog = (chunk as { inferenceLog?: { latencyMs: number } }).inferenceLog;
          if (inferLog) setLastLatency(inferLog.latencyMs);
        } else if (chunk.type === 'error') {
          setError(chunk.error || 'Stream error');
        }
      }

      // Commit streamed message
      if (assistantContent) {
        setMessages(prev => [
          ...prev,
          {
            id: assistantMsgId || `assistant-${Date.now()}`,
            conversationId: conversationId!,
            role: 'assistant',
            content: assistantContent,
            createdAt: new Date().toISOString(),
          },
        ]);
      }
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') {
        setError((e as Error).message || 'Failed to send');
      }
    } finally {
      setStreaming(false);
      setStreamBuffer('');
      abortRef.current = null;
    }
  }, [input, streaming, conversationId, conversation]);

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleCancel = async () => {
    if (!conversation || !confirm('Cancel this conversation?')) return;
    await api.conversations.cancel(conversation.id);
    setConversation(prev => prev ? { ...prev, status: 'CANCELLED' } : prev);
    handleStop();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const isCancelled = conversation?.status === 'CANCELLED';

  return (
    <div className="chat-page">
      {/* Header */}
      <div className="chat-header">
        <button className="icon-btn" onClick={() => navigate('/conversations')}>
          <ArrowLeft size={16} />
        </button>
        <div className="chat-header-info">
          <h2>{conversation?.title || 'New Conversation'}</h2>
          <div className="chat-meta">
            <span className="provider-tag">{conversation?.provider}</span>
            <span className="model-tag">{conversation?.model}</span>
            {isCancelled && <span className="cancelled-tag">Cancelled</span>}
            {lastLatency && (
              <span className="latency-tag">
                <Zap size={10} />
                {lastLatency}ms
              </span>
            )}
          </div>
        </div>
        {!isCancelled && (
          <button className="btn-danger-outline" onClick={handleCancel} title="Cancel conversation">
            <XCircle size={14} />
            Cancel
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="messages-area">
        {messages.length === 0 && !streaming && (
          <div className="chat-empty">
            <p>Start the conversation below</p>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} className={`message message-${msg.role}`}>
            <div className="message-bubble">
              <pre className="message-text">{msg.content}</pre>
            </div>
            <div className="message-time">
              <Clock size={10} />
              {new Date(msg.createdAt).toLocaleTimeString()}
            </div>
          </div>
        ))}

        {streaming && streamBuffer && (
          <div className="message message-assistant">
            <div className="message-bubble streaming">
              <pre className="message-text">{streamBuffer}</pre>
              <span className="cursor-blink" />
            </div>
          </div>
        )}

        {error && (
          <div className="error-banner">{error}</div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="chat-input-area">
        {isCancelled ? (
          <div className="cancelled-notice">
            This conversation has been cancelled.
          </div>
        ) : (
          <div className="chat-input-row">
            <textarea
              ref={textareaRef}
              className="chat-textarea"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
              rows={1}
              disabled={streaming || isCancelled}
            />
            {streaming ? (
              <button className="send-btn stop-btn" onClick={handleStop}>
                <XCircle size={18} />
              </button>
            ) : (
              <button
                className="send-btn"
                onClick={handleSend}
                disabled={!input.trim()}
              >
                <Send size={18} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
