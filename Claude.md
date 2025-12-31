# Claude Instructions for M2M Project

## Default UI Library: shadcn-ui

**shadcn-ui v4 is the default UI component library for this project.**

When building any user interface components, dashboards, forms, or interactive elements:

- **ALWAYS use shadcn-ui components** via the shadcn-ui MCP server
- **ALWAYS call `get_component_demo` first** to understand proper usage patterns before implementing
- **ALWAYS verify UI implementations** using Playwright MCP tools in the browser after building
- **DO NOT use other UI libraries** (Material-UI, Ant Design, Chakra UI, etc.) unless explicitly requested
- **DO NOT write custom UI components** for functionality that shadcn-ui already provides
- **Leverage shadcn-ui blocks** for complete UI patterns (dashboards, login pages, settings panels, etc.)

This ensures:

- Consistent design system across the application
- Built-in accessibility features
- Proper TypeScript typing
- Radix UI primitives for robust component behavior
- Tailwind CSS integration for styling

See the [shadcn/ui Component Integration](#shadcnui-component-integration) section below for detailed usage guidelines.

## Automatic Skill Usage

This project contains specialized RFC skills for Interledger Protocol specifications. **Automatically activate the relevant skill** when users ask questions related to any of these topics:

### RFC Skills Reference

1. **rfc-0001-interledger-architecture**
   - Topics: Interledger architecture, protocol layers, payment routing, ledger abstraction, system design
   - Triggers: "how Interledger works", "ILP architecture", "protocol stack", architectural concepts

2. **rfc-0009-simple-payment-setup-protocol**
   - Topics: Simple Payment Setup Protocol (SPSP), payment setup, receiver endpoints
   - Triggers: "SPSP", "payment setup", "receiver", payment initialization

3. **rfc-0015-ilp-addresses**
   - Topics: ILP addressing scheme, address format, hierarchical addressing
   - Triggers: "ILP address", "addressing", "address format", routing addresses

4. **rfc-0018-connector-risk-mitigations**
   - Topics: Connector security, risk management, fraud prevention
   - Triggers: "connector risk", "security", "fraud prevention", risk mitigation

5. **rfc-0019-glossary**
   - Topics: Interledger terminology, definitions, concept explanations
   - Triggers: "what is", "define", "terminology", "glossary"

6. **rfc-0022-hashed-timelock-agreements**
   - Topics: HTLAs, conditional payments, timelock mechanisms
   - Triggers: "HTLA", "hashed timelock", "conditional payment", escrow

7. **rfc-0023-bilateral-transfer-protocol**
   - Topics: BTP, bilateral transfers, ledger plugin protocol
   - Triggers: "BTP", "bilateral transfer", "ledger plugin"

8. **rfc-0026-payment-pointers**
   - Topics: Payment pointers, payment identifiers, addressing users
   - Triggers: "payment pointer", "$", payment identifier

9. **rfc-0027-interledger-protocol-4**
   - Topics: ILPv4, core protocol, packet format, routing, error codes
   - Triggers: "ILPv4", "ILP packet", "protocol format", "routing"

10. **rfc-0029-stream**
    - Topics: STREAM protocol, streaming payments, transport layer, flow control
    - Triggers: "STREAM", "streaming payment", "transport protocol", flow control

11. **rfc-0030-notes-on-oer-encoding**
    - Topics: OER encoding, data serialization, encoding format
    - Triggers: "OER", "encoding", "serialization", data format

12. **rfc-0031-dynamic-configuration-protocol**
    - Topics: Dynamic configuration, ILDCP, address discovery
    - Triggers: "ILDCP", "dynamic configuration", "address discovery"

13. **rfc-0032-peering-clearing-settlement**
    - Topics: Peering relationships, clearing, settlement processes
    - Triggers: "peering", "clearing", "settlement", connector relationships

14. **rfc-0033-relationship-between-protocols**
    - Topics: Protocol interactions, layer relationships, protocol stack
    - Triggers: "protocol relationships", "how protocols interact", protocol layers

15. **rfc-0034-connector-requirements**
    - Topics: Connector specifications, requirements, implementation guidelines
    - Triggers: "connector requirements", "connector implementation", connector specs

16. **rfc-0035-ilp-over-http**
    - Topics: HTTP transport, ILP over HTTP, transport bindings
    - Triggers: "ILP over HTTP", "HTTP transport", transport layer

17. **rfc-0038-settlement-engines**
    - Topics: Settlement engines, settlement API, payment settlement
    - Triggers: "settlement engine", "settlement API", settlement integration

18. **rfc-0039-stream-receipts**
    - Topics: STREAM receipts, payment receipts, proof of payment
    - Triggers: "receipt", "STREAM receipt", "proof of payment"

## Behavior Guidelines

- **Proactive Skill Activation**: When a user mentions any of the topics or trigger words above, immediately activate the corresponding skill without asking
- **Multiple Skills**: If a question spans multiple RFCs, activate all relevant skills
- **MCP Tool Usage**: Skills use the `mcp__interledger_org-v4_Docs__search_rfcs_documentation` tool to fetch authoritative information
- **Authoritative Answers**: Always base answers on the official RFC documentation accessed through skills
- **Cross-References**: When RFCs reference each other, mention related skills that might provide additional context

## Example Interactions

**User asks:** "How does STREAM work with ILPv4?"
**Action:** Activate both `rfc-0029-stream` and `rfc-0027-interledger-protocol-4` skills

**User asks:** "What's the payment pointer format?"
**Action:** Activate `rfc-0026-payment-pointers` skill

**User asks:** "Explain the Interledger architecture"
**Action:** Activate `rfc-0001-interledger-architecture` skill

## Important Notes

- Skills contain the most up-to-date and accurate information from the official Interledger RFCs
- Always prefer skill-based answers over general knowledge for RFC-related questions
- Skills automatically use MCP tools to fetch the latest documentation

## UI Development and Browser Verification

This project has the **Playwright MCP server** configured for browser automation, UI verification, and testing tasks.

### When to Use Playwright MCP Tools

**Automatically use Playwright MCP tools** whenever tasks involve:

- **UI Development**: Verifying UI components and layouts work correctly in the browser after implementation
- **Component Verification**: Testing that shadcn-ui components render and behave as expected
- **UI Testing**: Writing or running tests for user interface components
- **Browser Automation**: Automating interactions with web pages
- **Visual Verification**: Taking screenshots or snapshots of UI states
- **Form Interactions**: Filling out forms, clicking buttons, navigating pages
- **E2E Testing**: End-to-end testing scenarios involving browser interactions
- **UI Debugging**: Investigating UI issues, inspecting page elements
- **Accessibility Testing**: Using browser snapshots to verify accessibility
- **Integration Testing**: Testing web application flows and user journeys

### Available Playwright Tools

The following MCP tools are available (all prefixed with `mcp__playwright__browser_`):

- `snapshot`: Capture accessibility snapshots (preferred over screenshots for actions)
- `take_screenshot`: Take visual screenshots
- `navigate`: Navigate to URLs
- `click`: Click elements
- `type`: Type text into fields
- `fill_form`: Fill multiple form fields
- `evaluate`: Run JavaScript on the page
- `wait_for`: Wait for elements or conditions
- `network_requests`: Monitor network activity
- `console_messages`: View console output
- And more...

### Behavior Guidelines

- **UI Development Workflow**: After implementing or modifying UI components, use Playwright tools to verify they work correctly in the browser
- **Proactive Tool Usage**: When a task mentions UI, frontend, browser, or testing, immediately consider using Playwright tools
- **Prefer Snapshots**: Use `browser_snapshot` over `take_screenshot` when you need to interact with the page
- **Component Verification**: When building with shadcn-ui, use Playwright to verify the component renders and functions properly
- **Test Writing**: When writing UI tests, use Playwright tools to validate the implementation
- **Documentation**: Reference Playwright MCP capabilities when suggesting UI testing approaches

### Example Scenarios

**User asks:** "Add a contact form to the page"
**Action:**

1. Use shadcn-ui MCP to get form component demos
2. Implement the contact form with shadcn-ui components
3. Use Playwright MCP to navigate to the page and verify the form renders correctly
4. Use Playwright to test form interactions (filling fields, validation, submission)

**User asks:** "Test the login form"
**Action:** Use Playwright MCP tools to navigate to the page, fill the form, and verify the behavior

**User asks:** "Check if the button is visible"
**Action:** Use `browser_snapshot` to inspect the page state

**User asks:** "Debug why the form submission isn't working"
**Action:** Use Playwright tools to inspect console messages and network requests

## shadcn/ui Component Integration

**shadcn-ui v4 is the default UI library for this project.** The shadcn-ui MCP server is configured to provide direct access to component patterns, source code, and implementation examples.

**Use shadcn-ui for ALL UI development** unless explicitly directed otherwise.

### When to Use shadcn-ui MCP Tools

**Use shadcn-ui MCP tools for ALL UI development tasks**, including:

- **Any UI Component**: Buttons, forms, inputs, dialogs, dropdowns, tables, cards, etc.
- **Layouts**: Building page layouts, dashboards, navigation, sidebars
- **Forms**: Creating form inputs, validation, submission workflows
- **Data Display**: Tables, lists, grids, charts integration
- **Feedback**: Alerts, toasts, modals, loading states
- **Navigation**: Menus, tabs, breadcrumbs, pagination
- **Component Selection**: Choosing the right component for any UI need
- **Implementation Patterns**: Learning how to properly use and configure components
- **Design System**: Ensuring consistent UI patterns across the application
- **Accessibility**: Leveraging built-in accessibility features

### Available shadcn-ui Tools

The following MCP tools are available (all prefixed with `mcp__shadcn-ui__`):

- `list_components`: Get all available shadcn/ui v4 components
- `get_component_demo`: **Get demo code showing how to use a component (USE THIS FIRST)**
- `get_component`: Get the source code for a specific component
- `get_component_metadata`: Get metadata for a component (dependencies, props, etc.)
- `list_blocks`: Get available pre-built component blocks (dashboards, login forms, etc.)
- `get_block`: Get source code for complete UI blocks
- `get_directory_structure`: Explore the shadcn-ui repository structure

### Critical Workflow: Demo First, Then Source

**ALWAYS use `get_component_demo` BEFORE `get_component`**

This is crucial because:

1. **Understanding Context**: Demos show you HOW and WHY to use a component
2. **Usage Patterns**: See real-world examples with proper imports, props, and configurations
3. **Common Scenarios**: Learn the most common use cases before diving into implementation
4. **Props and API**: Understand the component's API through practical examples
5. **Avoid Mistakes**: Prevent incorrect usage by seeing the recommended patterns first

### Behavior Guidelines

- **Default First**: For ANY UI task, automatically use shadcn-ui components - this is not optional
- **Demo First**: When implementing any shadcn/ui component, ALWAYS fetch the demo first with `get_component_demo`
- **Explain Usage**: After fetching the demo, explain how the component is typically used
- **Source Second**: Only fetch the source code with `get_component` if you need to understand internals or customize
- **Metadata for Context**: Use `get_component_metadata` to understand dependencies and requirements
- **Blocks for Complex UIs**: Suggest `list_blocks` and `get_block` for complete UI patterns like dashboards or login pages
- **List First**: When unsure which component to use, call `list_components` to see all options
- **No Alternatives**: Do not suggest or use alternative UI libraries unless the user explicitly requests them

### Example Scenarios

**User asks:** "Add a button to the form"
**Action:**

1. Call `get_component_demo` with componentName: "button" to see usage examples
2. Explain the different button variants and use cases from the demo
3. Only call `get_component` if customization of the button source is needed

**User asks:** "I need a data table with sorting"
**Action:**

1. Call `get_component_demo` with componentName: "table" to see implementation patterns
2. Show how to integrate sorting from the demo examples
3. Fetch source with `get_component` only if deep customization is required

**User asks:** "Create a settings page with tabs"
**Action:**

1. Call `get_component_demo` with componentName: "tabs" first
2. Review the demo to understand tab structure and navigation patterns
3. Implement following the demo patterns

**User asks:** "What UI components are available?"
**Action:** Call `list_components` to show all available shadcn/ui components

**User asks:** "Build a dashboard layout"
**Action:**

1. Call `list_blocks` with category: "dashboard"
2. Call `get_block` to fetch complete dashboard patterns
3. Reference component demos as needed for individual components

### Important Notes

- **v4 Specific**: These tools access shadcn/ui v4, which may have different APIs than earlier versions
- **Always Demo First**: This cannot be overstated - demos prevent implementation errors and save time
- **Blocks for Speed**: Use blocks for complete UI patterns rather than building from scratch
- **Metadata Matters**: Check metadata before using a component to ensure all dependencies are installed
