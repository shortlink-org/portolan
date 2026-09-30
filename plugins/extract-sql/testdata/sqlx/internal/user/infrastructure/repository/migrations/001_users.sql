CREATE TABLE users (
    id    uuid PRIMARY KEY,
    email text NOT NULL UNIQUE
);

CREATE TABLE sessions (
    id      uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users (id)
);
