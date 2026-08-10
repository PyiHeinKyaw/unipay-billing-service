import { buildApp } from './app.js';
import { env } from './config/env.js';

const start = async (): Promise<void> => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  let isShuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    app?.log.info({ signal }, 'Shutting down server');

    try {
      await app?.close();
      process.exit(0);
    } catch (error) {
      app?.log.error(error, 'Error during server shutdown');
      process.exit(1);
    }
  };

  try {
    app = await buildApp();

    process.once('SIGINT', () => void shutdown('SIGINT'));
    process.once('SIGTERM', () => void shutdown('SIGTERM'));

    await app.listen({
      host: env.HOST,
      port: env.PORT,
    });
  } catch (error) {
    app?.log.error(error, 'Unable to start server');
    process.exit(1);
  }
};

void start();
