import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '@nekazari/sdk';
import { MessageSquare, ChevronDown, ChevronUp } from 'lucide-react';
import type { ZulipMessage } from '../types/zulip';
import { useZulipApi } from '../hooks/useZulipApi';
import MessageBubble from './MessageBubble';
import QuickReply from './QuickReply';

interface DMConversation {
  peerId: number;
  peerEmail: string;
  peerName: string;
  avatarUrl: string;
  unreadCount: number;
}

interface Props {
  dmUnreads: { sender_id: number; unread_message_ids: number[] }[];
  newMessages: ZulipMessage[];
}

const DirectMessagesPanel: React.FC<Props> = ({ dmUnreads, newMessages }) => {
  const { t } = useTranslation('zulip');
  const { getMessages, sendMessage } = useZulipApi();
  const [expanded, setExpanded] = useState(false);
  const [conversations, setConversations] = useState<DMConversation[]>([]);
  const [openPeerId, setOpenPeerId] = useState<number | null>(null);
  const [peerMessages, setPeerMessages] = useState<ZulipMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await getMessages([{ operator: 'is', operand: 'private' }], 30);
        const peerMap = new Map<number, DMConversation>();

        for (const msg of data.messages) {
          if (msg.type !== 'private' || !Array.isArray(msg.display_recipient)) continue;
          for (const r of msg.display_recipient) {
            if (r.email === msg.sender_email && msg.display_recipient.length > 1) continue;
            if (!peerMap.has(r.id)) {
              const unread = dmUnreads.find((u) => u.sender_id === r.id);
              peerMap.set(r.id, {
                peerId: r.id,
                peerEmail: r.email,
                peerName: r.full_name,
                avatarUrl: msg.avatar_url,
                unreadCount: unread?.unread_message_ids.length || 0,
              });
            }
          }
        }
        setConversations(Array.from(peerMap.values()));
      } catch {
        // Silent
      }
    })();
  }, [getMessages, dmUnreads]);

  const openConversation = useCallback(
    async (peerId: number, peerEmail: string) => {
      setOpenPeerId(peerId);
      setLoadingMessages(true);
      try {
        const data = await getMessages(
          [{ operator: 'pm-with', operand: peerEmail }],
          20
        );
        setPeerMessages(data.messages);
      } catch {
        setPeerMessages([]);
      } finally {
        setLoadingMessages(false);
      }
    },
    [getMessages]
  );

  useEffect(() => {
    if (!openPeerId || newMessages.length === 0) return;
    const relevant = newMessages.filter(
      (m) => m.type === 'private' && (m.sender_id === openPeerId || m.display_recipient === openPeerId)
    );
    if (relevant.length === 0) return;
    setPeerMessages((prev) => {
      const ids = new Set(prev.map((m) => m.id));
      return [...prev, ...relevant.filter((m) => !ids.has(m.id))];
    });
  }, [newMessages, openPeerId]);

  const handleSend = useCallback(
    async (content: string) => {
      if (openPeerId === null) return;
      await sendMessage({ type: 'direct', to: [openPeerId], content });
    },
    [openPeerId, sendMessage]
  );

  const totalUnread = dmUnreads.reduce((sum, u) => sum + u.unread_message_ids.length, 0);

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
      >
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-purple-600 dark:text-purple-400" />
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            {t('dm.title')}
          </span>
          {totalUnread > 0 && (
            <span className="px-1.5 py-0.5 text-xs font-medium bg-purple-600 text-white rounded-full">
              {totalUnread}
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-slate-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-400" />
        )}
      </button>
      {expanded && (
        <div className="bg-white dark:bg-slate-900">
          {conversations.length === 0 ? (
            <p className="text-sm text-slate-400 p-4 text-center">{t('dm.empty')}</p>
          ) : (
            conversations.map((conv) => (
              <div key={conv.peerId}>
                <button
                  onClick={() =>
                    openPeerId === conv.peerId
                      ? setOpenPeerId(null)
                      : openConversation(conv.peerId, conv.peerEmail)
                  }
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors border-b border-slate-100 dark:border-slate-800"
                >
                  <img
                    src={conv.avatarUrl}
                    alt=""
                    className="w-7 h-7 rounded-full flex-shrink-0"
                  />
                  <span className="text-sm text-slate-700 dark:text-slate-300 truncate flex-1 text-left">
                    {conv.peerName}
                  </span>
                  {conv.unreadCount > 0 && (
                    <span className="px-1.5 py-0.5 text-xs font-medium bg-purple-600 text-white rounded-full">
                      {conv.unreadCount}
                    </span>
                  )}
                </button>
                {openPeerId === conv.peerId && (
                  <div className="border-t border-slate-100 dark:border-slate-800">
                    <div className="max-h-64 overflow-y-auto">
                      {loadingMessages ? (
                        <p className="text-sm text-slate-400 p-4 text-center">{t('loading')}</p>
                      ) : (
                        peerMessages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
                      )}
                    </div>
                    <QuickReply onSend={handleSend} />
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default DirectMessagesPanel;
