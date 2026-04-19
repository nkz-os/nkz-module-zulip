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
    <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Megaphone className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          <span className="text-sm font-semibold text-amber-800 dark:text-amber-300">
            {t('announcements.title')}
          </span>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-amber-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-amber-400" />
        )}
      </button>
      {expanded && (
        <div className="max-h-48 overflow-y-auto bg-white dark:bg-slate-900">
          {messages.length === 0 ? (
            <p className="text-sm text-slate-400 p-4 text-center">{t('announcements.empty')}</p>
          ) : (
            messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
          )}
        </div>
      )}
    </div>
  );
};

export default AnnouncementsPanel;
