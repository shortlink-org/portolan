# MyMeetings, small

A modular monolith in three modules, in the layout `extract-csharp-ddd`
reads: Meetings keeps meetings and members and hears about new users,
Registrations registers them and tells the bus, Payments is event-sourced
and expires subscriptions on a schedule. The API host answers for Meetings
and Registrations; the database project declares one schema per module and
an `app` schema nobody owns.
