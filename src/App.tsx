import './i18n';
import React, { useState, useCallback } from 'react';
import { useTranslation } from '@nekazari/sdk';
import { ExternalLink, RefreshCw, MessageCircle } from 'lucide-react';

const getZulipUrl = (): string => {
  return window.__ENV__?.VITE_ZULIP_URL || '';
};

const ZulipEmbed: React.FC = () => {
  const { t } = useTranslation('zulip');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const zulipUrl = getZulipUrl();

  const handleLoad = useCallback(() => {
    setLoading(false);
    setError(false);
  }, []);

  const handleError = useCallback(() => {
    setLoading(false);
    setError(true);
  }, []);

  const handleRetry = useCallback(() => {
    setLoading(true);
    setError(false);
  }, []);

  if (!zulipUrl) {
    return (
      <div className="flex items-center justify-center w-full h-full bg-slate-50 dark:bg-slate-900">
        <div className="text-center p-8">
          <MessageCircle className="w-12 h-12 mx-auto mb-4 text-slate-400" />
          <p className="text-slate-600 dark:text-slate-400">
            {t('connectionError')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full bg-slate-50 dark:bg-slate-900">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 shadow-sm z-10 min-h-[44px]">
        <div className="flex items-center gap-2">
          <MessageCircle className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            {t('title')}
          </h2>
        </div>
        <a
          href={zulipUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs flex items-center gap-1 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium px-3 py-1.5 rounded-md hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
        >
          {t('openInNewTab')}
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {/* Content */}
      <div className="flex-1 w-full relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-50 dark:bg-slate-900 z-10">
            <div className="text-center">
              <div className="animate-spin w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full mx-auto mb-3" />
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {t('loading')}
              </p>
            </div>
          </div>
        )}

        {error ? (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-50 dark:bg-slate-900">
            <div className="text-center p-8">
              <p className="text-slate-600 dark:text-slate-400 mb-4">
                {t('connectionError')}
              </p>
              <button
                onClick={handleRetry}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
              >
                <RefreshCw className="w-4 h-4" />
                {t('retry')}
              </button>
            </div>
          </div>
        ) : (
          <iframe
            key={loading ? 'loading' : 'loaded'}
            src={zulipUrl}
            className="w-full h-full border-0 absolute inset-0"
            title={t('iframeTitle')}
            allow="clipboard-read; clipboard-write; fullscreen"
            loading="lazy"
            onLoad={handleLoad}
            onError={handleError}
          />
        )}
      </div>
    </div>
  );
};

export default ZulipEmbed;
