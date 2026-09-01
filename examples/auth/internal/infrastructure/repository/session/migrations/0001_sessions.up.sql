CREATE TABLE sessions (
    id         text        PRIMARY KEY,
    user_id    text        NOT NULL,
    token      text        NOT NULL,
    issued_at  timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    version    bigint      NOT NULL
);

CREATE UNIQUE INDEX sessions_token_key ON sessions (token);

-- Every session of a user, for the credential-change path. Ordered reads come
-- out by issue time, so the index carries it.
CREATE INDEX sessions_user_id_idx ON sessions (user_id, issued_at);

-- There is deliberately no foreign key to users. A session refers to a user by
-- id and nothing more: a foreign key would make the database enforce an
-- invariant spanning two aggregates and would tie their transactions together,
-- which is exactly what keeping them separate was for.
