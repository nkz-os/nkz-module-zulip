import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '@nekazari/sdk';
import { MessageSquareText, ChevronDown, ChevronUp } from 'lucide-react';
import type { ZulipMessage, ZulipStream } from '../types/zulip';
import { useZulipApi } from '../hooks/useZulipApi';
import MessageBubble from './MessageBubble';
import QuickReply from './QuickReply';

interface Props {
  forumStream: ZulipStream | null;
  newMessages: ZulipMessage[];
}

const ForumPanel: React.FC<Props> = ({ forumStream, newMessages }) => {
  const { t } = useTranslation('zulip');
  const { getMessages, sendMessage } = useZulipApi();
  const [messages, setMessages] = useState<ZulipMessage[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadMessages = useCallback(async () => {
    if (!forumStream) return;
    setLoading(true);
    try {
      const data = await getMessages(
        [{ operator: 'stream', operand: 'general-forum' }],
        15,
      );
      setMessages(data.messages);
    } catch {
      // Silent — panel shows empty state
    } finally {
      setLoading(false);
    }
  }, [forumStream, getMessages]);

  useEffect(() => {
    if (expanded) loadMessages();
  }, [expanded, loadMessages]);

  useEffect(() => {
    if (!expanded || newMessages.length === 0) return;
    const relevant = newMessages.filter(
      (m) =>
        m.type === 'stream' &&
        forumStream &&
        m.stream_id === forumStream.stream_id,
    );
    if (relevant.length === 0) return;
    setMessages((prev) => {
      const ids = new Set(prev.map((m) => m.id));
      return [...prev, ...relevant.filter((m) => !ids.has(m.id))];
    });
  }, [newMessages, forumStream, expanded]);

  const handleSend = useCallback(
    async (content: string) => {
      if (!forumStream) return;
      await sendMessage({
        type: 'stream',
        to: 'general-forum',
        topic: 'general',
        content,
      });
    },
    [forumStream, sendMessage],
  );

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-green-50 dark:bg-green-900/20 hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <MessageSquareText className="w-4 h-4 text-green-600 dark:text-green-400" />
          <span className="text-sm font-semibold text-green-800 dark:text-green-300">
            {t('forum.title')}
          </span>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-green-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-green-400" />
        )}
      </button>
      {expanded && (
        <div className="bg-white dark:bg-slate-900">
          <div className="max-h-72 overflow-y-auto">
            {loading && messages.length === 0 ? (
              <p className="text-sm text-slate-400 p-4 text-center">
                {t('loading')}
              </p>
            ) : messages.length === 0 ? (
              <p className="text-sm text-slate-400 p-4 text-center">
                {t('forum.empty')}
              </p>
            ) : (
              messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
              ))
            )}
          </div>
          <QuickReply onSend={handleSend} />
        </div>
      )}
    </div>
  );
};

export default ForumPanel;
