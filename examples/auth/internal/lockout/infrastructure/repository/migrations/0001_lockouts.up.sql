CREATE TABLE lockouts (
    user_id      text        PRIMARY KEY,
    failures     integer     NOT NULL,
    locked_until timestamptz,
    version      bigint      NOT NULL
);

-- One row per account, keyed by the user id it counts for. There is
-- deliberately no foreign key to users: a lockout refers to a user by id and
-- nothing more, for the reason given on the sessions table. Nothing here is
-- ever deleted; a row that has been cleared is a user with a clean count.
