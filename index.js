const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const { JamClient } = require("jmap-jam");

const JMAP_SESSION_URL = process.env.JMAP_SESSION_URL || "https://api.fastmail.com/jmap/session";
const JMAP_TOKEN = process.env.JMAP_TOKEN || "";

const jam = new JamClient({
  sessionUrl: JMAP_SESSION_URL,
  bearerToken: JMAP_TOKEN,
});

const server = new McpServer({
  name: "Generic JMAP MCP",
  version: "0.1.0"
});

// Tool: Get mailboxes
server.tool(
  "get_mailboxes",
  z.object({}), // No input parameters needed for this tool
  async () => {
    const session = await jam.session;
    const accountId = session.primaryAccounts["urn:ietf:params:jmap:mail"];
    const [mailboxes] = await jam.api.Mailbox.get({ accountId });
    return {
      content: [{
        type: "text",
        text: JSON.stringify(mailboxes, null, 2)
      }]
    };
  }
);

// Tool: Fetch latest emails from a mailbox
server.tool(
  "fetch_latest_emails",
  {
    mailboxId: z.string(),
    limit: z.number().default(5)
  },
  async ({ mailboxId, limit }) => {
    const session = await jam.session;
    const accountId = session.primaryAccounts["urn:ietf:params:jmap:mail"];
    const [{ ids }] = await jam.api.Email.query({
      accountId,
      filter: { inMailbox: mailboxId },
      sort: [{ property: "receivedAt", isAscending: false }],
      limit
    });
    const [emails] = await jam.api.Email.get({
      accountId,
      ids,
      properties: ["id", "subject", "from", "receivedAt", "preview"]
    });
    return {
      content: [{
        type: "text",
        text: JSON.stringify(emails, null, 2)
      }]
    };
  }
);

// Tool: Get email content by ID
server.tool(
  "get_email_content",
  {
    emailId: z.string()
  },
  async ({ emailId }) => {
    const session = await jam.session;
    const accountId = session.primaryAccounts["urn:ietf:params:jmap:mail"];
    const [emails] = await jam.api.Email.get({
      accountId,
      ids: [emailId],
      properties: ["id", "textBody", "htmlBody", "subject", "from", "to", "cc", "bcc", "sentAt", "receivedAt"]
    });

    if (!emails || emails.list.length === 0) {
      return {
        content: [{
          type: "text",
          text: `Error: Email with ID ${emailId} not found.`
        }],
        isError: true
      };
    }

    const email = emails.list[0];
    //console.log("Raw email object from JMAP:", JSON.stringify(email, null, 2)); // Remove or keep for debugging

    let bodyContent = 'No body content found.';

    // Function to download and get content from a body part blob
    const downloadBodyPartContent = async (bodyPart) => {
      if (!bodyPart || !bodyPart.blobId) {
        return null;
      }
      try {
        // Use jmap-jam's downloadBlob method
        const response = await jam.downloadBlob({
          accountId,
          blobId: bodyPart.blobId,
          mimeType: bodyPart.type || 'application/octet-stream', // Use part type or a default
          fileName: bodyPart.name || 'body_part' // Use part name or a default
        });
        if (response.ok) {
          return response.text(); // Read the response body as text
        } else {
          console.error(`Failed to download blob ${bodyPart.blobId}: ${response.status} ${response.statusText}`);
          return null;
        }
      } catch (error) {
        console.error(`Error downloading blob ${bodyPart.blobId}:`, error);
        return null;
      }
    };

    // Prioritize text body, then HTML body
    if (email.textBody && email.textBody.length > 0) {
      // Assuming we only need the content of the first text part for simplicity
      const firstTextPart = email.textBody[0];
      const downloadedText = await downloadBodyPartContent(firstTextPart);
      if (downloadedText !== null) {
        bodyContent = downloadedText;
      }
    } else if (email.htmlBody && email.htmlBody.length > 0) {
       // Assuming we only need the content of the first html part for simplicity
      const firstHtmlPart = email.htmlBody[0];
      const downloadedHtml = await downloadBodyPartContent(firstHtmlPart);
       // Note: For HTML body, you might want to strip HTML tags for a text representation
      if (downloadedHtml !== null) {
        bodyContent = `[HTML Body - may contain tags]\n${downloadedHtml}`; // Indicate it's HTML
      }
    }

    return {
      content: [{
        type: "text",
        text: `Subject: ${email.subject || '(No Subject)'}\nFrom: ${email.from ? email.from.map(f => f.name ? `${f.name} <${f.email}>` : f.email).join(', ') : '(Unknown Sender)'}\nTo: ${email.to ? email.to.map(t => t.name ? `${t.name} <${t.email}>` : t.email).join(', ') : '(Unknown Recipient)'}\nDate: ${email.receivedAt || email.sentAt || '(Unknown Date)'}\n\n---\n\n${bodyContent}`
      }]
    };
  }
);

const transport = new StdioServerTransport();
server.connect(transport); 