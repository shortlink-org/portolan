# extract-redis

`extract-redis` scans non-test Go source for runtime construction of a supported
Redis client and adds one service-owned `redis` store to the catalog. It
recognizes go-redis, rueidis and redigo constructors, including aliased imports.

It also follows key-building expressions into `Get`, `Set`, `Del` and other
common client operations. The resulting Redis schema keeps literal separators,
marks dynamic and optional key parts, and records operations, TTL, value type
and source where code proves them. Redis keys remain key patterns rather than
being presented as SQL tables.
