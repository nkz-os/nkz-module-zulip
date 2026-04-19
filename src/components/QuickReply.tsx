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
    <div className="flex items-end gap-2 p-2 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
      <textarea
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={t('quickReply.placeholder')}
        disabled={disabled || sending}
        rows={1}
        className="flex-1 resize-none rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
      />
      <button
        onClick={handleSend}
        disabled={disabled || sending || !text.trim()}
        className="p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
        aria-label={t('quickReply.send')}
      >
        <Send className="w-4 h-4" />
      </button>
    </div>
  );
};

export default QuickReply;
