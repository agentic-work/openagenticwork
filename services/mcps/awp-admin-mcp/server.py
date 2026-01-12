#!/usr/bin/env python3
"""
AWP Admin MCP Server - FastMCP Entry Point

This is the entry point for the Admin MCP server.
It imports and runs the FastMCP server from the admin_mcp_server module.

IMPORTANT: This MCP server is ONLY available to ADMIN users.
Non-admin users should NOT have access to any tools in this server.
The MCP proxy validates admin status before routing requests here.
"""

import sys
import os

# Add src directory to Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src'))

# Import and run the server
from admin_mcp_server.server import main

if __name__ == "__main__":
    main()
