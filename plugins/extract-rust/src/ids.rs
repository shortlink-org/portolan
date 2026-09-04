//! How a name in the source becomes an id in the catalog. These are the rules
//! extract-go and extract-ts live by, spelled the same, so a service in any of
//! the three languages with the same aggregate gets the same id.

/// PriceList → price-list, Address → address, ID → id, email.Address → email-address.
pub fn slug(name: &str) -> String {
    let chars: Vec<char> = name.chars().collect();
    let mut out = String::new();
    for (i, &c) in chars.iter().enumerate() {
        let upper = c.is_ascii_uppercase();
        if upper && i > 0 {
            let prev = chars[i - 1];
            let next = chars.get(i + 1).copied();
            let prev_lower = prev.is_ascii_lowercase();
            let next_lower = next.is_some_and(|n| n.is_ascii_lowercase());
            if prev_lower || next_lower {
                out.push('-');
            }
        }
        let r = if upper { c.to_ascii_lowercase() } else { c };
        out.push(if r == '_' || r == '.' { '-' } else { r });
    }
    while out.contains("--") {
        out = out.replace("--", "-");
    }
    out.trim_matches('-').to_string()
}

/// change_password → ChangePassword: the operation id a directory name becomes.
pub fn camel(name: &str) -> String {
    name.split(['_', '-'])
        .filter(|w| !w.is_empty())
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                Some(first) => first.to_ascii_uppercase().to_string() + c.as_str(),
                None => String::new(),
            }
        })
        .collect()
}

/// price_list → Price List: the human name for a directory.
pub fn title(name: &str) -> String {
    name.split(['_', '-'])
        .filter(|w| !w.is_empty())
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                Some(first) => first.to_ascii_uppercase().to_string() + c.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// A directory name in PascalCase, which is what its root struct is called.
pub fn pascal(name: &str) -> String {
    camel(name)
}

/// A slug written the way a person would: one capital at the front.
pub fn sentence(s: &str) -> String {
    let mut words: Vec<String> = s.split('-').map(String::from).collect();
    if let Some(first) = words.first_mut() {
        let mut c = first.chars();
        if let Some(f) = c.next() {
            *first = f.to_ascii_uppercase().to_string() + c.as_str();
        }
    }
    words.join(" ")
}

/// GetOrder and get_order are one name: an rpc in the proto and the method
/// that answers it, compared with case and underscores set aside.
pub fn same_name(a: &str, b: &str) -> bool {
    let fold = |s: &str| s.chars().filter(|c| *c != '_').map(|c| c.to_ascii_lowercase()).collect::<String>();
    fold(a) == fold(b)
}

pub fn service_id(context: &str, service: &str) -> String {
    format!("{context}.{service}")
}
pub fn aggregate_id(service: &str, aggregate: &str) -> String {
    format!("{service}.{aggregate}")
}
pub fn block_id(aggregate: &str, block: &str) -> String {
    format!("{aggregate}.{block}")
}
pub fn event_id(aggregate: &str, name: &str) -> String {
    format!("{aggregate}.{name}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugs_the_way_the_other_extractors_do() {
        assert_eq!(slug("PriceList"), "price-list");
        assert_eq!(slug("OrderPlaced"), "order-placed");
        assert_eq!(slug("ID"), "id");
        assert_eq!(slug("get_order"), "get-order");
        assert_eq!(slug("GetOrder"), "get-order");
    }

    #[test]
    fn names_a_directory_three_ways() {
        assert_eq!(camel("place_order"), "PlaceOrder");
        assert_eq!(title("price_list"), "Price List");
        assert_eq!(sentence("get-order"), "Get order");
        assert!(same_name("GetOrder", "get_order"));
    }
}
