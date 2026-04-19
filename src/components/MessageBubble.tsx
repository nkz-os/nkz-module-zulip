import React, { useMemo } from 'react';
import type { ZulipMessage } from '../types/zulip';
import { sanitizeZulipHtml } from '../utils/sanitize';
import { formatRelativeTime } from '../utils/time';

interface Props {
  message: ZulipMessage;
}

const MessageBubble: React.FC<Props> = ({ message }) => {
  const safeHtml = useMemo(() => sanitizeZulipHtml(message.content), [message.content]);
  const time = useMemo(() => formatRelativeTime(message.timestamp), [message.timestamp]);

  return (
    <div className="flex gap-2 py-1.5 px-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded">
      <img
        src={message.avatar_url}
        alt=""
        className="w-7 h-7 rounded-full flex-shrink-0 mt-0.5"
        loading="lazy"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
            {message.sender_full_name}
          </span>
          <span className="text-xs text-slate-400 dark:text-slate-500 flex-shrink-0">
            {time}
          </span>
        </div>
        <div
          className="text-sm text-slate-700 dark:text-slate-300 [&_p]:my-0.5 [&_code]:bg-slate-100 dark:[&_code]:bg-slate-700 [&_code]:px-1 [&_code]:rounded [&_a]:text-blue-600 dark:[&_a]:text-blue-400 [&_a]:underline break-words"
          dangerouslySetInnerHTML={{ __html: safeHtml }}
        />
      </div>
    </div>
  );
};

export default MessageBubble;
