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
    <div className="flex gap-2 py-1.5 px-2 hover:bg-nkz-canvas rounded-nkz-md">
      <img
        src={message.avatar_url}
        alt=""
        className="w-7 h-7 rounded-nkz-full flex-shrink-0 mt-0.5"
        loading="lazy"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-nkz-sm font-medium text-nkz-text-primary truncate">
            {message.sender_full_name}
          </span>
          <span className="text-nkz-xs text-nkz-text-muted flex-shrink-0">
            {time}
          </span>
        </div>
        <div
          className="text-nkz-sm text-nkz-text-secondary [&_p]:my-0.5 [&_code]:bg-nkz-surface-sunken [&_code]:px-1 [&_code]:rounded [&_a]:text-nkz-info [&_a]:underline break-words"
          dangerouslySetInnerHTML={{ __html: safeHtml }}
        />
      </div>
    </div>
  );
};

export default MessageBubble;
