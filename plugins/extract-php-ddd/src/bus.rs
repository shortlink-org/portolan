//! The bus, as the tree spells it. Domain events go out on one RabbitMQ
//! exchange under their wire names; each subscriber has a queue of its own,
//! named after its class the way `RabbitMqQueueNameFormatter` names it -
//! vendor, context, module and class in snake case, joined by dots -
//! bound to the events it subscribes to. The exchange's name is an
//! environment variable in the code, so the manifest says it.

/// `CodelyTv\Mooc\CoursesCounter\Application\Increment\IncrementCoursesCounterOnCourseCreated`
/// → `codelytv.mooc.courses_counter.increment_courses_counter_on_course_created`.
pub fn queue_name(subscriber: &str) -> String {
    let parts: Vec<&str> = subscriber.split('\\').filter(|p| !p.is_empty()).collect();
    if parts.len() < 3 {
        return snake(subscriber);
    }
    let last = parts[parts.len() - 1];
    let picked: Vec<&str> = if parts.len() == 3 { vec![parts[1], parts[2]] } else { vec![parts[1], parts[2], last] };
    std::iter::once(parts[0].to_ascii_lowercase()).chain(picked.iter().map(|p| snake(p))).collect::<Vec<_>>().join(".")
}

/// `CoursesCounter` → `courses_counter`, `CodelyTv` → `codelytv`: the vendor
/// segment is lowercased whole, as the formatter does with a replace, and
/// every other segment gets an underscore before each capital.
fn snake(s: &str) -> String {
    let mut out = String::new();
    let chars: Vec<char> = s.chars().collect();
    for (i, c) in chars.iter().enumerate() {
        if c.is_ascii_uppercase() {
            let prev_lower = i > 0 && (chars[i - 1].is_ascii_lowercase() || chars[i - 1].is_ascii_digit());
            let next_lower = chars.get(i + 1).is_some_and(|n| n.is_ascii_lowercase());
            if i > 0 && (prev_lower || (next_lower && chars[i - 1] != '_')) {
                out.push('_');
            }
            out.push(c.to_ascii_lowercase());
        } else {
            out.push(*c);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_a_queue_the_way_the_formatter_does() {
        assert_eq!(
            queue_name("CodelyTv\\Mooc\\CoursesCounter\\Application\\Increment\\IncrementCoursesCounterOnCourseCreated"),
            "codelytv.mooc.courses_counter.increment_courses_counter_on_course_created"
        );
        assert_eq!(queue_name("CodelyTv\\Analytics\\DomainEvents\\Application\\Store\\StoreDomainEventOnOccurred"), "codelytv.analytics.domain_events.store_domain_event_on_occurred");
    }
}
