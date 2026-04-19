import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '@nekazari/sdk';
import { ExternalLink } from 'lucide-react';
import type { ZulipMessage, ZulipTopic } from '../types/zulip';
import { useZulipApi } from '../hooks/useZulipApi';
import MessageBubble from './MessageBubble';
import QuickReply from './QuickReply';

interface Props {
  streamId: number;
  streamName: string;
  newMessages: ZulipMessage[];
}

const StreamDetail: React.FC<Props> = ({ streamId, streamName, newMessages }) => {
  const { t } = useTranslation('zulip');
  const { getTopics, getMessages, sendMessage } = useZulipApi();
  const [topics, setTopics] = useState<ZulipTopic[]>([]);
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [messages, setMessages] = useState<ZulipMessage[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await getTopics(streamId);
        setTopics(data.topics.slice(0, 10));
      } catch {
        // Silently fail
      }
    })();
  }, [streamId, getTopics]);

  const loadTopicMessages = useCallback(
    async (topic: string) => {
      setSelectedTopic(topic);
      setLoading(true);
      try {
        const data = await getMessages(
          [
            { operator: 'stream', operand: streamName },
            { operator: 'topic', operand: topic },
          ],
          15
        );
        setMessages(data.messages);
      } catch {
        setMessages([]);
      } finally {
        setLoading(false);
      }
    },
    [streamName, getMessages]
  );

  useEffect(() => {
    if (!selectedTopic || newMessages.length === 0) return;
    const relevant = newMessages.filter(
      (m) => m.stream_id === streamId && m.subject === selectedTopic
    );
    if (relevant.length === 0) return;
    setMessages((prev) => {
      const ids = new Set(prev.map((m) => m.id));
      return [...prev, ...relevant.filter((m) => !ids.has(m.id))];
    });
  }, [newMessages, streamId, selectedTopic]);

  const handleSend = useCallback(
    async (content: string) => {
      if (!selectedTopic) return;
      await sendMessage({ type: 'stream', to: streamName, topic: selectedTopic, content });
    },
    [selectedTopic, streamName, sendMessage]
  );

  const zulipUrl = window.__ENV__?.VITE_ZULIP_URL || '';

  return (
    <div className="border-t border-slate-100 dark:border-slate-800">
      <div className="flex flex-wrap gap-1 p-2">
        {topics.map((topic) => (
          <button
            key={topic.name}
            onClick={() => loadTopicMessages(topic.name)}
            className={`text-xs px-2 py-1 rounded-full border transition-colors ${
              selectedTopic === topic.name
                ? 'bg-blue-100 dark:bg-blue-900/40 border-blue-300 dark:border-blue-600 text-blue-700 dark:text-blue-300'
                : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
            }`}
          >
            {topic.name}
          </button>
        ))}
      </div>

      {selectedTopic && (
        <div>
          <div className="max-h-72 overflow-y-auto">
            {loading ? (
              <p className="text-sm text-slate-400 p-4 text-center">{t('loading')}</p>
            ) : messages.length === 0 ? (
              <p className="text-sm text-slate-400 p-4 text-center">{t('noMessages')}</p>
            ) : (
              messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
            )}
          </div>
          <QuickReply onSend={handleSend} />
          {zulipUrl && (
            <div className="px-3 py-1.5 text-center">
              <a
                href={`${zulipUrl}/#narrow/stream/${encodeURIComponent(streamName)}/topic/${encodeURIComponent(selectedTopic)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
              >
                {t('hub.openInZulip')} <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default StreamDetail;
