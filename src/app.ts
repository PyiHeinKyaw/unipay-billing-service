import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import Fastify from 'fastify';

import prismaPlugin from './plugins/prisma.js';
import routes from './routes/index.js';
import { env } from './config/env.js';
import { errorResponse } from './utils/response.js';

export const buildApp = async () => {
  const app = Fastify({
    logger: true,
  });

  await app.register(cors, {
    origin:
      env.CORS_ORIGIN === '*'
        ? true
        : env.CORS_ORIGIN.split(',').map((origin) => origin.trim()),
    methods: ['GET', 'POST', 'OPTIONS'],
  });
  await app.register(sensible);
  await app.register(prismaPlugin);
  await app.register(routes);

  app.setErrorHandler((error, request, reply) => {
    const statusCode =
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number' &&
      error.statusCode >= 400
        ? error.statusCode
        : 500;
    const message = error instanceof Error ? error.message : 'Internal Server Error';

    request.log.error(error);

    return reply.status(statusCode).send(errorResponse(statusCode, message));
  });

  return app;
};
