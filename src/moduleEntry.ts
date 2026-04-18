import './i18n';
import ZulipEmbed from './App';
import pkg from '../package.json';

const MODULE_ID = 'zulip';

if (typeof window !== 'undefined' && window.__NKZ__) {
  window.__NKZ__.register({
    id: MODULE_ID,
    main: ZulipEmbed,
    version: pkg.version,
  });
}
