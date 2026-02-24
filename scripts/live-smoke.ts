import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function run(): Promise<void> {
  const token = process.env.ALBOM_BEARER_TOKEN;
  if (!token) {
    throw new Error("ALBOM_BEARER_TOKEN is required for live smoke test");
  }

  const client = new Client(
    {
      name: "albom-smoke-client",
      version: "1.0.0"
    },
    {
      capabilities: {}
    }
  );

  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/server.js"],
    cwd: process.cwd(),
    env: {
      ...process.env,
      ALBOM_BEARER_TOKEN: token,
      ALBOM_TOOL_PROFILE: process.env.ALBOM_TOOL_PROFILE ?? "compact"
    },
    stderr: "pipe"
  });

  if (transport.stderr) {
    transport.stderr.on("data", (chunk) => {
      process.stderr.write(`[server] ${String(chunk)}`);
    });
  }

  await client.connect(transport);

  try {
    const toolsResult = await client.listTools();
    const toolNames = toolsResult.tools.map((tool) => tool.name).sort();

    if (!toolNames.includes("albom_catalog_get")) {
      throw new Error("Expected albom_catalog_get tool");
    }
    if (!toolNames.includes("albom_text_generate")) {
      throw new Error("Expected albom_text_generate tool in compact profile");
    }

    const catalogResult = await client.callTool({
      name: "albom_catalog_get",
      arguments: {
        refresh: true
      }
    });

    if (catalogResult.isError) {
      throw new Error(`Catalog tool returned error: ${JSON.stringify(catalogResult.structuredContent)}`);
    }

    const textResult = await client.callTool({
      name: "albom_text_generate",
      arguments: {
        model: "gpt-4o-mini",
        input: "Reply with OK only."
      }
    });

    if (textResult.isError) {
      throw new Error(`Text tool returned error: ${JSON.stringify(textResult.structuredContent)}`);
    }

    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          tools: toolNames,
          catalog_status: (catalogResult.structuredContent as { status?: number })?.status,
          text_status: (textResult.structuredContent as { status?: number })?.status
        },
        null,
        2
      ) + "\n"
    );
  } finally {
    await transport.close();
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
