ALTER TABLE news ADD topic text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE news ADD tags text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE TABLE recommendations (
 id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
 feature_date text NOT NULL UNIQUE,
 title text NOT NULL,
 summary text NOT NULL,
 cover text NOT NULL DEFAULT '',
 streams text NOT NULL DEFAULT '[]',
 status text NOT NULL CHECK (status IN ('draft','published','archived')),
 created_at text NOT NULL,
 updated_at text NOT NULL,
 version integer NOT NULL DEFAULT 1
);
--> statement-breakpoint
CREATE TABLE editorial_accounts (
 email text PRIMARY KEY NOT NULL,
 created_at text NOT NULL
);
