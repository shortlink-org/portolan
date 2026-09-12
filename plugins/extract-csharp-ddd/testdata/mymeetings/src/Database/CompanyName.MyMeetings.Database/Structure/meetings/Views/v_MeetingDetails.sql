CREATE VIEW [meetings].[v_MeetingDetails]
AS
SELECT
    [Meeting].[Id],
    [Meeting].[Title],
    [Meeting].[TermStartDate],
    [Meeting].[TermEndDate],
    [Meeting].[StatusCode] AS [Status]
FROM [meetings].[Meetings] AS [Meeting]
GO
