CREATE TABLE `agent_seats` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`seat_id` text NOT NULL,
	`name` text NOT NULL,
	`role_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`model_id` text NOT NULL,
	`constitution_hash` text NOT NULL,
	`authority` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_seats_run_idx` ON `agent_seats` (`run_id`);--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`role_id` text NOT NULL,
	`spec` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`seat_id` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`reason` text NOT NULL,
	`detail` text NOT NULL,
	`status` text NOT NULL,
	`resolved_by` text,
	`note` text,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `approvals_status_idx` ON `approvals` (`status`);--> statement-breakpoint
CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`seat_id` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`mime_type` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `artifacts_run_idx` ON `artifacts` (`run_id`);--> statement-breakpoint
CREATE TABLE `credentials_metadata` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`backend` text NOT NULL,
	`account` text NOT NULL,
	`fingerprint` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_verified_at` integer,
	`last_status` text,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credentials_provider_idx` ON `credentials_metadata` (`provider_id`);--> statement-breakpoint
CREATE TABLE `governance_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`layer` text NOT NULL,
	`scope_type` text NOT NULL,
	`scope_id` text,
	`rules` text NOT NULL,
	`locked` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `judgments` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`kind` text NOT NULL,
	`judge_seat_id` text NOT NULL,
	`target_seat_id` text,
	`challenge_id` text,
	`claim` text NOT NULL,
	`evidence` text NOT NULL,
	`reasoning_summary` text NOT NULL,
	`confidence` real,
	`decision` text NOT NULL,
	`severity` text,
	`provider_id` text NOT NULL,
	`model` text NOT NULL,
	`tokens` integer NOT NULL,
	`tool_calls` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `judgments_run_idx` ON `judgments` (`run_id`);--> statement-breakpoint
CREATE TABLE `models` (
	`provider_id` text NOT NULL,
	`model_id` text NOT NULL,
	`display_name` text NOT NULL,
	`context_window` integer,
	`max_output_tokens` integer,
	`capabilities` text NOT NULL,
	`pricing` text,
	`user_pricing` text,
	`discovered_at` integer NOT NULL,
	PRIMARY KEY(`provider_id`, `model_id`),
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `permissions` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`grant` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `permissions_subject_idx` ON `permissions` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`path` text,
	`is_git` integer DEFAULT false NOT NULL,
	`budget_usd` real DEFAULT 5 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `providers` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`base_url` text,
	`auth_kind` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`options` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`constitution` text NOT NULL,
	`built_in` integer NOT NULL,
	`version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `run_events` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`seq` integer NOT NULL,
	`ts` integer NOT NULL,
	`type` text NOT NULL,
	`seat_id` text,
	`payload` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_events_run_seq_idx` ON `run_events` (`run_id`,`seq`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`project_id` text,
	`session_id` text,
	`table_id` text,
	`workflow_id` text,
	`parent_run_id` text,
	`title` text NOT NULL,
	`task` text NOT NULL,
	`status` text NOT NULL,
	`outcome` text,
	`snapshot` text NOT NULL,
	`workspace_path` text,
	`branch` text,
	`error` text,
	`last_seq` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `runs_project_idx` ON `runs` (`project_id`);--> statement-breakpoint
CREATE INDEX `runs_created_idx` ON `runs` (`created_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `table_members` (
	`id` text PRIMARY KEY NOT NULL,
	`table_id` text NOT NULL,
	`ord` integer NOT NULL,
	`spec` text NOT NULL,
	`authority` text,
	`source_agent_id` text,
	FOREIGN KEY (`table_id`) REFERENCES `tables`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `table_members_table_idx` ON `table_members` (`table_id`);--> statement-breakpoint
CREATE TABLE `tables` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`project_id` text,
	`protocol` text NOT NULL,
	`rules` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `tool_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`seat_id` text NOT NULL,
	`tool` text NOT NULL,
	`action_kind` text NOT NULL,
	`args` text NOT NULL,
	`status` text NOT NULL,
	`governance_decision` text NOT NULL,
	`result_preview` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tool_calls_run_idx` ON `tool_calls` (`run_id`);--> statement-breakpoint
CREATE TABLE `usage_records` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`seat_id` text,
	`agent_name` text NOT NULL,
	`table_id` text,
	`workflow_id` text,
	`provider_id` text NOT NULL,
	`provider_kind` text NOT NULL,
	`model_id` text NOT NULL,
	`phase` text NOT NULL,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`cached_input_tokens` integer NOT NULL,
	`reasoning_tokens` integer NOT NULL,
	`tool_calls` integer NOT NULL,
	`latency_ms` integer NOT NULL,
	`cost_usd` real,
	`provider_cost_usd` real,
	`pricing_source` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `usage_run_idx` ON `usage_records` (`run_id`);--> statement-breakpoint
CREATE INDEX `usage_created_idx` ON `usage_records` (`created_at`);--> statement-breakpoint
CREATE TABLE `workflow_edges` (
	`id` text NOT NULL,
	`workflow_id` text NOT NULL,
	`source` text NOT NULL,
	`target` text NOT NULL,
	`branch` text,
	PRIMARY KEY(`workflow_id`, `id`),
	FOREIGN KEY (`workflow_id`) REFERENCES `workflows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workflow_nodes` (
	`id` text NOT NULL,
	`workflow_id` text NOT NULL,
	`type` text NOT NULL,
	`label` text NOT NULL,
	`config` text NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	PRIMARY KEY(`workflow_id`, `id`),
	FOREIGN KEY (`workflow_id`) REFERENCES `workflows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workflows` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`project_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
