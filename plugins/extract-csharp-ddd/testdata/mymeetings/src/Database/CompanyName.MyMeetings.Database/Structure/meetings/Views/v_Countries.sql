CREATE VIEW [meetings].[v_Countries]
AS
SELECT
    [Country].[Code],
    [Country].[Name]
FROM meetings.Countries AS [Country]
GO
