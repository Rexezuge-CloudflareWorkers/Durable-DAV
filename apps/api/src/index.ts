import { DuraDavWorker } from './workers/DuraDavWorker';

const worker = new DuraDavWorker();

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => worker.fetch(request, env, ctx),
  scheduled: (event: ScheduledController, env: Env, ctx: ExecutionContext) => worker.scheduled(event, env, ctx),
};

export { CronTasksWorker, DavVolumeWorker } from '@duradav/background';
