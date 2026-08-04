export const buildZatcaInvoiceXml = (invoiceData: any): string => {
  // This is a simplified mock of the ZATCA UBL 2.1 XML structure
  // A true implementation requires mapping ~100+ business rules and nested XML tags.
  
  const issueDate = new Date().toISOString().split('T')[0];
  const issueTime = new Date().toISOString().split('T')[1].split('.')[0];
  
  const xmlTemplate = `
<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
    <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
    <cbc:ID>${invoiceData.invoiceNumber}</cbc:ID>
    <cbc:UUID>${invoiceData.uuid}</cbc:UUID>
    <cbc:IssueDate>${issueDate}</cbc:IssueDate>
    <cbc:IssueTime>${issueTime}</cbc:IssueTime>
    <cbc:InvoiceTypeCode name="0111010">388</cbc:InvoiceTypeCode>
    <cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode>
    
    <cac:AccountingSupplierParty>
        <cac:Party>
            <cac:PartyIdentification>
                <cbc:ID schemeID="CRN">1234567890</cbc:ID>
            </cac:PartyIdentification>
            <cac:PartyTaxScheme>
                <cbc:CompanyID>300000000000003</cbc:CompanyID>
                <cac:TaxScheme>
                    <cbc:ID>VAT</cbc:ID>
                </cac:TaxScheme>
            </cac:PartyTaxScheme>
            <cac:PartyLegalEntity>
                <cbc:RegistrationName>GRC Wisdom SaaS</cbc:RegistrationName>
            </cac:PartyLegalEntity>
        </cac:Party>
    </cac:AccountingSupplierParty>

    <cac:LegalMonetaryTotal>
        <cbc:TaxExclusiveAmount currencyID="SAR">${invoiceData.amountBeforeTax}</cbc:TaxExclusiveAmount>
        <cbc:TaxInclusiveAmount currencyID="SAR">${invoiceData.amountWithTax}</cbc:TaxInclusiveAmount>
        <cbc:PayableAmount currencyID="SAR">${invoiceData.amountWithTax}</cbc:PayableAmount>
    </cac:LegalMonetaryTotal>
</Invoice>
  `.trim();

  return xmlTemplate;
};
