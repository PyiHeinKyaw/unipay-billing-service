import type { FastifyPluginAsync } from 'fastify';

import billerRoutes from './biller.routes.js';
import { successResponse } from '../utils/response.js';

const routes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/health', async () => {
    return successResponse({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  });

  await fastify.register(billerRoutes);
};

export default routes;
