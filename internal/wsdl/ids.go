package wsdl

import (
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"unicode"
)

var versionInSource = regexp.MustCompile(`(?i)(?:^|[_-])(\d+(?:\.\d+)+)(?:[_-]|\.wsdl$)`)

// APIID is the stable prefix shared by the contract extractor and call-site
// analyzer. WSDL has no standard version field, so the protocol is the suffix.
func APIID(contract Contract) string {
	name := Slug(contract.Name)
	if name == "" {
		name = "soap"
	}
	return name + ".soap"
}

// APIIDs resolves the case WSDL itself cannot: two checked-in versions may
// repeat the same service, port and targetNamespace. Only colliding interface
// ids receive a source-backed version suffix, so an unrelated file rename does
// not churn stable ids.
func APIIDs(contracts []Contract) map[string]string {
	bases := map[string]int{}
	for _, contract := range contracts {
		base := APIID(contract)
		for _, iface := range contract.Interfaces {
			bases[InterfaceID(base, iface)]++
		}
	}
	out := map[string]string{}
	for index, contract := range contracts {
		base := APIID(contract)
		collides := false
		for _, iface := range contract.Interfaces {
			if bases[InterfaceID(base, iface)] > 1 {
				collides = true
				break
			}
		}
		if collides {
			version := sourceVersion(contract.Source)
			if version == "" {
				version = Slug(strings.TrimSuffix(filepath.Base(contract.Source), filepath.Ext(contract.Source)))
			}
			if version == "" {
				version = "copy-" + strconv.Itoa(index+1)
			}
			base += ".v" + strings.ReplaceAll(strings.TrimPrefix(version, "v"), ".", "-")
		}
		out[ContractKey(contract)] = base
	}
	return out
}

func ContractKey(contract Contract) string {
	return contract.Source + "\x00" + contract.Name
}

func sourceVersion(source string) string {
	match := versionInSource.FindStringSubmatch(filepath.Base(source))
	if len(match) > 1 {
		return match[1]
	}
	return ""
}

// InterfaceID keeps distinct WSDL ports distinct. A document commonly exposes
// SOAP 1.1 and 1.2 ports with the same operations but different bindings.
func InterfaceID(api string, iface Interface) string {
	name := title(iface.Name)
	if name == "" {
		name = title(iface.PortType)
	}
	if name == "" {
		return api
	}
	return api + "." + name
}

func CallID(api string, iface Interface, operation Operation) string {
	return InterfaceID(api, iface) + "/" + operation.Name
}

func ExternalID(contract Contract) string {
	id := Slug(contract.Name)
	id = strings.TrimSuffix(id, "-service")
	id = strings.TrimSuffix(id, "service")
	id = strings.TrimSuffix(id, "-soap")
	if id == "" {
		return "soap-peer"
	}
	return id
}

func Slug(value string) string {
	var out strings.Builder
	dash := false
	for _, r := range strings.ToLower(strings.TrimSpace(value)) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			out.WriteRune(r)
			dash = false
		} else if out.Len() > 0 && !dash {
			out.WriteByte('-')
			dash = true
		}
	}
	return strings.Trim(out.String(), "-")
}

func title(value string) string {
	var out strings.Builder
	for _, word := range strings.FieldsFunc(value, func(r rune) bool {
		return r == '-' || r == '_' || unicode.IsSpace(r)
	}) {
		runes := []rune(word)
		if len(runes) > 0 {
			runes[0] = unicode.ToUpper(runes[0])
			out.WriteString(string(runes))
		}
	}
	return out.String()
}
