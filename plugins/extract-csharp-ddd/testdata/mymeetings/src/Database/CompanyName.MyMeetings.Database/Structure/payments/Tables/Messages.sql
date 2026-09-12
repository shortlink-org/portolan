CREATE TABLE payments.Messages
(
    [StreamIdInternal] INT NOT NULL,
    [StreamVersion] INT NOT NULL,
    [Position] BIGINT NOT NULL,
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [Type] NVARCHAR(128) NOT NULL,
    [JsonData] NVARCHAR(MAX) NOT NULL,
    CONSTRAINT [PK_payments_Messages] PRIMARY KEY CLUSTERED ([Position] ASC)
)
GO

CREATE UNIQUE NONCLUSTERED INDEX IX_Messages_StreamIdInternal_Revision ON payments.Messages (StreamIdInternal, StreamVersion);
GO
