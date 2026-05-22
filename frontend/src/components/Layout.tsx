import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { MessageSquare, BarChart3, List, Zap, Plus } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import { NewConversationModal } from './NewConversationModal';

export function Layout() {
  const [showModal, setShowModal] = useState(false);
  const navigate = useNavigate();

  const handleCreate = async (provider: string, model?: string) => {
    const { conversation } = await api.conversations.create({ provider, model });
    setShowModal(false);
    navigate(`/chat/${conversation.id}`);
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <Zap size={20} className="logo-icon" />
          <span className="logo-text">InferLog</span>
        </div>

        <button className="new-chat-btn" onClick={() => setShowModal(true)}>
          <Plus size={14} />
          New Chat
        </button>

        <nav className="sidebar-nav">
          <NavLink to="/conversations" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <MessageSquare size={16} />
            Conversations
          </NavLink>
          <NavLink to="/dashboard" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <BarChart3 size={16} />
            Dashboard
          </NavLink>
          <NavLink to="/logs" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <List size={16} />
            Inference Logs
          </NavLink>
        </nav>

        <div className="sidebar-footer">
          <span className="version-badge">v1.0.0</span>
        </div>
      </aside>

      <main className="main-content">
        <Outlet />
      </main>

      {showModal && (
        <NewConversationModal
          onClose={() => setShowModal(false)}
          onCreate={handleCreate}
        />
      )}
    </div>
  );
}
