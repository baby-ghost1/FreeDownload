CREATE TABLE "coupons" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"percent_off" integer NOT NULL,
	"max_uses" integer,
	"used_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upgrade_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_code" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'inr' NOT NULL,
	"coupon_code" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"note" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "upgrade_requests" ADD CONSTRAINT "upgrade_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coupons_code_unique" ON "coupons" USING btree ("code");--> statement-breakpoint
CREATE INDEX "upgrade_requests_user_id_idx" ON "upgrade_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "upgrade_requests_status_idx" ON "upgrade_requests" USING btree ("status");