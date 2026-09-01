# get

Reads a user by id.

## What follows from it

**It says plainly when there is no such user.** Unlike `authenticate`, which
answers every failure identically, this one may admit that an id resolves to
nothing: the caller already knows the id, so nothing is disclosed by saying so.

The output has the same shape as `register`'s today. They are separate types on
purpose - the two answer different questions and are free to diverge the moment
either one needs to.

## Answers

| | |
|---|---|
| found | the user id, the address, and when it was created |
| no such user | refused, plainly |
