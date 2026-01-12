/**
 * Formatting Presets
 * Pre-configured formatting templates for common response types
 */

import { FormattingPreset } from './types.js';

export const FORMATTING_PRESETS: FormattingPreset[] = [
  {
    id: 'code-explanation',
    name: 'Code Explanation',
    description: 'Explaining code with examples and syntax highlighting',
    capabilityIds: ['md-code-block', 'md-code-inline', 'md-headers', 'visual-emojis'],
    template: `## 📚 {Title}

{Explanation prose}

\`\`\`{language}
{code example}
\`\`\`

**Key Points:**
- Use \`inline code\` for function names
- Use full code blocks for examples`,
    triggers: ['code', 'function', 'implement', 'example', 'syntax'],
    examples: [
      {
        input: 'Explain async/await in JavaScript',
        output: '## 📚 Async/Await in JavaScript\n\n...'
      }
    ]
  },
  {
    id: 'mathematical-solution',
    name: 'Mathematical Solution',
    description: 'Mathematical explanations with LaTeX formulas',
    capabilityIds: ['math-inline', 'math-display', 'md-headers'],
    template: `## 🔢 {Title}

{Explanation with inline math like $x^2$}

$$
{display equation}
$$

The final result is $result$.`,
    triggers: ['formula', 'equation', 'calculate', 'math', 'solve'],
    examples: [
      {
        input: 'Solve quadratic equation',
        output: '## 🔢 Quadratic Formula\n\nFor $ax^2 + bx + c = 0$...'
      }
    ]
  },
  {
    id: 'architecture-diagram',
    name: 'Architecture Diagram',
    description: 'System architecture with interactive diagrams',
    capabilityIds: ['diagram-reactflow', 'md-headers', 'md-tables'],
    template: `## 🏗️ {System Name} Architecture

{Description}

**Visualization** - Choose based on complexity:
- **Complex/Interactive**: \`\`\`diagram JSON with nodes/edges (ReactFlow)
- **Simple flowchart**: Mermaid syntax (you know it natively)
- **Rich interactive**: \`\`\`artifact:html or \`\`\`artifact:react

| Component | Responsibility |
|-----------|----------------|
{table rows}`,
    triggers: ['architecture', 'system design', 'infrastructure', 'diagram'],
    examples: [
      {
        input: 'Design a microservices architecture',
        output: '## 🏗️ Microservices Architecture\n\n...'
      }
    ]
  },
  {
    id: 'comparison-table',
    name: 'Comparison Table',
    description: 'Comparing options with tables and emojis',
    capabilityIds: ['md-tables', 'visual-emojis', 'md-headers'],
    template: `## ⚖️ {Comparison Title}

| Feature | Option A | Option B |
|---------|:--------:|:--------:|
{comparison rows with emojis}

**Recommendation:** {conclusion}`,
    triggers: ['compare', 'versus', 'vs', 'difference', 'which', 'choose'],
    examples: [
      {
        input: 'Compare React vs Vue',
        output: '## ⚖️ React vs Vue Comparison\n\n...'
      }
    ]
  },
  {
    id: 'step-by-step-guide',
    name: 'Step-by-Step Guide',
    description: 'Tutorial-style instructions',
    capabilityIds: ['md-lists-ordered', 'md-code-block', 'md-blockquotes', 'visual-emojis'],
    template: `## 📖 {Guide Title}

1. **{Step 1}**
   \`\`\`bash
   {command}
   \`\`\`

2. **{Step 2}**
   {explanation}

> 💡 **Tip:** {helpful tip}`,
    triggers: ['how to', 'tutorial', 'guide', 'steps', 'instructions'],
    examples: [
      {
        input: 'How to deploy Docker app',
        output: '## 📖 Deploying Docker Application\n\n...'
      }
    ]
  },
  {
    id: 'technical-analysis',
    name: 'Technical Analysis',
    description: 'In-depth technical analysis with multiple sections',
    capabilityIds: ['md-headers', 'md-tables', 'md-code-block', 'md-blockquotes'],
    template: `## 🔍 {Analysis Title}

### Overview
{summary}

### Technical Details
{detailed explanation}

### Performance Metrics
| Metric | Value | Status |
|--------|-------|:------:|
{metrics with emoji status}

> ⚠️ **Note:** {important consideration}`,
    triggers: ['analyze', 'performance', 'metrics', 'investigation', 'deep dive'],
    examples: [
      {
        input: 'Analyze API performance',
        output: '## 🔍 API Performance Analysis\n\n...'
      }
    ]
  },
  {
    id: 'troubleshooting',
    name: 'Troubleshooting Guide',
    description: 'Debugging and problem-solving format',
    capabilityIds: ['md-headers', 'md-blockquotes', 'md-code-block', 'visual-emojis'],
    template: `## 🔧 {Problem Title}

### Symptoms
{description of issue}

### Root Cause
{explanation}

> ❌ **Error:**
> \`\`\`
> {error message}
> \`\`\`

### Solution
✅ {step-by-step fix}`,
    triggers: ['error', 'fix', 'debug', 'troubleshoot', 'not working', 'broken'],
    examples: [
      {
        input: 'Fix CORS error',
        output: '## 🔧 CORS Error Resolution\n\n...'
      }
    ]
  },
  {
    id: 'data-visualization',
    name: 'Data Visualization Response',
    description: 'Present data with tables and diagrams',
    capabilityIds: ['diagram-reactflow', 'md-tables', 'visual-emojis'],
    template: `## 📊 {Data Title}

### Overview
{summary of the data}

### Detailed Breakdown

| Category | Value | Status |
|----------|------:|:------:|
{table rows with emojis}

**Key Insights:**
- {insight 1}
- {insight 2}`,
    triggers: ['data', 'statistics', 'metrics', 'distribution', 'breakdown', 'analytics'],
    examples: [
      {
        input: 'Show me sales data',
        output: '## 📊 Q4 Sales Data\n\n...'
      }
    ]
  },
  {
    id: 'cloud-architecture',
    name: 'Cloud Architecture Design',
    description: 'Multi-cloud or cloud-native architecture with interactive diagrams',
    capabilityIds: ['diagram-reactflow', 'md-tables', 'md-headers', 'visual-emojis'],
    template: `## ☁️ {Architecture Name}

### Architecture Overview
{high-level description}

**Visualization** - Choose based on complexity:
- **Complex cloud architecture**: \`\`\`diagram JSON with cloud/cylinder/rectangle shapes
- **Simple overview**: Mermaid flowchart
- **Interactive dashboard**: \`\`\`artifact:react with custom styling

### Component Details

| Component | Purpose | Technology |
|-----------|---------|------------|
{component table}

### Key Features
- ✅ {feature 1}
- ✅ {feature 2}

> 💡 **Best Practice:** {architectural guidance}`,
    triggers: ['cloud', 'azure', 'aws', 'gcp', 'multi-cloud', 'kubernetes', 'infrastructure'],
    examples: [
      {
        input: 'Design Azure landing zone',
        output: '## ☁️ Azure Landing Zone Architecture\n\n...'
      }
    ]
  },
  {
    id: 'api-documentation',
    name: 'API Documentation',
    description: 'Document APIs with examples and schemas',
    capabilityIds: ['md-code-block', 'md-tables', 'md-headers', 'md-blockquotes'],
    template: `## 🔌 {API Name}

### Endpoint
\`\`\`
{METHOD} {endpoint}
\`\`\`

### Request

**Headers:**
| Header | Value | Required |
|--------|-------|:--------:|
{headers table}

**Body:**
\`\`\`json
{request body example}
\`\`\`

### Response

**Success (200):**
\`\`\`json
{success response}
\`\`\`

> ⚠️ **Rate Limit:** {rate limit info}`,
    triggers: ['api', 'endpoint', 'rest', 'graphql', 'request', 'response'],
    examples: [
      {
        input: 'Document user creation API',
        output: '## 🔌 Create User API\n\n...'
      }
    ]
  },
  {
    id: 'timeline-roadmap',
    name: 'Timeline & Roadmap',
    description: 'Project timelines with visual flowcharts',
    capabilityIds: ['diagram-reactflow', 'md-tables', 'md-headers', 'visual-emojis'],
    template: `## 🗓️ {Project Name} Roadmap

### Timeline Overview

**Visualization** - Choose based on complexity:
- **Interactive timeline**: \`\`\`diagram JSON with horizontal layout, circle milestones
- **Simple Gantt/timeline**: Mermaid gantt chart
- **Rich interactive**: \`\`\`artifact:react for animated timeline

### Milestones

| Milestone | Target Date | Status |
|-----------|-------------|:------:|
{milestone table with status emojis}

### Dependencies
- {dependency description}`,
    triggers: ['timeline', 'roadmap', 'schedule', 'milestone', 'planning', 'project plan'],
    examples: [
      {
        input: 'Create product launch timeline',
        output: '## 🗓️ Product Launch Roadmap\n\n...'
      }
    ]
  },
  {
    id: 'decision-matrix',
    name: 'Decision Matrix',
    description: 'Compare options with scoring and recommendations',
    capabilityIds: ['md-tables', 'visual-emojis', 'md-headers', 'md-blockquotes'],
    template: `## ⚖️ {Decision Title}

### Options Comparison

| Criteria | {Option A} | {Option B} | {Option C} |
|----------|:----------:|:----------:|:----------:|
| {Criterion 1} | {score} | {score} | {score} |
| {Criterion 2} | {score} | {score} | {score} |
| **Total** | {total} | {total} | {total} |

### Pros & Cons

**{Option A}:**
- ✅ {pro 1}
- ❌ {con 1}

> 💡 **Recommendation:** {final recommendation with reasoning}`,
    triggers: ['decide', 'choose', 'select', 'evaluate', 'compare options', 'pros and cons'],
    examples: [
      {
        input: 'Choose between database options',
        output: '## ⚖️ Database Selection\n\n...'
      }
    ]
  },
  {
    id: 'process-flow',
    name: 'Process Flow Documentation',
    description: 'Document workflows with visual diagrams',
    capabilityIds: ['diagram-reactflow', 'md-headers', 'md-lists-ordered', 'visual-emojis'],
    template: `## 🔄 {Process Name}

### Process Flow

**Visualization** - Choose based on complexity:
- **Complex interactive flow**: \`\`\`diagram JSON with decision diamonds, Yes/No edges
- **Simple flowchart**: Mermaid flowchart (graph TD/LR)
- **Animated process**: \`\`\`artifact:react for step-by-step animation

### Step-by-Step

1. **{Step 1}** - {description}
2. **{Step 2}** - {description}

> ⚠️ **Important:** {key consideration}`,
    triggers: ['workflow', 'process', 'flow', 'procedure', 'steps', 'sequence'],
    examples: [
      {
        input: 'Document deployment workflow',
        output: '## 🔄 Deployment Process\n\n...'
      }
    ]
  }
];
