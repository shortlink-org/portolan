CREATE TABLE meetings.Members
(
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [Login] NVARCHAR(100) NOT NULL,
    [Email] NVARCHAR(255) NOT NULL,
    CONSTRAINT [PK_meetings_Members_Id] PRIMARY KEY ([Id] ASC)
)
GO
