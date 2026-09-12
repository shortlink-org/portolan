using CompanyName.MyMeetings.Modules.Meetings.Domain.Meetings;
using CompanyName.MyMeetings.Modules.Meetings.Domain.Members;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace CompanyName.MyMeetings.Modules.Meetings.Infrastructure.Domain.Meetings
{
    internal class MeetingEntityTypeConfiguration : IEntityTypeConfiguration<Meeting>
    {
        public void Configure(EntityTypeBuilder<Meeting> builder)
        {
            builder.ToTable("Meetings", "meetings");

            builder.HasKey(x => x.Id);

            builder.Property<string>("_title").HasColumnName("Title");
            builder.Property<MeetingStatus>("_status").HasColumnName("StatusCode");
            builder.Property<MemberId>("_creatorId").HasColumnName("CreatorId");
            builder.Property<DateTime?>("_cancelDate").HasColumnName("CancelDate");

            builder.OwnsOne<MeetingTerm>("_term", b =>
            {
                b.Property(p => p.StartDate).HasColumnName("TermStartDate");
                b.Property(p => p.EndDate).HasColumnName("TermEndDate");
            });

            builder.OwnsMany<MeetingAttendee>("_attendees", b =>
            {
                b.WithOwner().HasForeignKey("MeetingId");
                b.ToTable("MeetingAttendees", "meetings");
                b.Property<MeetingId>("MeetingId");
                b.Property<MemberId>("AttendeeId");
                b.Property<DateTime>("_decisionDate").HasColumnName("DecisionDate");
                b.Property<int>("_guestsNumber").HasColumnName("GuestsNumber");
            });
        }
    }
}
