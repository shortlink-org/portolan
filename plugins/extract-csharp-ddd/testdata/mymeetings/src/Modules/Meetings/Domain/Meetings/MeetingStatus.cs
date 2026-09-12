namespace CompanyName.MyMeetings.Modules.Meetings.Domain.Meetings
{
    /// <summary>Where a meeting is in its life.</summary>
    public enum MeetingStatus
    {
        /// <summary>Announced, not yet held.</summary>
        Planned,

        Held,

        [Obsolete("Cancel the meeting instead.")]
        Postponed,

        Canceled,
    }
}
