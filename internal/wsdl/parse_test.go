package wsdl

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeFixture(t *testing.T, root, name, contents string) {
	t.Helper()
	path := filepath.Join(root, name)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(contents), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestReadJoinsImportedPortTypeBindingAndSchema(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, "types.xsd", `
<xsd:schema xmlns:xsd="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:booking" xmlns:tns="urn:booking">
  <xsd:complexType name="CancelRequestType">
    <xsd:sequence>
      <xsd:element name="bookingId" type="xsd:string"/>
      <xsd:element name="passengerIds" type="xsd:string" maxOccurs="unbounded"/>
    </xsd:sequence>
  </xsd:complexType>
  <xsd:element name="CancelRequest" type="tns:CancelRequestType"/>
  <xsd:element name="CancelResponse">
    <xsd:complexType><xsd:sequence><xsd:element name="accepted" type="xsd:boolean"/></xsd:sequence></xsd:complexType>
  </xsd:element>
</xsd:schema>`)
	writeFixture(t, root, "contract.wsdl", `
<wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:tns="urn:booking" targetNamespace="urn:booking">
  <wsdl:types><xsd:schema targetNamespace="urn:booking"><xsd:import namespace="urn:booking" schemaLocation="types.xsd"/></xsd:schema></wsdl:types>
  <wsdl:message name="CancelRequestMessage"><wsdl:part name="body" element="tns:CancelRequest"/></wsdl:message>
  <wsdl:message name="CancelResponseMessage"><wsdl:part name="body" element="tns:CancelResponse"/></wsdl:message>
  <wsdl:message name="BookingFault"><wsdl:part name="reason" type="xsd:string"/></wsdl:message>
  <wsdl:portType name="BookingPortType">
    <wsdl:operation name="CancelBooking">
      <wsdl:documentation>Cancels a booking.</wsdl:documentation>
      <wsdl:input message="tns:CancelRequestMessage"/>
      <wsdl:output message="tns:CancelResponseMessage"/>
      <wsdl:fault name="BookingFault" message="tns:BookingFault"/>
    </wsdl:operation>
  </wsdl:portType>
</wsdl:definitions>`)
	writeFixture(t, root, "service.wsdl", `
<wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/" xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/" xmlns:soap12="http://schemas.xmlsoap.org/wsdl/soap12/" xmlns:tns="urn:booking" targetNamespace="urn:booking" name="BookingDefinitions">
  <wsdl:import namespace="urn:booking" location="contract.wsdl"/>
  <wsdl:binding name="BookingBinding" type="tns:BookingPortType">
    <soap12:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
    <wsdl:operation name="CancelBooking">
      <soap12:operation soapAction="urn:booking:cancel"/>
      <wsdl:input><soap12:body use="literal"/><soap12:header message="tns:BookingFault" part="reason" use="literal"/></wsdl:input>
    </wsdl:operation>
  </wsdl:binding>
  <wsdl:binding name="BookingBinding11" type="tns:BookingPortType">
    <soap:binding style="rpc" transport="http://schemas.xmlsoap.org/soap/http"/>
    <wsdl:operation name="CancelBooking"><soap:operation soapAction="urn:booking:cancel:v1"/></wsdl:operation>
  </wsdl:binding>
  <wsdl:service name="BookingService">
    <wsdl:documentation>Booking supplier API.</wsdl:documentation>
    <wsdl:port name="BookingPort" binding="tns:BookingBinding"><soap12:address location="https://booking.example/soap"/></wsdl:port>
    <wsdl:port name="BookingPort11" binding="tns:BookingBinding11"><soap:address location="https://booking.example/soap/v1"/></wsdl:port>
  </wsdl:service>
</wsdl:definitions>`)

	result, err := Read(root, "service.wsdl")
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Contracts) != 1 {
		t.Fatalf("contracts = %+v", result.Contracts)
	}
	contract := result.Contracts[0]
	if contract.Name != "BookingService" || contract.Summary != "Booking supplier API." || contract.Source != "service.wsdl" {
		t.Fatalf("contract = %+v", contract)
	}
	if len(contract.Interfaces) != 2 {
		t.Fatalf("interfaces = %+v", contract.Interfaces)
	}
	var iface Interface
	for _, candidate := range contract.Interfaces {
		if candidate.Name == "BookingPort" {
			iface = candidate
		}
	}
	if iface.Name != "BookingPort" || iface.PortType != "BookingPortType" || iface.Binding != "BookingBinding" || iface.Version != "1.2" || iface.Style != "document" || iface.Endpoint != "https://booking.example/soap" {
		t.Fatalf("interface = %+v", iface)
	}
	if len(iface.Operations) != 1 {
		t.Fatalf("operations = %+v", iface.Operations)
	}
	op := iface.Operations[0]
	if op.Action != "urn:booking:cancel" || op.Request != "CancelRequestMessage" || op.Response != "CancelResponseMessage" || strings.Join(op.Faults, ",") != "BookingFault" || strings.Join(op.Headers, ",") != "BookingFault.reason" {
		t.Fatalf("operation = %+v", op)
	}
	messages := map[string]Message{}
	for _, message := range iface.Messages {
		messages[message.Name] = message
	}
	request := messages["CancelRequestMessage"]
	if len(request.Fields) != 2 || request.Fields[0].Name != "bookingId" || request.Fields[0].Type != "string" || request.Fields[1].Type != "string[]" {
		t.Fatalf("request = %+v", request)
	}
	response := messages["CancelResponseMessage"]
	if len(response.Fields) != 1 || response.Fields[0].Name != "accepted" || response.Fields[0].Type != "boolean" {
		t.Fatalf("response = %+v", response)
	}
}

func TestRemoteImportsAreWarningsAndNeverFetched(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, "service.wsdl", `
<definitions xmlns="http://schemas.xmlsoap.org/wsdl/" targetNamespace="urn:local">
  <import namespace="urn:remote" location="https://example.invalid/remote.wsdl"/>
  <portType name="Local"><operation name="Ping"/></portType>
</definitions>`)
	result, err := Read(root, "service.wsdl")
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Warnings) != 1 || !strings.Contains(result.Warnings[0], "remote import") {
		t.Fatalf("warnings = %v", result.Warnings)
	}
	if len(result.Contracts) != 1 || len(result.Contracts[0].Interfaces) != 1 {
		t.Fatalf("contracts = %+v", result.Contracts)
	}
}

// A schema copied beside every document that uses it is one finding per
// namespace, naming the file whose declarations were kept and the files that
// repeat them. It goes out as a schema warning, not a resolution one, so only
// the extractor publishing the contracts reports it.
func TestDuplicateDeclarationsAreSummarisedWithTheirOrigin(t *testing.T) {
	root := t.TempDir()
	schema := `
<schema xmlns="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:common">
  <complexType name="CodeType"/>
  <complexType name="AmountType"/>
  <element name="Ping"/>
</schema>`
	writeFixture(t, root, "a/common.xsd", schema)
	writeFixture(t, root, "b/common.xsd", schema)
	writeFixture(t, root, "c/common.xsd", schema)
	writeFixture(t, root, "service.wsdl", `
<definitions xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:local">
  <types>
    <xs:schema><xs:import namespace="urn:common" schemaLocation="a/common.xsd"/></xs:schema>
    <xs:schema><xs:import namespace="urn:common" schemaLocation="b/common.xsd"/></xs:schema>
    <xs:schema><xs:import namespace="urn:common" schemaLocation="c/common.xsd"/></xs:schema>
  </types>
  <portType name="Local"><operation name="Ping"/></portType>
</definitions>`)
	result, err := Read(root, "service.wsdl")
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Warnings) != 0 {
		t.Errorf("resolution warnings = %v, want none", result.Warnings)
	}
	want := "b/common.xsd: duplicate declaration CodeType and 2 more in namespace urn:common (also in c/common.xsd); the declarations in a/common.xsd are used"
	if len(result.SchemaWarnings) != 1 || result.SchemaWarnings[0] != want {
		t.Fatalf("schema warnings = %v\nwant [%s]", result.SchemaWarnings, want)
	}
}
