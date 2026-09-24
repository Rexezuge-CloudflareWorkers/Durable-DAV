# Edge-Git — Feature: Automation (Webhooks/Checks/Transfer/Releases)

Scope: `webhook/`, `checks/`, `transfer/`, `release/`, `scheduled/`, `realtime/`. Parent index: `../../../AGENTS.md`.

- **Template Method**: `BaseScheduledTask` (`run` → `handleScheduledTask`) + `AbstractPruningTask` (retention cutoff + batched prune); `TaskRegistry` (`CRON_TASK_DEFINITIONS`, phase 1 → phase 2, per-task catch-and-log; Otter/AWS parity).
- **Retry Policy**: `WebhookDeliveryService` at-least-once fan-out (optimistic claim, `AbortSignal` timeout, HMAC `X-DuraDav-Signature-256`, 1m→24h backoff in pure `WebhookRetryPolicy`, auto-disable after `WEBHOOK_MAX_CONSECUTIVE_FAILURES`); `WebhookService` CRUD owns the SSRF guard + secret masking.
- **Strategy + Sandbox**: `CheckService` + `CheckRunnerWorker` (enqueue/dedup/`slice(-20)`/alarm-retry) + `CheckStepExecutor` + `CustomJsSandbox` (`SandboxLimits`, `allowHosts`, quickjs); `CheckSteps.ts` holds step policies.
- **Adapter + Facade**: `ImportRunner`/`MirrorRunner` (`fetchAdapter` redirect budget, diverged-skip, consecutive-failure auto-disable) over `RemoteImportClient`; `ReleaseService` orchestration + pure `ReleaseValidation` (tag/asset/MIME/sha256 rules, unit-testable without D1); asset bytes in DO `ReleaseAssetStore`, metadata in D1.
- **Policy**: `RealtimePolicy` (channel/inbox auth, presence caps) + `RealtimeService.authorizeRepoChannels`; sockets in `RealtimeWorker` (planned `RealtimeEnvelopes/TicketStore/Sockets/Config` split).
- Composition: `serviceBindings/{core,repo,content}Services.ts` domain groups (each <300 LOC god-guard); `Tokens` registry is the single composition root with `createRequestScope`.
