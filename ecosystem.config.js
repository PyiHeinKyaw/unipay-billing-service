import 'dotenv/config';

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(fileURLToPath(import.meta.url));

export const apps = [
  {
    name: 'unipay-billing-service',
    cwd: projectRoot,
    script: 'dist/server.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env_staging: {
      HOST: process.env.HOST || '0.0.0.0',
      PORT: process.env.PORT || '8001',
      NODE_ENV: 'staging',
      DATABASE_URL: process.env.DATABASE_URL,
      CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
    },
  },
];
