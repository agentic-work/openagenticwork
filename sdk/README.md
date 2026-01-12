# @agentic-work/sdk

**AgenticWork SDK** - Direct LLM provider access for agentic applications.

Part of the [AgenticWork](https://agenticwork.io) enterprise AI platform.

## Features

- Unified API for multiple LLM providers (OpenAI, Anthropic, Google, Ollama, AWS Bedrock)
- Built-in tool execution framework
- Streaming support
- Type-safe with full TypeScript support

## Installation

```bash
npm install @agentic-work/sdk
```

## Usage

```typescript
import { createProvider } from '@agentic-work/sdk';

const provider = createProvider({
  provider: 'openai',
  model: 'gpt-4',
  apiKey: process.env.OPENAI_API_KEY
});

const response = await provider.chat([
  { role: 'user', content: 'Hello!' }
]);
```

## License

Proprietary - This package is part of the AgenticWork application stack and is intended for use within AgenticWork deployments.

Learn more at [https://agenticwork.io](https://agenticwork.io)
