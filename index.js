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

/*
JMAP MCP Server Tools Documentation
==================================

Available Tools:

1. get_mailboxes
   - Description: Retrieves all mailboxes for the authenticated JMAP account.
   - Input: None
   - Output: JSON array of mailbox objects.

2. search_emails
   - Description: Searches for emails in a specified mailbox, with optional filters and search parameters. Returns thread exemplars and their details.
   - Input (object):
       - mailboxId (string, required): The mailbox to search in.
       - limit (number, optional, default 15): Max number of threads/emails to return.
       - excludeMailboxIds (array of strings, optional): Mailboxes to exclude.
       - receivedBefore (string, ISO 8601, optional): Only emails received before this date.
       - receivedAfter (string, ISO 8601, optional): Only emails received after this date.
       - hasKeyword (string, optional): Only emails with this keyword.
       - notKeyword (string, optional): Only emails without this keyword.
       - hasAttachment (boolean, optional): Only emails with/without attachments.
       - searchText (string, optional): Full-text search.
       - searchFrom, searchTo, searchCc, searchBcc (string, optional): Filter by sender/recipient.
       - searchSubject (string, optional): Filter by subject.
       - searchBody (string, optional): Filter by body content.
   - Output: JSON array of email objects (id, subject, from, receivedAt, preview, mailboxIds).

3. get_email_content
   - Description: Retrieves the full content of an email by its ID, including subject, sender, recipients, date, and body (text or HTML).
   - Input (object):
       - emailId (string, required): The ID of the email to fetch.
   - Output: Text content with subject, from, to, date, and body.
*/

// Tool: Get mailboxes
server.tool(
  "get_mailboxes",
  {
    description: "Retrieves all mailboxes for the authenticated JMAP account.",
    input: z.object({}), // No input parameters needed for this tool
  },
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
  "search_emails",
  {
    description: "Searches for emails in a specified mailbox, with optional filters and search parameters. Returns thread exemplars and their details.",
    input: {
      mailboxId: z.string().describe("The mailbox to search in."),
      limit: z.number().default(15).describe("Max number of threads/emails to return."),
      excludeMailboxIds: z.array(z.string()).optional().describe("Mailboxes to exclude."),
      receivedBefore: z.string().datetime().optional().describe("Only emails received before this date (ISO 8601)."),
      receivedAfter: z.string().datetime().optional().describe("Only emails received after this date (ISO 8601)."),
      hasKeyword: z.string().optional().describe("Only emails with this keyword."),
      notKeyword: z.string().optional().describe("Only emails without this keyword."),
      hasAttachment: z.boolean().optional().describe("Only emails with/without attachments."),
      searchText: z.string().optional().describe("Full-text search."),
      searchFrom: z.string().optional().describe("Filter by sender."),
      searchTo: z.string().optional().describe("Filter by recipient (To)."),
      searchCc: z.string().optional().describe("Filter by recipient (Cc)."),
      searchBcc: z.string().optional().describe("Filter by recipient (Bcc)."),
      searchSubject: z.string().optional().describe("Filter by subject."),
      searchBody: z.string().optional().describe("Filter by body content.")
    }
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
    description: "Retrieves the full content of an email by its ID, including subject, sender, recipients, date, and body (text or HTML).",
    input: {
      emailId: z.string().describe("The ID of the email to fetch.")
    }
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