import { useEffect, useState } from 'react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend
} from 'recharts';
import { Zap, MessageSquare, AlertTriangle, Clock, Activity, Database } from 'lucide-react';
import { api, AnalyticsOverview } from '../lib/api';

const PROVIDER_COLORS: Record<string, string> = {
  ANTHROPIC: '#d4713a',
  OPENAI: '#10a37f',
  GEMINI: '#4285f4',
};

function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="stat-card">
      <div className="stat-icon" style={{ color: color || 'var(--accent)' }}>
        <Icon size={20} />
      </div>
      <div className="stat-body">
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
        {sub && <div className="stat-sub">{sub}</div>}
      </div>
    </div>
  );
}

export function DashboardPage() {
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [timeseries, setTimeseries] = useState<Array<{ hour: string; count: number; avgLatencyMs: number | null; errorCount: number }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.analytics.overview(), api.analytics.timeseries(24)])
      .then(([overview, ts]) => {
        setData(overview);
        setTimeseries(ts.timeseries);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="page-loading">Loading dashboard…</div>;
  if (!data) return <div className="page-error">Failed to load analytics</div>;

  const { overview, providerBreakdown, latencyBuckets } = data;

  const tsData = timeseries.map(row => ({
    ...row,
    hour: new Date(row.hour).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  }));

  return (
    <div className="page dashboard-page">
      <div className="page-header">
        <h1>Dashboard</h1>
        <span className="count-badge">Last 24h</span>
      </div>

      {/* Stat Cards */}
      <div className="stats-grid">
        <StatCard icon={MessageSquare} label="Conversations" value={overview.totalConversations} />
        <StatCard icon={Activity} label="Inference Calls" value={overview.totalInferenceCalls} />
        <StatCard icon={Clock} label="Avg Latency" value={`${overview.avgLatencyMs}ms`} color="#a78bfa" />
        <StatCard
          icon={AlertTriangle}
          label="Error Rate"
          value={`${overview.errorRate}%`}
          sub={`${overview.errorCount} errors`}
          color={overview.errorRate > 5 ? '#ef4444' : '#22c55e'}
        />
        <StatCard icon={Database} label="Total Tokens" value={overview.totalTokensUsed.toLocaleString()} sub={`${overview.totalInputTokens.toLocaleString()} in / ${overview.totalOutputTokens.toLocaleString()} out`} />
        <StatCard icon={Zap} label="Messages" value={overview.totalMessages} />
      </div>

      {/* Throughput + Latency time series */}
      <div className="charts-grid">
        <div className="chart-card">
          <h3>Throughput (requests/hour)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={tsData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="hour" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
              <Tooltip
                contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}
                labelStyle={{ color: 'var(--text)' }}
              />
              <Line type="monotone" dataKey="count" stroke="var(--accent)" strokeWidth={2} dot={false} name="Requests" />
              <Line type="monotone" dataKey="errorCount" stroke="#ef4444" strokeWidth={2} dot={false} name="Errors" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>Avg Latency (ms)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={tsData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="hour" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
              <Tooltip
                contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}
                labelStyle={{ color: 'var(--text)' }}
              />
              <Line type="monotone" dataKey="avgLatencyMs" stroke="#a78bfa" strokeWidth={2} dot={false} name="Latency (ms)" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>Provider Breakdown</h3>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={providerBreakdown}
                cx="50%"
                cy="50%"
                outerRadius={80}
                dataKey="count"
                nameKey="provider"
                label={({ provider, percent }) => `${provider} ${((percent || 0) * 100).toFixed(0)}%`}
              >
                {providerBreakdown.map((entry) => (
                  <Cell key={entry.provider} fill={PROVIDER_COLORS[entry.provider] || '#6b7280'} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}
              />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>Latency Distribution</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={latencyBuckets}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
              <Tooltip
                contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}
              />
              <Bar dataKey="count" fill="var(--accent)" radius={[4, 4, 0, 0]} name="Requests" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent logs table */}
      <div className="chart-card logs-table-card">
        <h3>Recent Inference Logs</h3>
        <div className="table-scroll">
          <table className="logs-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Provider</th>
                <th>Model</th>
                <th>Status</th>
                <th>Latency</th>
                <th>Tokens</th>
              </tr>
            </thead>
            <tbody>
              {data.recentLogs.map(log => (
                <tr key={log.id}>
                  <td className="text-muted">{new Date(log.requestedAt).toLocaleTimeString()}</td>
                  <td><span className="provider-tag">{log.provider}</span></td>
                  <td className="text-muted text-sm">{log.model}</td>
                  <td>
                    <span className={`status-pill status-${log.status.toLowerCase()}`}>
                      {log.status}
                    </span>
                  </td>
                  <td className="text-muted">{log.latencyMs != null ? `${log.latencyMs}ms` : '—'}</td>
                  <td className="text-muted">{log.totalTokens != null ? log.totalTokens.toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
