import { i18n } from '@nekazari/sdk';

import es from './locales/es/zulip.json';
import en from './locales/en/zulip.json';
import ca from './locales/ca/zulip.json';
import eu from './locales/eu/zulip.json';
import fr from './locales/fr/zulip.json';
import pt from './locales/pt/zulip.json';

const NS = 'zulip';

function registerTranslations(): void {
  const add = i18n && 'addResourceBundle' in i18n ? i18n.addResourceBundle : undefined;
  if (typeof add !== 'function') return;
  add.call(i18n, 'es', NS, es, true, true);
  add.call(i18n, 'en', NS, en, true, true);
  add.call(i18n, 'ca', NS, ca, true, true);
  add.call(i18n, 'eu', NS, eu, true, true);
  add.call(i18n, 'fr', NS, fr, true, true);
  add.call(i18n, 'pt', NS, pt, true, true);
}

registerTranslations();
