# mcp-openfema

OpenFEMA MCP — US Federal Emergency Management Agency open data.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `disaster_declarations` | Look up FEMA disaster declarations (DisasterDeclarationsSummaries). Convenience filters for state (2-letter), year (fyDeclared, the federal fiscal year of declaration), incidentType (e.g. 'Fire', 'Flood', 'Hurricane', 'Severe Storm'), and declarationType ('DR' major disaster, 'EM' emergency, 'FM' fire management). Returns the most recent first by default. |
| `query_dataset` | Generic OData query against any OpenFEMA dataset. Specify the entity name (and optionally version; defaults to the verified current version) plus OData params: filter, select, orderby, top, skip. Use list_datasets to see available entities/versions and the filter syntax. Returns { metadata, records }. |
| `list_datasets` | List the OpenFEMA datasets this pack knows about, with their entity name, current version, and a description. Also documents the OData filter syntax and response shape. Call this first to discover what query_dataset can target. |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "openfema": {
      "url": "https://gateway.pipeworx.io/openfema/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Openfema data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
