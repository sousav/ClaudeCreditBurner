/**
 * MCP Client - Wrapper for Model Context Protocol client
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { MCPTool, MCPCallResult } from '../types';
import { getLogger } from '../utils/logger';

interface MCPClientConfig {
  serverCommand: string;
  serverArgs: string[];
  env?: Record<string, string>;
}

export class MCPClient {
  private config: MCPClientConfig;
  private client: Client | null;
  private transport: StdioClientTransport | null;
  private connected: boolean;
  private tools: MCPTool[];

  constructor(config: MCPClientConfig) {
    this.config = config;
    this.client = null;
    this.transport = null;
    this.connected = false;
    this.tools = [];
  }

  /**
   * Connect to the MCP server
   */
  async connect(): Promise<boolean> {
    const logger = getLogger();

    try {
      logger.debug('Connecting to MCP server', {
        command: this.config.serverCommand,
        args: this.config.serverArgs,
      });

      // Create transport
      this.transport = new StdioClientTransport({
        command: this.config.serverCommand,
        args: this.config.serverArgs,
        env: {
          ...process.env,
          ...this.config.env,
        } as Record<string, string>,
      });

      // Create client
      this.client = new Client(
        {
          name: 'claude-credit-burner',
          version: '0.1.0',
        },
        {
          capabilities: {},
        }
      );

      // Connect
      await this.client.connect(this.transport);
      this.connected = true;

      // Fetch available tools
      const toolsResponse = await this.client.listTools();
      this.tools = toolsResponse.tools.map((tool) => ({
        name: tool.name,
        description: tool.description || '',
        inputSchema: tool.inputSchema as Record<string, unknown>,
      }));

      logger.info('Connected to MCP server', {
        toolCount: this.tools.length,
      });

      return true;
    } catch (error) {
      logger.error('Failed to connect to MCP server', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      this.connected = false;
      return false;
    }
  }

  /**
   * Disconnect from the MCP server
   */
  async disconnect(): Promise<void> {
    const logger = getLogger();

    if (this.client && this.connected) {
      try {
        await this.client.close();
        logger.debug('Disconnected from MCP server');
      } catch (error) {
        logger.warn('Error disconnecting from MCP server', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    this.client = null;
    this.transport = null;
    this.connected = false;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * List available tools
   */
  listTools(): MCPTool[] {
    return [...this.tools];
  }

  /**
   * Call a tool
   */
  async callTool(toolName: string, params: Record<string, unknown>): Promise<MCPCallResult> {
    const logger = getLogger();

    if (!this.client || !this.connected) {
      return {
        success: false,
        error: 'Not connected to MCP server',
      };
    }

    try {
      logger.debug('Calling MCP tool', { toolName, params });

      const result = await this.client.callTool({
        name: toolName,
        arguments: params,
      });

      // Extract content from result
      const content = result.content;
      let data: unknown;

      if (Array.isArray(content) && content.length > 0) {
        const firstContent = content[0];
        if ('text' in firstContent) {
          // Try to parse as JSON
          try {
            data = JSON.parse(firstContent.text);
          } catch {
            data = firstContent.text;
          }
        } else {
          data = firstContent;
        }
      } else {
        data = content;
      }

      logger.debug('MCP tool call completed', { toolName });

      return {
        success: !result.isError,
        data,
        error: result.isError ? String(data) : undefined,
      };
    } catch (error) {
      logger.error('MCP tool call failed', {
        toolName,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Check if a tool is available
   */
  hasTool(toolName: string): boolean {
    return this.tools.some((tool) => tool.name === toolName);
  }

  /**
   * Get tool by name
   */
  getTool(toolName: string): MCPTool | undefined {
    return this.tools.find((tool) => tool.name === toolName);
  }
}

/**
 * Create an MCP client configured for Linear
 */
export function createLinearMCPClient(apiKey: string, mcpUrl: string): MCPClient {
  return new MCPClient({
    serverCommand: 'npx',
    serverArgs: ['-y', 'mcp-remote', mcpUrl],
    env: {
      LINEAR_API_KEY: apiKey,
    },
  });
}
