# JMAP-MCP

Read emails via MCP!

<a href="https://glama.ai/mcp/servers/@jahfer/jmap-mcp-server">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@jahfer/jmap-mcp-server/badge" alt="JMAP MCP server" />
</a>

## Introduction

JMAP-MCP is a connector designed to interact with a JMAP (JSON Mail Access Protocol) server, allowing you to read emails via the Model Context Protocol (MCP). This project specifically demonstrates integration with a Fastmail JMAP server.

## Setup

1.  **Prerequisites**: Ensure you have Node.js installed.
2.  **Clone the repository**: Clone this repository to your local machine.
3.  **Install dependencies**: Navigate to the project directory and run:

    ```bash
    npm install
    ```

## API Token Configuration

You need to set your JMAP API token to authenticate with your email server (e.g., Fastmail). Obtain your API token from your server's settings.

Set the `JMAP_SESSION_URL` and `JMAP_TOKEN` environment variables when running the application.

## MCP Configuration

To use JMAP-MCP, you need to configure it as an `mcpServer` in your MCP configuration file. Here is an example configuration:

```jsonc
{
  "mcpServers": {
    "emails": {
      "command": "npx",
      "args": ["-y", "@jahfer/jmap-mcp-server"],
      "env": {
        "JMAP_SESSION_URL": "https://api.fastmail.com/jmap/session", // for example
        "JMAP_TOKEN": "<your-jmap-token>"
      }
    }
  }
}
```

## Usage

Once configured in MCP, you can use commands or features within MCP that interact with the server definition to read your emails via the JMAP protocol.
