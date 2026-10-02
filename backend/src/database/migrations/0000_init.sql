CREATE TABLE "email_verifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_resets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"csrf_token" text NOT NULL,
	"ip" "inet",
	"user_agent" text,
	"mfa_ok" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"email_verified_at" timestamp with time zone,
	"display_name" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "download_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"attempt_no" integer NOT NULL,
	"worker_id" text,
	"status" text NOT NULL,
	"error_code" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"log_ref" text
);
--> statement-breakpoint
CREATE TABLE "download_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"anon_key" text,
	"source_id" uuid,
	"url_hash" text NOT NULL,
	"url_redacted" text,
	"status" text DEFAULT 'created' NOT NULL,
	"priority" smallint DEFAULT 50 NOT NULL,
	"requested_format" text,
	"target_container" text,
	"idempotency_key" text,
	"progress" smallint DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_message" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"max_retries" integer DEFAULT 3 NOT NULL,
	"lease_token" text,
	"lease_expires_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"worker_id" text,
	"turnstile_ok" boolean DEFAULT false NOT NULL,
	"ip" "inet",
	"analyzed_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "download_sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"adapter_key" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"mode" text DEFAULT 'active' NOT NULL,
	"allowed_formats" jsonb NOT NULL,
	"max_file_size_mb" integer,
	"requires_auth" boolean DEFAULT false NOT NULL,
	"allowed_features" jsonb NOT NULL,
	"priority" smallint DEFAULT 100 NOT NULL,
	"health_status" text DEFAULT 'unknown' NOT NULL,
	"last_health_at" timestamp with time zone,
	"policy_version" integer DEFAULT 1 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"kind" text DEFAULT 'media' NOT NULL,
	"size_bytes" integer,
	"mime_type" text,
	"checksum_sha256" text,
	"container" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"purged_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "media_formats" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"label" text NOT NULL,
	"kind" text DEFAULT 'video' NOT NULL,
	"container" text NOT NULL,
	"width" integer,
	"height" integer,
	"fps" integer,
	"vcodec" text,
	"acodec" text,
	"bitrate_kbps" integer,
	"filesize_bytes" integer,
	"is_default" boolean DEFAULT false NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"ext_key" text
);
--> statement-breakpoint
CREATE TABLE "media_metadata" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"external_id" text,
	"title" text,
	"duration_sec" integer,
	"thumbnail_url" text,
	"uploader" text,
	"page_url" text,
	"description_trunc" text,
	"raw" jsonb,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"subscription_id" uuid,
	"provider" text DEFAULT 'none' NOT NULL,
	"provider_ref" text,
	"amount_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"status" text NOT NULL,
	"kind" text DEFAULT 'charge' NOT NULL,
	"paid_at" timestamp with time zone,
	"failure_reason" text,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"tier" integer DEFAULT 0 NOT NULL,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"interval" text DEFAULT 'month' NOT NULL,
	"limits" jsonb NOT NULL,
	"features" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"provider" text DEFAULT 'none' NOT NULL,
	"provider_ref" text,
	"status" text DEFAULT 'active' NOT NULL,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"canceled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"jobs_created" integer DEFAULT 0 NOT NULL,
	"jobs_completed" integer DEFAULT 0 NOT NULL,
	"bytes_served" integer DEFAULT 0 NOT NULL,
	"api_calls" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "abuse_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text,
	"ip" "inet",
	"signal" text NOT NULL,
	"score" smallint DEFAULT 1 NOT NULL,
	"action" text DEFAULT 'log' NOT NULL,
	"reviewed_by" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"totp_secret_enc" text,
	"ip_allowlist" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"rate_tier" text DEFAULT 'free' NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_usage" (
	"id" uuid PRIMARY KEY NOT NULL,
	"api_key_id" uuid NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL,
	"bytes" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"admin_id" text,
	"action" text NOT NULL,
	"resource" text,
	"resource_id" text,
	"ip" "inet",
	"user_agent" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "copyright_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"claimant" text NOT NULL,
	"contact" text NOT NULL,
	"work_url" text NOT NULL,
	"evidence" jsonb,
	"status" text DEFAULT 'received' NOT NULL,
	"actions" jsonb NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"rollout" smallint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"key" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text NOT NULL,
	"response" jsonb,
	"job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"reporter_email" text,
	"target_url" text,
	"detail" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"assigned_admin_id" text,
	"resolution" text,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_verifications" ADD CONSTRAINT "email_verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "download_attempts" ADD CONSTRAINT "download_attempts_job_id_download_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."download_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "download_jobs" ADD CONSTRAINT "download_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "download_jobs" ADD CONSTRAINT "download_jobs_source_id_download_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."download_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_job_id_download_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."download_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_formats" ADD CONSTRAINT "media_formats_job_id_download_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."download_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_metadata" ADD CONSTRAINT "media_metadata_job_id_download_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."download_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_usage" ADD CONSTRAINT "api_usage_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_verifications_token_hash_unique" ON "email_verifications" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "email_verifications_user_id_idx" ON "email_verifications" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "password_resets_token_hash_unique" ON "password_resets" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "password_resets_user_id_idx" ON "password_resets" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_unique" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "download_attempts_job_id_attempt_no_unique" ON "download_attempts" USING btree ("job_id","attempt_no");--> statement-breakpoint
CREATE INDEX "download_attempts_job_id_idx" ON "download_attempts" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "download_jobs_user_id_created_at_idx" ON "download_jobs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "download_jobs_status_priority_created_at_idx" ON "download_jobs" USING btree ("status","priority","created_at");--> statement-breakpoint
CREATE INDEX "download_jobs_anon_key_idx" ON "download_jobs" USING btree ("anon_key");--> statement-breakpoint
CREATE INDEX "download_jobs_expires_at_idx" ON "download_jobs" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "download_jobs_url_hash_idx" ON "download_jobs" USING btree ("url_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "download_jobs_idempotency_key_unique" ON "download_jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "download_sources_slug_unique" ON "download_sources" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "download_sources_enabled_idx" ON "download_sources" USING btree ("enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "files_object_key_unique" ON "files" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "files_job_id_idx" ON "files" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "files_expires_at_idx" ON "files" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "media_formats_job_id_idx" ON "media_formats" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_metadata_job_id_unique" ON "media_metadata" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "payments_user_id_created_at_idx" ON "payments" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_ref_unique" ON "payments" USING btree ("provider_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_code_unique" ON "plans" USING btree ("code");--> statement-breakpoint
CREATE INDEX "subscriptions_user_id_idx" ON "subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_provider_ref_unique" ON "subscriptions" USING btree ("provider_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_records_user_id_day_unique" ON "usage_records" USING btree ("user_id","day");--> statement-breakpoint
CREATE INDEX "usage_records_user_id_day_idx" ON "usage_records" USING btree ("user_id","day");--> statement-breakpoint
CREATE INDEX "abuse_events_subject_idx" ON "abuse_events" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_users_email_unique" ON "admin_users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_key_hash_unique" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_user_id_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "api_keys_prefix_idx" ON "api_keys" USING btree ("prefix");--> statement-breakpoint
CREATE UNIQUE INDEX "api_usage_api_key_id_bucket_start_unique" ON "api_usage" USING btree ("api_key_id","bucket_start");--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_resource_resource_id_idx" ON "audit_logs" USING btree ("resource","resource_id");--> statement-breakpoint
CREATE INDEX "audit_logs_admin_id_idx" ON "audit_logs" USING btree ("admin_id");--> statement-breakpoint
CREATE INDEX "copyright_requests_status_created_at_idx" ON "copyright_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "reports_status_created_at_idx" ON "reports" USING btree ("status","created_at");