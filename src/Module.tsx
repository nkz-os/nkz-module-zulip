import { defineModule } from '@nekazari/module-kit';
import { lazy } from 'react';
import './i18n';
import pkg from '../package.json';

const MainPage = lazy(() => import('./App'));

export default defineModule({
  id: 'zulip',
  displayName: 'Communications',
  version: pkg.version,
  hostApiVersion: '^2.0.0',
  description: 'Sovereign messaging hub with IoT alert integration — Nekazari Platform Module',
  accent: { base: '#7C3AED', soft: '#EDE9FE', strong: '#5B21B6' },
  icon: 'message-circle',
  main: MainPage,
});
