const { createApp, log } = require('./app');
const { createDb } = require('./db');

const PORT = Number(process.env.PORT) || 3000;

async function main() {
  const db = createDb();
  await db.init();

  const app = createApp(db);
  const server = app.listen(PORT, () => {
    log('info', `ShortLink API listening on port ${PORT}`);
  });

  // Graceful shutdown: Kubernetes sends SIGTERM before stopping a pod.
  const shutdown = (signal) => {
    log('info', `received ${signal}, shutting down`);
    server.close(async () => {
      await db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  log('error', 'failed to start', { error: err.message });
  process.exit(1);
});
