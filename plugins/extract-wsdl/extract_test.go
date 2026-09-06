package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

func TestWSDLBecomesStructuredExternalAPI(t *testing.T) {
	root := t.TempDir()
	spec := `<definitions xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:tns="urn:payments" name="Payments" targetNamespace="urn:payments">
  <types><xsd:schema targetNamespace="urn:payments"><xsd:element name="Pay"><xsd:complexType><xsd:sequence><xsd:element name="amount" type="xsd:decimal"/></xsd:sequence></xsd:complexType></xsd:element></xsd:schema></types>
  <message name="PayRequest"><part name="body" element="tns:Pay"/></message>
  <message name="PayResponse"><part name="id" type="xsd:string"/></message>
  <portType name="PaymentsPortType"><operation name="Pay"><input message="tns:PayRequest"/><output message="tns:PayResponse"/></operation></portType>
  <binding name="PaymentsBinding" type="tns:PaymentsPortType"><soap:binding style="document"/><operation name="Pay"><soap:operation soapAction="urn:pay"/></operation></binding>
  <service name="PaymentsService"><port name="PaymentsPort" binding="tns:PaymentsBinding"><soap:address location="https://pay.example/soap"/></port></service>
</definitions>`
	if err := os.WriteFile(filepath.Join(root, "payments.wsdl"), []byte(spec), 0o644); err != nil {
		t.Fatal(err)
	}
	resp, err := extract(plugin.Input{Root: root, Commit: "abc", GeneratedAt: "2026-01-01T00:00:00Z"}, Options{Mode: "external", Spec: "payments.wsdl"})
	if err != nil {
		t.Fatal(err)
	}
	var got catalog.Catalog
	if err := json.Unmarshal([]byte(resp.Files[0].Contents), &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Externals) != 1 || got.Externals[0].ID != "payments" || got.Externals[0].URL != "https://pay.example/soap" {
		t.Fatalf("externals = %+v", got.Externals)
	}
	provided := got.Externals[0].Provides[0]
	if provided.ID != "paymentsservice.soap.PaymentsPort" || provided.Source != "payments.wsdl" || len(provided.Messages) != 2 {
		t.Fatalf("provided = %+v", provided)
	}
	method := provided.Methods[0]
	if method.Request != "PayRequest" || method.Response != "PayResponse" || method.SOAP == nil || method.SOAP.Action != "urn:pay" || method.SOAP.Version != "1.1" {
		t.Fatalf("method = %+v", method)
	}
}
