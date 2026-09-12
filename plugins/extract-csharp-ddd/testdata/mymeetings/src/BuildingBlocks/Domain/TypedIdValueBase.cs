namespace CompanyName.MyMeetings.BuildingBlocks.Domain
{
    public abstract class TypedIdValueBase
    {
        public Guid Value { get; }

        protected TypedIdValueBase(Guid value)
        {
            Value = value;
        }
    }
}
