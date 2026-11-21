// Runs every hour from a scheduled trigger. No migrations exist yet.
export const runMigrations = async () => {
  console.log('[TG] stub run-migrations');
  return { stub: true, name: 'run-migrations' };
};
