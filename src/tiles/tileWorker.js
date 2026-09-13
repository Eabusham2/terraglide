/**
 * Web Worker wrapper. All the actual work lives in tileJobs.js so the very same
 * code can run on the main thread when a worker is not available (see
 * workerHost.js).
 */

import { cancelJob, runJob } from './tileJobs.js';

self.onmessage = (event) => {
  const msg = event.data;
  if (!msg) return;
  if (msg.kind === 'cancel') {
    cancelJob(`${msg.channel}:${msg.id}`);
    return;
  }
  runJob(msg, (response, transfer) => self.postMessage(response, transfer ?? []));
};
