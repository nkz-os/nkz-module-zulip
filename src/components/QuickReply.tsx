import React, { useState, useCallback, useRef } from 'react';
import { useTranslation } from '@nekazari/sdk';
import { Send } from 'lucide-react';

interface Props {
  onSend: (content: string) => Promise<void>;
  disabled?: boolean;
}

const QuickReply: React.FC<Props> = ({ onSend, disabled = false }) => {
  const { t } = useTranslation('zulip');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    setSending(true);
    try {
      await onSend(trimmed);
      setText('');
      inputRef.current?.focus();
    } catch {
      // Error handling is in the parent
    } finally {
      setSending(false);
    }
  }, [text, sending, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div className="flex items-end gap-2 p-2 border-t border-nkz-border bg-nkz-surface">
      <textarea
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={t('quickReply.placeholder')}
        disabled={disabled || sending}
        rows={1}
        className="flex-1 resize-none rounded-nkz-lg border border-nkz-border-strong bg-nkz-canvas px-3 py-2 text-nkz-sm text-nkz-text-primary placeholder:text-nkz-text-muted focus:outline-none focus:ring-2 focus:ring-nkz-info disabled:opacity-50"
      />
      <button
        onClick={handleSend}
        disabled={disabled || sending || !text.trim()}
        className="p-2 rounded-nkz-lg bg-nkz-info text-nkz-text-on-accent hover:bg-nkz-info-strong disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
        aria-label={t('quickReply.send')}
      >
        <Send className="w-4 h-4" />
      </button>
    </div>
  );
};

export default QuickReply;
