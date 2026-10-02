DROP INDEX "download_jobs_anon_key_idx";--> statement-breakpoint
DROP INDEX "download_jobs_expires_at_idx";--> statement-breakpoint
DROP INDEX "download_jobs_idempotency_key_unique";--> statement-breakpoint
DROP INDEX "files_expires_at_idx";--> statement-breakpoint
CREATE INDEX "download_jobs_anon_key_idx" ON "download_jobs" USING btree ("anon_key") WHERE "download_jobs"."anon_key" is not null;--> statement-breakpoint
CREATE INDEX "download_jobs_expires_at_idx" ON "download_jobs" USING btree ("expires_at") WHERE "download_jobs"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "download_jobs_idempotency_key_unique" ON "download_jobs" USING btree ("idempotency_key") WHERE "download_jobs"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "files_expires_at_idx" ON "files" USING btree ("expires_at") WHERE "files"."purged_at" is null;--> statement-breakpoint
ALTER TABLE "download_jobs" ADD CONSTRAINT "download_jobs_progress_range" CHECK ("download_jobs"."progress" between 0 and 100);--> statement-breakpoint
ALTER TABLE "download_jobs" ADD CONSTRAINT "download_jobs_retry_range" CHECK ("download_jobs"."retry_count" <= "download_jobs"."max_retries");