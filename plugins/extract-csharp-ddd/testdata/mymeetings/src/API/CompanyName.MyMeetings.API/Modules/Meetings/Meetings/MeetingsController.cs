using CompanyName.MyMeetings.API.Configuration.Authorization;
using CompanyName.MyMeetings.Modules.Meetings.Application.Contracts;
using CompanyName.MyMeetings.Modules.Meetings.Application.Meetings.CancelMeeting;
using CompanyName.MyMeetings.Modules.Meetings.Application.Meetings.CreateMeeting;
using CompanyName.MyMeetings.Modules.Meetings.Application.Meetings.GetMeetingDetails;
using Microsoft.AspNetCore.Mvc;

namespace CompanyName.MyMeetings.API.Modules.Meetings.Meetings
{
    [Route("api/meetings/meetings")]
    [ApiController]
    public class MeetingsController : ControllerBase
    {
        private readonly IMeetingsModule _meetingsModule;

        public MeetingsController(IMeetingsModule meetingsModule)
        {
            _meetingsModule = meetingsModule;
        }

        /// <summary>Everything about one meeting.</summary>
        [HttpGet("{meetingId}")]
        [HasPermission(MeetingsPermissions.GetMeetingDetails)]
        [ProducesResponseType(typeof(MeetingDetailsDto), StatusCodes.Status200OK)]
        public async Task<IActionResult> GetMeetingDetails(Guid meetingId)
        {
            var meetingDetails = await _meetingsModule.ExecuteQueryAsync(new GetMeetingDetailsQuery(meetingId));

            return Ok(meetingDetails);
        }

        [HttpPost("")]
        [HasPermission(MeetingsPermissions.CreateNewMeeting)]
        [ProducesResponseType(StatusCodes.Status200OK)]
        public async Task<IActionResult> CreateNewMeeting([FromBody] CreateMeetingRequest request)
        {
            await _meetingsModule.ExecuteCommandAsync(new CreateMeetingCommand(
                request.Title,
                request.TermStartDate,
                request.TermEndDate));

            return Ok();
        }

        [HttpPatch("{meetingId}/cancel")]
        [HasPermission(MeetingsPermissions.CancelMeeting)]
        public async Task<IActionResult> CancelMeeting(Guid meetingId)
        {
            await _meetingsModule.ExecuteCommandAsync(new CancelMeetingCommand(meetingId));

            return Ok();
        }
    }

    public class CreateMeetingRequest
    {
        public string Title { get; set; }

        public DateTime TermStartDate { get; set; }

        public DateTime TermEndDate { get; set; }

        public List<Guid> HostMemberIds { get; set; }
    }
}
