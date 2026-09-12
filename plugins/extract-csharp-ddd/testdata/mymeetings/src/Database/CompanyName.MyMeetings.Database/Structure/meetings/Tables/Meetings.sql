CREATE TABLE meetings.Meetings
(
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [Title] NVARCHAR(200) NOT NULL,
    [TermStartDate] DATETIME NOT NULL,
    [TermEndDate] DATETIME NOT NULL,
    [StatusCode] VARCHAR(50) NOT NULL,
    [CreatorId] UNIQUEIDENTIFIER NOT NULL,
    [CancelDate] DATETIME NULL,
    CONSTRAINT [PK_meetings_Meetings_Id] PRIMARY KEY ([Id] ASC)
)
GO
