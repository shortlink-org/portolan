CREATE TABLE meetings.MeetingAttendees
(
    [MeetingId] UNIQUEIDENTIFIER NOT NULL,
    [AttendeeId] UNIQUEIDENTIFIER NOT NULL,
    [DecisionDate] DATETIME2 NOT NULL,
    [GuestsNumber] INT NULL,
    CONSTRAINT [PK_meetings_MeetingAttendees] PRIMARY KEY ([MeetingId] ASC, [AttendeeId] ASC),
    CONSTRAINT [FK_meetings_MeetingAttendees_Meetings] FOREIGN KEY ([MeetingId]) REFERENCES [meetings].[Meetings] ([Id])
)
GO

CREATE NONCLUSTERED INDEX IX_meetings_MeetingAttendees_AttendeeId ON meetings.MeetingAttendees ([AttendeeId]);
GO
