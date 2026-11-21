// Runs worker over items with a parallel limit and keeps the input order.
// When shouldStop returns true, no new items start and finished results are returned.
export async function mapWithLimit(items, limit, worker, shouldStop = () => false) {
  const results = [];
  let nextIndex = 0;
  let failed = false;

  const runWorker = async () => {
    while (nextIndex < items.length && !failed && !shouldStop()) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await worker(items[index]);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, runWorker));
  return results.filter((result) => result !== undefined);
}
