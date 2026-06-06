import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '@nekazari/sdk';
import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import type { ZulipMessage, ZulipStream } from '../types/zulip';
import { useZulipApi } from '../hooks/useZulipApi';
import MessageBubble from './MessageBubble';

interface Props {
  alertsStream: ZulipStream | null;
  newMessages: ZulipMessage[];
}

const AlertsPanel: React.FC<Props> = ({ alertsStream, newMessages }) => {
  const { t } = useTranslation('zulip');
  const { getMessages } = useZulipApi();
  const [messages, setMessages] = useState<ZulipMessage[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [loading, setLoading] = useState(false);

  const loadMessages = useCallback(async () => {
    if (!alertsStream) return;
    setLoading(true);
    try {
      const data = await getMessages(
        [{ operator: 'stream', operand: alertsStream.name }],
        10
      );
      setMessages(data.messages);
    } catch {
      // Silent — panel shows empty state
    } finally {
      setLoading(false);
    }
  }, [alertsStream, getMessages]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    if (newMessages.length === 0) return;
    setMessages((prev) => {
      const ids = new Set(prev.map((m) => m.id));
      const fresh = newMessages.filter((m) => !ids.has(m.id));
      return [...prev, ...fresh];
    });
  }, [newMessages]);

  const unreadCount = messages.filter((m) => !m.flags.includes('read')).length;

  return (
    <div className="border border-nkz-border rounded-nkz-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-nkz-danger-soft hover:bg-nkz-danger-soft/80 transition-colors"
      >
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-nkz-danger" />
          <span className="text-nkz-sm font-semibold text-nkz-danger-strong">
            {t('alerts.title')}
          </span>
          {unreadCount > 0 && (
            <span className="px-1.5 py-0.5 text-nkz-xs font-medium bg-nkz-danger text-nkz-text-on-accent rounded-nkz-full">
              {unreadCount}
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-nkz-danger" />
        ) : (
          <ChevronDown className="w-4 h-4 text-nkz-danger" />
        )}
      </button>
      {expanded && (
        <div className="max-h-64 overflow-y-auto bg-nkz-surface">
          {loading && messages.length === 0 ? (
            <p className="text-nkz-sm text-nkz-text-muted p-4 text-center">{t('loading')}</p>
          ) : messages.length === 0 ? (
            <p className="text-nkz-sm text-nkz-text-muted p-4 text-center">{t('alerts.empty')}</p>
          ) : (
            messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
          )}
        </div>
      )}
    </div>
  );
};

export default AlertsPanel;
