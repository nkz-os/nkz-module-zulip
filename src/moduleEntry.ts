import './i18n';
import CommunicationsHub from './App';
import pkg from '../package.json';

const MODULE_ID = 'zulip';

if (typeof window !== 'undefined' && window.__NKZ__) {
  window.__NKZ__.register({
    id: MODULE_ID,
    main: CommunicationsHub,
    version: pkg.version,
  });
}
