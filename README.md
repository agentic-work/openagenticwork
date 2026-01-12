# OpenAgenticWork

An open-source AI platform with intelligent model routing, Model Context Protocol (MCP) integration, and code execution capabilities.

## Features

- **Multi-Provider LLM Support**: AWS Bedrock, Anthropic, OpenAI, Azure OpenAI, Google Vertex AI, Ollama
- **Intelligent Model Routing**: Automatically routes requests to the best model based on task complexity
- **MCP Integration**: Model Context Protocol support for extensible tool capabilities
- **Code Execution**: Sandboxed code execution environment (AgentiCode)
- **Admin Portal**: Full-featured admin console for managing users, providers, and settings
- **Vector Search**: Milvus-powered semantic search and RAG capabilities
- **File Uploads**: MinIO-based object storage for file attachments

## Quick Start

### Prerequisites

- Docker and Docker Compose
- At least one LLM provider API key (AWS Bedrock, OpenAI, Anthropic, etc.)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/agentic-work/openagenticwork.git
cd openagenticwork
```

2. Copy and configure environment:
```bash
cp .env.example .env
# Edit .env with your LLM provider credentials
```

3. Start the services:
```bash
docker compose up -d
```

4. Access the application:
- **UI**: http://localhost:3000
- **API**: http://localhost:8000
- **API Docs**: http://localhost:8000/docs

### Default Login

On first startup, a default admin user is created:
- Email: `admin@localhost` (or value from `ADMIN_USER_EMAIL`)
- Password: `changeme` (or value from `ADMIN_USER_PASSWORD`)

**Important**: Change the default password after first login!

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│                 │     │                 │     │                 │
│  agenticwork-ui │────▶│ agenticwork-api │────▶│   LLM Providers │
│    (React)      │     │   (Fastify)     │     │                 │
│                 │     │                 │     └─────────────────┘
└─────────────────┘     └────────┬────────┘
                                 │
                    ┌────────────┼────────────┐
                    │            │            │
                    ▼            ▼            ▼
             ┌──────────┐ ┌──────────┐ ┌──────────┐
             │ Postgres │ │  Milvus  │ │  Redis   │
             │   (DB)   │ │ (Vector) │ │ (Cache)  │
             └──────────┘ └──────────┘ └──────────┘
```

## Services

| Service | Port | Description |
|---------|------|-------------|
| agenticwork-ui | 3000 | React frontend |
| agenticwork-api | 8000 | Fastify backend API |
| agenticwork-mcp-proxy | 8080 | MCP tool aggregator |
| agenticode-manager | 3050 (internal) | Code execution manager |
| postgres | 5432 | PostgreSQL database |
| redis | 6379 | Redis cache |
| milvus | 19530 | Vector database |
| minio | 9000/9001 | Object storage |

## Configuration

### LLM Providers

Configure at least one LLM provider in your `.env` file. You can also configure providers via the Admin Portal after startup.

#### AWS Bedrock (Recommended)
```env
AWS_BEDROCK_ENABLED=true
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
```

#### OpenAI
```env
OPENAI_ENABLED=true
OPENAI_API_KEY=your-api-key
```

#### Anthropic
```env
ANTHROPIC_ENABLED=true
ANTHROPIC_API_KEY=your-api-key
```

See `.env.example` for all available configuration options.

### Authentication

The platform supports multiple authentication methods:

- **Local Auth**: Username/password authentication (enabled by default)
- **Azure AD**: Microsoft SSO integration
- **Google**: Google OAuth integration

## Development

### Building from Source

```bash
# Install dependencies
pnpm install

# Build all services
pnpm build

# Run in development mode
pnpm dev
```

### Project Structure

```
openagenticwork/
├── services/
│   ├── agenticwork-api/      # Backend API (Fastify + TypeScript)
│   ├── agenticwork-ui/       # Frontend (React + Vite)
│   ├── agenticwork-mcp-proxy/ # MCP aggregator (Python + FastAPI)
│   ├── agenticode-manager/   # Code execution (Node.js)
│   └── mcps/                 # MCP servers
│       ├── awp-admin-mcp/    # Admin tools
│       ├── awp-web-mcp/      # Web fetch/search
│       └── awp-agenticwork-cli-mcp/  # CLI tools
├── docker-compose.yml
├── .env.example
└── README.md
```

## License

Copyright (c) 2026 Agenticwork LLC

## Contributing

Contributions are welcome! Please read our [Contributing Guidelines](CONTRIBUTING.md) before submitting a pull request.

## Support

- **Documentation**: https://docs.agenticwork.io
- **GitHub Issues**: https://github.com/agentic-work/openagenticwork/issues
- **Email**: support@agenticwork.io

---

Built with ❤️ by [Agenticwork](https://agenticwork.io)
