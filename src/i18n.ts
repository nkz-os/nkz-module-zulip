import { registerModuleTranslations } from '@nekazari/sdk';

import es from './locales/es/zulip.json';
import en from './locales/en/zulip.json';
import ca from './locales/ca/zulip.json';
import eu from './locales/eu/zulip.json';
import fr from './locales/fr/zulip.json';
import pt from './locales/pt/zulip.json';

registerModuleTranslations('zulip', { es, en, ca, eu, fr, pt });
