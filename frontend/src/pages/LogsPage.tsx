import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { api, InferenceLog } from '../lib/api';

export function LogsPage() {
  const [logs, setLogs] = useState<InferenceLog[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.analytics.logs(page, 50).then(data => {
      setLogs(data.logs);
      setPages(data.pages);
      setTotal(data.total);
    }).finally(() => setLoading(false));
  }, [page]);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Inference Logs</h1>
        <span className="count-badge">{total.toLocaleString()} records</span>
      </div>

      {loading ? (
        <div className="page-loading">Loading logs…</div>
      ) : (
        <>
          <div className="chart-card logs-table-card" style={{ marginTop: 0 }}>
            <div className="table-scroll">
              <table className="logs-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Conversation</th>
                    <th>Provider</th>
                    <th>Model</th>
                    <th>Status</th>
                    <th>Latency</th>
                    <th>In Tokens</th>
                    <th>Out Tokens</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map(log => (
                    <tr key={log.id}>
                      <td className="text-muted text-sm">
                        {new Date(log.requestedAt).toLocaleString()}
                      </td>
                      <td className="text-sm text-muted" title={log.conversationId}>
                        {log.conversation?.title?.slice(0, 24) || log.conversationId.slice(0, 8) + '…'}
                      </td>
                      <td><span className="provider-tag">{log.provider}</span></td>
                      <td className="text-muted text-sm">{log.model}</td>
                      <td>
                        <span className={`status-pill status-${log.status.toLowerCase()}`}>
                          {log.status}
                        </span>
                      </td>
                      <td className="text-muted">{log.latencyMs != null ? `${log.latencyMs}ms` : '—'}</td>
                      <td className="text-muted">{log.inputTokens?.toLocaleString() ?? '—'}</td>
                      <td className="text-muted">{log.outputTokens?.toLocaleString() ?? '—'}</td>
                      <td className="text-sm" style={{ color: '#ef4444' }}>
                        {log.errorCode || ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="pagination">
            <button
              className="icon-btn"
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
            >
              <ChevronLeft size={16} />
            </button>
            <span>Page {page} of {pages}</span>
            <button
              className="icon-btn"
              disabled={page >= pages}
              onClick={() => setPage(p => p + 1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
