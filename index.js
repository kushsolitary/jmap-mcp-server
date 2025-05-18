#!/usr/bin/env node

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const { JamClient } = require("jmap-jam");

const JMAP_SESSION_URL = process.env.JMAP_SESSION_URL || "https://api.fastmail.com/jmap/session";

const args = process.argv.slice(2);
let JMAP_TOKEN = process.env.JMAP_TOKEN || "";

if (args.length > 0 && args[0]) {
  JMAP_TOKEN = args[0];
}

const jam = new JamClient({
  sessionUrl: JMAP_SESSION_URL,
  bearerToken: JMAP_TOKEN,
});

const server = new McpServer({
  name: "JMAP MCP",
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
    limit: z.number().default(15),
    excludeMailboxIds: z.array(z.string()).optional(),
    receivedBefore: z.string().datetime().optional(), // Expect ISO 8601 date-time string
    receivedAfter: z.string().datetime().optional(),  // Expect ISO 8601 date-time string
    hasKeyword: z.string().optional(),
    notKeyword: z.string().optional(),
    hasAttachment: z.boolean().optional(),
    searchText: z.string().optional(),
    searchFrom: z.string().optional(),
    searchTo: z.string().optional(),
    searchCc: z.string().optional(),
    searchBcc: z.string().optional(),
    searchSubject: z.string().optional(),
    searchBody: z.string().optional()
  },
  async (inputs) => {
    try {
      const {
        mailboxId,
        limit,
        excludeMailboxIds,
        receivedBefore,
        receivedAfter,
        hasKeyword,
        notKeyword,
        hasAttachment,
        searchText,
        searchFrom,
        searchTo,
        searchCc,
        searchBcc,
        searchSubject,
        searchBody
      } = inputs;

      const session = await jam.session;
      const accountId = session.primaryAccounts["urn:ietf:params:jmap:mail"];

      // Construct the filter object based on provided inputs
      const filter = { inMailbox: mailboxId };
      if (excludeMailboxIds && excludeMailboxIds.length > 0) {
        filter.inMailboxOtherThan = excludeMailboxIds;
      }
      if (receivedBefore) {
        filter.before = receivedBefore;
      }
      if (receivedAfter) {
        filter.after = receivedAfter;
      }
      if (hasKeyword) {
        filter.hasKeyword = hasKeyword;
      }
      if (notKeyword) {
        filter.notKeyword = notKeyword;
      }
      if (typeof hasAttachment === 'boolean') {
        filter.hasAttachment = hasAttachment;
      }
      if (searchText) {
        filter.text = searchText;
      }
      if (searchFrom) {
        filter.from = searchFrom;
      }
      if (searchTo) {
        filter.to = searchTo;
      }
      if (searchCc) {
        filter.cc = searchCc;
      }
      if (searchBcc) {
        filter.bcc = searchBcc;
      }
      if (searchSubject) {
        filter.subject = searchSubject;
      }
      if (searchBody) {
        filter.body = searchBody;
      }

      const [results] = await jam.requestMany(b => {
        // 1. Query for the latest thread exemplar email IDs
        const queryEmailsDraft = b.Email.query({
          accountId,
          filter: filter, // Use the constructed filter object
          sort: [{ property: "receivedAt", isAscending: false }],
          position: 0,
          collapseThreads: true, // Collapse to get thread exemplars
          limit: limit // Limit the number of threads
        });

        // 2. Fetch the threadId of each of those exemplar messages
        const getThreadIdsDraft = b.Email.get({
          accountId,
          ids: queryEmailsDraft.$ref('/ids'), // Use $ref on the draft variable
          properties: ["threadId"]
        });

        // 3. Get the emailIds of the messages in those threads
        const getThreadEmailsDraft = b.Thread.get({
          accountId,
          ids: getThreadIdsDraft.$ref('/list/*/threadId'), // Use $ref on the draft variable
        });

        // 4. Finally we get the data for all those emails
        const getEmailDetailsDraft = b.Email.get({
          accountId,
          ids: getThreadEmailsDraft.$ref('/list/*/emailIds'), // Use $ref on the draft variable
          properties: ["id", "subject", "from", "receivedAt", "preview", "mailboxIds"]
        });

        return {
          queryEmails: queryEmailsDraft,
          getThreadIds: getThreadIdsDraft,
          getThreadEmails: getThreadEmailsDraft,
          getEmailDetails: getEmailDetailsDraft
        };
      });

      return {
        content: [{
          type: "text",
          text: JSON.stringify(results.getEmailDetails.list, null, 2)
        }]
      };
    } catch (error) {
      console.error("Error in fetch_latest_emails:", error);
      return {
        content: [{
          type: "text",
          text: `Error fetching emails: ${JSON.stringify(error) || 'Unknown error'}`
        }],
        isError: true
      };
    }
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

    let bodyContent = 'No body content found.';

    const downloadBodyPartContent = async (bodyPart) => {
      if (!bodyPart || !bodyPart.blobId) {
        return null;
      }
      try {
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