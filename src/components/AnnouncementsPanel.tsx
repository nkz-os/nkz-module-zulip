import React, { useState, useEffect } from 'react';
import { useTranslation } from '@nekazari/sdk';
import { Megaphone, ChevronDown, ChevronUp } from 'lucide-react';
import type { ZulipMessage, ZulipStream } from '../types/zulip';
import { useZulipApi } from '../hooks/useZulipApi';
import MessageBubble from './MessageBubble';

interface Props {
  announcementsStream: ZulipStream | null;
  newMessages: ZulipMessage[];
}

const AnnouncementsPanel: React.FC<Props> = ({ announcementsStream, newMessages }) => {
  const { t } = useTranslation('zulip');
  const { getMessages } = useZulipApi();
  const [messages, setMessages] = useState<ZulipMessage[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!announcementsStream) return;
    (async () => {
      try {
        const data = await getMessages(
          [{ operator: 'stream', operand: announcementsStream.name }],
          5
        );
        setMessages(data.messages);
      } catch {
        // Silent
      }
    })();
  }, [announcementsStream, getMessages]);

  useEffect(() => {
    if (newMessages.length === 0) return;
    setMessages((prev) => {
      const ids = new Set(prev.map((m) => m.id));
      const fresh = newMessages.filter((m) => !ids.has(m.id));
      return [...prev, ...fresh];
    });
  }, [newMessages]);

  return (
    <div className="border border-nkz-border rounded-nkz-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-nkz-warning-soft hover:bg-nkz-warning-soft/80 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Megaphone className="w-4 h-4 text-nkz-warning" />
          <span className="text-nkz-sm font-semibold text-nkz-warning-strong">
            {t('announcements.title')}
          </span>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-nkz-warning" />
        ) : (
          <ChevronDown className="w-4 h-4 text-nkz-warning" />
        )}
      </button>
      {expanded && (
        <div className="max-h-48 overflow-y-auto bg-nkz-surface">
          {messages.length === 0 ? (
            <p className="text-nkz-sm text-nkz-text-muted p-4 text-center">{t('announcements.empty')}</p>
          ) : (
            messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
          )}
        </div>
      )}
    </div>
  );
};

export default AnnouncementsPanel;
