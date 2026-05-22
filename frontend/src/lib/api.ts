const BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

export interface Conversation {
  id: string;
  title: string | null;
  provider: 'ANTHROPIC' | 'OPENAI' | 'GEMINI';
  model: string;
  status: 'ACTIVE' | 'CANCELLED' | 'COMPLETED';
  createdAt: string;
  updatedAt: string;
  _count?: { messages: number };
  messages?: Message[];
}

export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface InferenceLog {
  id: string;
  conversationId: string;
  provider: string;
  model: string;
  status: string;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  requestedAt: string;
  errorCode: string | null;
  conversation?: { id: string; title: string | null; status: string };
}

export interface AnalyticsOverview {
  overview: {
    totalConversations: number;
    totalMessages: number;
    totalInferenceCalls: number;
    avgLatencyMs: number;
    errorCount: number;
    errorRate: number;
    totalTokensUsed: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  };
  providerBreakdown: Array<{ provider: string; count: number; avgLatencyMs: number }>;
  recentLogs: InferenceLog[];
  latencyBuckets: Array<{ bucket: string; count: number }>;
}

// ── Conversations ──────────────────────────────────────────────────────────

export const api = {
  conversations: {
    list: () => req<{ conversations: Conversation[] }>('/conversations'),
    get: (id: string) => req<{ conversation: Conversation }>(`/conversations/${id}`),
    create: (body: { provider: string; model?: string; title?: string }) =>
      req<{ conversation: Conversation }>('/conversations', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    cancel: (id: string) =>
      req<{ conversation: Conversation }>(`/conversations/${id}/cancel`, { method: 'PATCH' }),
    delete: (id: string) =>
      req<{ success: boolean }>(`/conversations/${id}`, { method: 'DELETE' }),
  },
  analytics: {
    overview: () => req<AnalyticsOverview>('/analytics/overview'),
    timeseries: (hours = 24) =>
      req<{ timeseries: Array<{ hour: string; count: number; avgLatencyMs: number | null; errorCount: number }> }>(
        `/analytics/timeseries?hours=${hours}`
      ),
    logs: (page = 1, limit = 50) =>
      req<{ logs: InferenceLog[]; total: number; pages: number }>(`/analytics/logs?page=${page}&limit=${limit}`),
  },
};

// ── Streaming Chat ─────────────────────────────────────────────────────────

export async function* streamChat(
  conversationId: string,
  message: string,
  signal?: AbortSignal
): AsyncGenerator<{ type: string; content?: string; error?: string; inferenceLog?: object }> {
  const res = await fetch(`${BASE}/chat/${conversationId}/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
    signal,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Stream failed');
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          yield JSON.parse(line.slice(6));
        } catch { /* skip */ }
      }
    }
  }
}
