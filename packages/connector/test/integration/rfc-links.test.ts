/**
 * RFC Links Verification Test
 *
 * Validates that all RFC links in documentation are working and point to correct Interledger RFCs.
 *
 * Purpose:
 * - Ensure all RFC reference links return 200 OK status
 * - Verify links point to correct RFC pages (validate page titles)
 * - Prevent broken links in documentation
 *
 * Test Strategy:
 * - Fetch each RFC URL using native fetch API
 * - Check HTTP status is 200 OK
 * - Extract page title from HTML response
 * - Verify title matches expected RFC (case-insensitive keyword matching)
 *
 * Configured Timeout:
 * - 30 seconds per test (network requests can be slow)
 * - Set via jest.setTimeout() in beforeAll hook
 *
 * CI Integration:
 * - Run via npm script: npm run test:rfc-links
 * - Automated in GitHub Actions CI workflow
 *
 * Note: This test requires network connectivity to interledger.org
 */

// Skip RFC link tests unless explicitly enabled via RFC_LINKS_TEST=true
// These tests require network connectivity and can be flaky in CI
const describeIfRFCLinksEnabled = process.env.RFC_LINKS_TEST === 'true' ? describe : describe.skip;

describeIfRFCLinksEnabled('RFC Links Verification', () => {
  // Set timeout for network requests (30 seconds per test)
  beforeAll(() => {
    jest.setTimeout(30000);
  });

  /**
   * RFC Link Test Data
   *
   * Each entry defines:
   * - url: Full HTTPS URL to RFC page
   * - expectedTitle: Regex pattern to match page title (case-insensitive)
   *
   * Title validation ensures link points to correct RFC (not just any working page).
   */
  const rfcLinks = [
    {
      rfc: 'RFC-0027',
      url: 'https://interledger.org/developers/rfcs/interledger-protocol/',
      expectedTitle: /ILPv4|Interledger Protocol.*V4/i,
      description: 'Interledger Protocol v4 (ILPv4)',
    },
    {
      rfc: 'RFC-0023',
      url: 'https://interledger.org/developers/rfcs/bilateral-transfer-protocol/',
      expectedTitle: /Bilateral Transfer Protocol|BTP/i,
      description: 'Bilateral Transfer Protocol (BTP)',
    },
    {
      rfc: 'RFC-0030',
      url: 'https://interledger.org/developers/rfcs/oer-encoding/',
      expectedTitle: /OER.*Encoding/i,
      description: 'Notes on OER Encoding',
    },
    {
      rfc: 'RFC-0015',
      url: 'https://interledger.org/developers/rfcs/ilp-addresses/',
      expectedTitle: /ILP Address/i,
      description: 'ILP Addresses',
    },
    {
      rfc: 'RFC-0001',
      url: 'https://interledger.org/developers/rfcs/interledger-architecture/',
      expectedTitle: /Interledger Architecture/i,
      description: 'Interledger Architecture',
    },
  ];

  rfcLinks.forEach(({ rfc, url, expectedTitle, description }) => {
    it(`should return 200 OK and correct content for ${rfc}: ${description}`, async () => {
      // Fetch RFC page
      const response = await fetch(url);

      // Verify HTTP 200 OK status
      expect(response.status).toBe(200);
      expect(response.ok).toBe(true);

      // Extract HTML content
      const html = await response.text();

      // Validate HTML was returned (not empty response)
      expect(html.length).toBeGreaterThan(0);

      // Extract page title from HTML <title> tag
      const titleMatch = html.match(/<title>(.*?)<\/title>/i);
      expect(titleMatch).toBeTruthy();

      const pageTitle = titleMatch![1];

      // Verify title matches expected RFC keywords
      // This ensures link points to correct RFC page, not just any working page
      expect(pageTitle).toMatch(expectedTitle);

      // Log successful verification (helps with debugging in CI)
      console.log(`✓ ${rfc} verified: "${pageTitle}"`);
    });
  });

  /**
   * Additional RFC link from docs/stories/5.1.ilp-routing-documentation.md
   * RFC-0031: Dynamic Configuration Protocol (IL-DCP)
   */
  it('should return 200 OK and correct content for RFC-0031: Dynamic Configuration Protocol', async () => {
    const url = 'https://interledger.org/developers/rfcs/dynamic-configuration-protocol/';
    const expectedTitle = /Dynamic Configuration Protocol|IL-DCP|ILDCP/i;

    const response = await fetch(url);

    expect(response.status).toBe(200);
    expect(response.ok).toBe(true);

    const html = await response.text();
    expect(html.length).toBeGreaterThan(0);

    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
    expect(titleMatch).toBeTruthy();

    const pageTitle = titleMatch![1];
    expect(pageTitle).toMatch(expectedTitle);

    console.log(`✓ RFC-0031 verified: "${pageTitle}"`);
  });

  /**
   * Test general developer resources page
   * Referenced in docs/guides/ilp-routing.md
   */
  it('should return 200 OK for developers page with RFC resources', async () => {
    const url = 'https://interledger.org/developers/';

    const response = await fetch(url);

    expect(response.status).toBe(200);
    expect(response.ok).toBe(true);

    const html = await response.text();
    expect(html.length).toBeGreaterThan(0);

    console.log('✓ Developers page verified');
  });
});
