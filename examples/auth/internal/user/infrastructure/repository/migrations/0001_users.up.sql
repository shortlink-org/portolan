CREATE TABLE users (
    id            text        PRIMARY KEY,
    email         text        NOT NULL,
    password_hash text        NOT NULL,
    created_at    timestamptz NOT NULL,
    version       bigint      NOT NULL
);

-- One address, one user. Until now this rule lived in the adapter, where it
-- could only be enforced by looking before writing - which is not enforcement,
-- because two writers both look and both find nothing.
CREATE UNIQUE INDEX users_email_key ON users (email);
