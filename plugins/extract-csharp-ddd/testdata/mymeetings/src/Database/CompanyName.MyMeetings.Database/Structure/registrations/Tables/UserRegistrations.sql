CREATE TABLE registrations.UserRegistrations
(
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [Login] NVARCHAR(100) NOT NULL,
    [Email] NVARCHAR(255) NOT NULL,
    [StatusCode] VARCHAR(50) NOT NULL,
    CONSTRAINT [PK_registrations_UserRegistrations_Id] PRIMARY KEY ([Id] ASC)
)
GO
