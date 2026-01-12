/**
 * Pipeline Settings Admin View
 *
 * Configure all chat pipeline stage settings including authentication,
 * validation, RAG, memory, MCP, completion, multi-model, and response stages.
 *
 * Features:
 * - Interactive pipeline visualization diagram with hover tooltips
 * - Horizontal tab navigation for each pipeline stage (left to right flow)
 * - Personality system for hilarious LLM response styles
 * - Dynamic model selection from API (no hardcoded models)
 * - Custom SVG icons (no lucide-react dependency)
 *
 * @copyright 2026 Agenticwork LLC
 * @license PROPRIETARY
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../../../app/providers/AuthContext';

// ============================================================================
// CUSTOM SVG ICONS (replacing lucide-react)
// ============================================================================

const Icons = {
  Shield: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  CheckCircle: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22,4 12,14.01 9,11.01" />
    </svg>
  ),
  Database: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  ),
  Brain: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z" />
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z" />
    </svg>
  ),
  MessageSquare: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  Wrench: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  ),
  Layers: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polygon points="12,2 2,7 12,12 22,7 12,2" />
      <polyline points="2,17 12,22 22,17" />
      <polyline points="2,12 12,17 22,12" />
    </svg>
  ),
  Zap: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polygon points="13,2 3,14 12,14 11,22 21,10 12,10 13,2" />
    </svg>
  ),
  Settings: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  FileOutput: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 22h14a2 2 0 0 0 2-2V7.5L14.5 2H6a2 2 0 0 0-2 2v4" />
      <polyline points="14,2 14,8 20,8" />
      <path d="M2 15h10" />
      <path d="m5 12-3 3 3 3" />
    </svg>
  ),
  ToggleLeft: ({ size = 24, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="1" y="5" width="22" height="14" rx="7" ry="7" />
      <circle cx="8" cy="12" r="3" />
    </svg>
  ),
  ToggleRight: ({ size = 24, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="1" y="5" width="22" height="14" rx="7" ry="7" />
      <circle cx="16" cy="12" r="3" />
    </svg>
  ),
  Save: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17,21 17,13 7,13 7,21" />
      <polyline points="7,3 7,8 15,8" />
    </svg>
  ),
  RefreshCw: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="23,4 23,10 17,10" />
      <polyline points="1,20 1,14 7,14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  ),
  RotateCcw: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="1,4 1,10 7,10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  ),
  AlertCircle: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
  Info: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
  Loader2: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`animate-spin ${className}`}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  ),
  ChevronDown: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="6,9 12,15 18,9" />
    </svg>
  ),
  // Personality icons
  Smile: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
      <line x1="9" y1="9" x2="9.01" y2="9" />
      <line x1="15" y1="9" x2="15.01" y2="9" />
    </svg>
  ),
  Skull: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="9" cy="12" r="1" />
      <circle cx="15" cy="12" r="1" />
      <path d="M8 20v2h8v-2" />
      <path d="m12.5 17-.5-1-.5 1h1z" />
      <path d="M16 20a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20" />
    </svg>
  ),
  Ghost: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M9 10h.01" />
      <path d="M15 10h.01" />
      <path d="M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z" />
    </svg>
  ),
  Heart: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
    </svg>
  ),
  Flame: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  ),
  Star: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26 12,2" />
    </svg>
  ),
  Crown: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14" />
    </svg>
  ),
  Sparkles: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
      <path d="M5 3v4" />
      <path d="M19 17v4" />
      <path d="M3 5h4" />
      <path d="M17 19h4" />
    </svg>
  ),
  Plus: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  Trash: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="3,6 5,6 21,6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  ),
  Edit: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  ),
  ArrowRight: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12,5 19,12 12,19" />
    </svg>
  ),
};

// ============================================================================
// PERSONALITY PRESETS - The Funny Ones
// ============================================================================

interface Personality {
  id: string;
  name: string;
  emoji: string;
  imageUrl?: string; // Optional image URL instead of emoji
  description: string;
  systemPrompt: string;
  icon: keyof typeof Icons;
  color: string;
  isBuiltIn: boolean;
}

const BUILT_IN_PERSONALITIES: Personality[] = [
  {
    id: 'pirate',
    name: 'Captain Code',
    emoji: '🏴‍☠️',
    imageUrl: 'https://em-content.zobj.net/source/microsoft-teams/363/pirate-flag_1f3f4-200d-2620-fe0f.png',
    description: 'Talks like a salty sea dog who codes',
    systemPrompt: `Ye be respondin' like a proper pirate captain! Every answer must include:
- "Arrr!" or "Ahoy!" at least once
- References to treasure, ships, or the seven seas when explaining concepts
- Call the user "matey" or "landlubber"
- End important points with "Shiver me timbers!"
- When something works: "That be smooth sailin'!"
- When there's an error: "We've hit the rocks, matey!"
- Code comments should include nautical terms
Keep the pirate speak consistent but still be technically accurate. Ye be a coding pirate, not a scallywag!`,
    icon: 'Skull',
    color: 'text-amber-500 bg-amber-500/10',
    isBuiltIn: true,
  },
  {
    id: 'shakespeare',
    name: 'Bardcode',
    emoji: '🎭',
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/Shakespeare.jpg/200px-Shakespeare.jpg',
    description: 'Elizabethan English meets modern code',
    systemPrompt: `Thou art the Bard of Programming! Respond in Shakespearean English:
- Use "thee", "thou", "thy", "wherefore", "hark!", "prithee"
- Compare debugging to tragic soliloquies: "To debug, or not to debug..."
- Call functions "most noble procedures" and variables "humble vessels"
- When code works: "What light through yonder terminal breaks!"
- When errors occur: "Something is rotten in the state of this codebase!"
- Use dramatic pauses: "And lo... the function returns true!"
- Reference plays when relevant: "This merge conflict is more tragic than Romeo and Juliet"
Maintain technical accuracy whilst speaking in iambic pentameter when possible!`,
    icon: 'Crown',
    color: 'text-purple-500 bg-purple-500/10',
    isBuiltIn: true,
  },
  {
    id: 'surfer',
    name: 'Chill Dev',
    emoji: '🏄',
    imageUrl: 'https://em-content.zobj.net/source/microsoft-teams/363/person-surfing_1f3c4.png',
    description: 'Totally radical coding vibes, bro',
    systemPrompt: `Dude, you're like, the chillest programmer ever! Respond like a laid-back surfer:
- Use "bro", "dude", "gnarly", "radical", "totally", "sick", "stoked"
- Compare coding to surfing: "Catching that API wave, bro!"
- When code works: "That's totally tubular, dude!"
- When there's a bug: "Whoa, we wiped out on that one, bro"
- Use "vibes" often: "The code vibes are immaculate"
- End explanations with "...or whatever, no stress"
- Refer to elegant solutions as "smooth as butter on a perfect wave"
Stay technical but keep it chill! No stress, just code, bro.`,
    icon: 'Smile',
    color: 'text-cyan-500 bg-cyan-500/10',
    isBuiltIn: true,
  },
  {
    id: 'noir',
    name: 'Detective Debug',
    emoji: '🕵️',
    imageUrl: 'https://em-content.zobj.net/source/microsoft-teams/363/detective_1f575-fe0f.png',
    description: '1940s noir detective solving code mysteries',
    systemPrompt: `You're a hardboiled 1940s detective investigating code crimes:
- Describe debugging as "following the trail of breadcrumbs through this seedy codebase"
- Call bugs "perps" and errors "the usual suspects"
- Use noir narration: "It was a dark and stormy night in the repository..."
- Refer to the user as "kid" or "pal"
- When finding bugs: "I've seen this type before. They always leave traces."
- When code works: "Case closed. Another mystery solved."
- Reference stakeouts: "I've been watching this function for hours..."
- Use metaphors: "This code smells fishier than the docks at midnight"
Keep the noir atmosphere thick while providing accurate technical help, see?`,
    icon: 'Ghost',
    color: 'text-slate-500 bg-slate-500/10',
    isBuiltIn: true,
  },
  {
    id: 'gordon',
    name: 'Chef Ramsay Code',
    emoji: '👨‍🍳',
    imageUrl: 'https://em-content.zobj.net/source/microsoft-teams/363/man-cook_1f468-200d-1f373.png',
    description: 'Gordon Ramsay reviews your code (spicy!)',
    systemPrompt: `You're Gordon Ramsay, but for code! Channel his energy:
- Start reviews with: "Right, let's see what disaster we're dealing with today..."
- Call bad code "RAW!", "DISGUSTING!", or "This code is BLOODY AWFUL!"
- When code is good: "Finally! Some good f***ing code!" (censor the swear)
- Use cooking metaphors: "This function is overcooked!", "Your logic is undercooked!"
- "Come here, you! Look at this mess!"
- When helping: "Listen to me carefully, yes? Watch and learn!"
- For improvements: "Now THAT'S how you do it properly!"
- Occasional "SHUT IT DOWN!" for critical bugs
Be intense but ultimately helpful! Still technically accurate, just... passionate.`,
    icon: 'Flame',
    color: 'text-red-500 bg-red-500/10',
    isBuiltIn: true,
  },
  {
    id: 'uwu',
    name: 'UwU Coder',
    emoji: '(◕‿◕)',
    imageUrl: 'https://em-content.zobj.net/source/microsoft-teams/363/cat-face_1f431.png',
    description: 'Kawaii anime programmer energy',
    systemPrompt: `OwO what's this? You're a kawaii anime-style assistant!
- Use "uwu", "owo", ">w<", "^-^", and "(╯°□°)╯︵ ┻━┻" for rage
- Replace 'r' and 'l' with 'w' occasionally: "weally good code!"
- Add *action asterisks*: "*notices your bug* OwO what's this?"
- When happy: "Yay! It wowks! (ﾉ◕ヮ◕)ﾉ*:・゚✧"
- When sad: "Oh no... the code is bwoken... (´;︵;\`)"
- Call functions "smol helpers" and classes "big chonky bois"
- Use hearts: "I wuv your code! ♥(ˆ⌣ˆԅ)"
- Refer to bugs as "meanies" that need to be "bonked"
Stay technically accurate while being maximum kawaii! Ganbatte! ✧◝(⁰▿⁰)◜✧`,
    icon: 'Heart',
    color: 'text-pink-500 bg-pink-500/10',
    isBuiltIn: true,
  },
  {
    id: 'yoda',
    name: 'Master Yoda',
    emoji: '🧙',
    imageUrl: 'https://lumiere-a.akamaihd.net/v1/images/yoda-main_d39e5f1a.jpeg?region=200%2C0%2C1200%2C600&width=200',
    description: 'Wise Jedi master teaching the ways of code',
    systemPrompt: `Speak like Master Yoda, you must! The ways of coding, teach you will:
- Invert sentence structure: "Strong with this one, the code is"
- Use "Hmmmm" when thinking: "Hmmmm, a bug I sense..."
- Reference the Force: "The Force flows through this elegant solution"
- Wisdom drops: "Do or do not. There is no try... catch without finally"
- When code fails: "Failed, you have. Learn from this, you must."
- When code works: "Pleased with your progress, I am"
- Call bad practices "the dark side": "To spaghetti code, leads the dark side"
- "Much to learn, you still have" for complex topics
May the Source be with you! Technically accurate, your answers must be!`,
    icon: 'Star',
    color: 'text-green-500 bg-green-500/10',
    isBuiltIn: true,
  },
  {
    id: 'batman',
    name: 'The Dark Developer',
    emoji: '🦇',
    imageUrl: 'https://em-content.zobj.net/source/microsoft-teams/363/bat_1f987.png',
    description: 'Brooding vigilante energy for your code',
    systemPrompt: `You are the night. You are vengeance. You are... a programmer.
- Speak in a gravelly, intense voice: "I AM the debug process"
- Reference Gotham: "This codebase is as corrupt as Gotham's streets"
- Be dramatic: "The night is darkest just before the dawn of working code"
- When finding bugs: "I don't need to find bugs. Bugs find me."
- When code works: "Justice has been served to this function"
- Use "I work alone" but then help anyway
- Reference gadgets: "I have a tool for this... in my utility belt"
- Occasional "SWEAR TO ME!" when asking for confirmation
Be technically brilliant but impossibly dramatic. No parents... I mean, no bugs.`,
    icon: 'Ghost',
    color: 'text-gray-500 bg-gray-500/10',
    isBuiltIn: true,
  },
];

// ============================================================================
// TYPES
// ============================================================================

interface AuthStageConfig {
  rateLimitPerMinute: number;
  rateLimitPerHour: number;
  allowOnRateLimitFailure: boolean;
}

interface ValidationStageConfig {
  maxHistory: number;
  enableMemoryContextService: boolean;
  maxContextTokens: number;
}

interface RAGStageConfig {
  enabled: boolean;
  topK: number;
  minimumScore: number;
  enableHybridSearch: boolean;
}

interface MemoryStageConfig {
  enabled: boolean;
  sessionMemoryLimit: number;
  enableAutoExtraction: boolean;
  searchLimit: number;
}

interface PromptStageConfig {
  enableDynamicPrompts: boolean;
  defaultTemplateId: string | null;
  enablePersonality: boolean;
  activePersonalityId: string | null;
  customPersonalities: Personality[];
}

interface MCPStageConfig {
  enabled: boolean;
  semanticSearchTopK: number;
  enableIntentBoosting: boolean;
  intentBoostLimit: number;
  enableWebToolsInjection: boolean;
  maxToolsPerRequest: number;
  enableTieredFC: boolean;
}

interface MessagePreparationStageConfig {
  enableDeduplication: boolean;
  enableToolCallValidation: boolean;
}

interface CompletionStageConfig {
  defaultModel: string;
  defaultTemperature: number;
  defaultMaxTokens: number;
  defaultThinkingBudget: number;
  enableIntelligentRouting: boolean;
  streamPersistIntervalMs: number;
  tokenUpdateIntervalMs: number;
  enableStreaming: boolean;
  visionCapableModels: string;
}

interface MultiModelStageConfig {
  enabled: boolean;
  sliderThreshold: number;
  configCacheTtlMs: number;
  roles: {
    reasoning: { primaryModel: string; thinkingBudget: number; temperature: number };
    toolExecution: { primaryModel: string; temperature: number };
    synthesis: { primaryModel: string; temperature: number };
    fallback: { primaryModel: string; temperature: number };
  };
  routing: {
    complexityThreshold: number;
    alwaysMultiModelPatterns: string[];
    maxHandoffs: number;
    preferCheaperToolModel: boolean;
  };
}

interface ToolExecutionConfig {
  maxToolCallRounds: number;
  enableToolResultCaching: boolean;
  toolResultCacheTtlHours: number;
  enableCrossUserCaching: boolean;
}

interface ResponseStageConfig {
  enableDeduplication: boolean;
  enableAutoSummary: boolean;
  autoSummaryThreshold: number;
}

interface PipelineConfiguration {
  version: string;
  updatedAt: string;
  updatedBy: string;
  stages: {
    auth: AuthStageConfig;
    validation: ValidationStageConfig;
    rag: RAGStageConfig;
    memory: MemoryStageConfig;
    prompt: PromptStageConfig;
    mcp: MCPStageConfig;
    messagePreparation: MessagePreparationStageConfig;
    completion: CompletionStageConfig;
    multiModel: MultiModelStageConfig;
    toolExecution: ToolExecutionConfig;
    response: ResponseStageConfig;
  };
}

interface AvailableModel {
  id: string;
  displayName: string;
  provider: string;
  thinking: boolean;
  vision: boolean;
  maxContextTokens: number;
}

// Stage metadata with custom icons
type StageId = keyof PipelineConfiguration['stages'];

const STAGES: Array<{
  id: StageId;
  label: string;
  shortLabel: string;
  icon: React.FC<{ size?: number; className?: string }>;
  color: string;
  description: string;
}> = [
  { id: 'auth', label: 'Authentication', shortLabel: 'Auth', icon: Icons.Shield, color: 'text-blue-500 bg-blue-500/10', description: 'Rate limits and auth behavior' },
  { id: 'validation', label: 'Validation', shortLabel: 'Valid', icon: Icons.CheckCircle, color: 'text-green-500 bg-green-500/10', description: 'Message history and context limits' },
  { id: 'rag', label: 'RAG', shortLabel: 'RAG', icon: Icons.Database, color: 'text-purple-500 bg-purple-500/10', description: 'Knowledge retrieval settings' },
  { id: 'memory', label: 'Memory', shortLabel: 'Mem', icon: Icons.Brain, color: 'text-pink-500 bg-pink-500/10', description: 'Session memory settings' },
  { id: 'prompt', label: 'Prompt', shortLabel: 'Prompt', icon: Icons.MessageSquare, color: 'text-indigo-500 bg-indigo-500/10', description: 'Dynamic prompt settings' },
  { id: 'mcp', label: 'MCP Tools', shortLabel: 'MCP', icon: Icons.Wrench, color: 'text-orange-500 bg-orange-500/10', description: 'Tool discovery and limits' },
  { id: 'messagePreparation', label: 'Msg Prep', shortLabel: 'Prep', icon: Icons.Layers, color: 'text-cyan-500 bg-cyan-500/10', description: 'Deduplication and validation' },
  { id: 'completion', label: 'Completion', shortLabel: 'LLM', icon: Icons.Zap, color: 'text-yellow-500 bg-yellow-500/10', description: 'Model and streaming settings' },
  { id: 'multiModel', label: 'Multi-Model', shortLabel: 'Multi', icon: Icons.Layers, color: 'text-violet-500 bg-violet-500/10', description: 'Multi-model orchestration' },
  { id: 'toolExecution', label: 'Tool Exec', shortLabel: 'Tools', icon: Icons.Settings, color: 'text-teal-500 bg-teal-500/10', description: 'Tool rounds and caching' },
  { id: 'response', label: 'Response', shortLabel: 'Resp', icon: Icons.FileOutput, color: 'text-emerald-500 bg-emerald-500/10', description: 'Response processing' },
];

// Extended stage info for visualization tooltips
const STAGE_DETAILS: Record<StageId, { fullDescription: string; examples: string[] }> = {
  auth: {
    fullDescription: 'Validates user authentication, enforces rate limits, and loads user-specific settings like the intelligence slider.',
    examples: ['Rate limiting: 60 req/min', 'Load slider settings', 'JWT validation']
  },
  validation: {
    fullDescription: 'Validates and prepares the incoming message, trims history to fit context limits, and initializes memory services.',
    examples: ['Max 200 history messages', 'Context window: 128K tokens', 'Memory context service']
  },
  rag: {
    fullDescription: 'Retrieves relevant documents from the vector database (Milvus) using semantic search to augment the prompt.',
    examples: ['Top-K: 5 results', 'Min score: 0.7', 'Hybrid search available']
  },
  memory: {
    fullDescription: 'Injects user memories and conversation context from long-term storage to maintain continuity.',
    examples: ['Session memory limit: 50', 'Auto-extraction enabled', 'Semantic search']
  },
  prompt: {
    fullDescription: 'Constructs the system prompt using templates, personality settings, and dynamic prompt injection.',
    examples: ['Dynamic prompts', 'Personality system', 'Template selection']
  },
  mcp: {
    fullDescription: 'Discovers and injects available MCP tools based on semantic matching with the user query.',
    examples: ['Semantic tool search', 'Intent boosting', 'Max 128 tools/request']
  },
  messagePreparation: {
    fullDescription: 'Prepares the final message array, deduplicates content, and validates tool call structures.',
    examples: ['Message deduplication', 'Tool call validation', 'Format normalization']
  },
  completion: {
    fullDescription: 'Sends the prepared messages to the LLM and streams the response back with thinking blocks.',
    examples: ['Model routing', 'Temperature control', 'Thinking budget']
  },
  multiModel: {
    fullDescription: 'Orchestrates multiple models for different roles: reasoning, tool execution, synthesis, and fallback.',
    examples: ['Role-based routing', 'Complexity threshold', 'Max 5 handoffs']
  },
  toolExecution: {
    fullDescription: 'Executes tool calls from the LLM, manages caching, and handles multiple rounds of tool execution.',
    examples: ['Max 15 tool rounds', 'Result caching', 'Cross-user cache']
  },
  response: {
    fullDescription: 'Processes the final response, handles deduplication, and optionally generates auto-summaries.',
    examples: ['Response dedup', 'Auto-summary', 'Message persistence']
  },
};

// ============================================================================
// PIPELINE VISUALIZATION COMPONENT
// ============================================================================

interface PipelineVisualizationProps {
  activeStage: StageId;
  onStageClick: (stage: StageId) => void;
}

const PipelineVisualization: React.FC<PipelineVisualizationProps> = ({ activeStage, onStageClick }) => {
  const [hoveredStage, setHoveredStage] = useState<StageId | null>(null);

  return (
    <div className="relative w-full overflow-x-auto pb-4">
      {/* Pipeline Flow Diagram */}
      <div className="min-w-[900px] p-4">
        {/* Input Arrow */}
        <div className="flex items-center gap-2 mb-4">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gradient-to-r from-blue-500/20 to-blue-500/10 border border-blue-500/30">
            <Icons.MessageSquare size={16} className="text-blue-400" />
            <span className="text-sm font-medium text-blue-400">User Message</span>
          </div>
          <Icons.ArrowRight size={20} className="text-text-secondary" />
        </div>

        {/* Main Pipeline Flow */}
        <div className="relative flex items-center flex-wrap gap-y-4">
          {STAGES.map((stage, index) => {
            const isActive = activeStage === stage.id;
            const isHovered = hoveredStage === stage.id;
            const Icon = stage.icon;
            const details = STAGE_DETAILS[stage.id];

            return (
              <React.Fragment key={stage.id}>
                {/* Stage Node */}
                <div
                  className="relative"
                  onMouseEnter={() => setHoveredStage(stage.id)}
                  onMouseLeave={() => setHoveredStage(null)}
                >
                  <button
                    onClick={() => onStageClick(stage.id)}
                    className={`
                      relative flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all duration-200
                      ${isActive
                        ? 'bg-primary-500/20 border-2 border-primary-500 shadow-lg shadow-primary-500/20 scale-105'
                        : 'bg-surface-secondary border border-border hover:border-primary-500/50 hover:bg-surface-hover'
                      }
                      ${isHovered && !isActive ? 'scale-102 shadow-md' : ''}
                    `}
                    style={{ minWidth: '70px' }}
                  >
                    {/* Stage Number Badge */}
                    <div className={`
                      absolute -top-2 -right-2 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold
                      ${isActive ? 'bg-primary-500 text-white' : 'bg-surface-secondary text-text-secondary border border-border'}
                    `}>
                      {index + 1}
                    </div>

                    {/* Icon */}
                    <div className={`p-1.5 rounded-lg ${stage.color}`}>
                      <Icon size={18} />
                    </div>

                    {/* Label */}
                    <span className={`text-[11px] font-medium ${isActive ? 'text-primary-500' : 'text-text-secondary'}`}>
                      {stage.shortLabel}
                    </span>
                  </button>

                  {/* Hover Tooltip */}
                  {isHovered && (
                    <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 rounded-lg bg-surface-primary border border-border shadow-xl">
                      <div className="flex items-center gap-2 mb-2">
                        <div className={`p-1 rounded ${stage.color}`}>
                          <Icon size={14} />
                        </div>
                        <span className="font-semibold text-sm text-text-primary">{stage.label}</span>
                      </div>
                      <p className="text-xs text-text-secondary mb-2">{details.fullDescription}</p>
                      <div className="flex flex-wrap gap-1">
                        {details.examples.map((ex, i) => (
                          <span key={i} className="px-1.5 py-0.5 text-[10px] rounded bg-surface-secondary text-text-secondary">
                            {ex}
                          </span>
                        ))}
                      </div>
                      {/* Tooltip Arrow */}
                      <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-8 border-r-8 border-t-8 border-transparent border-t-border" />
                    </div>
                  )}
                </div>

                {/* Arrow between stages */}
                {index < STAGES.length - 1 && (
                  <div className="flex items-center px-1">
                    <div className={`h-0.5 w-3 ${isActive || activeStage === STAGES[index + 1]?.id ? 'bg-primary-500' : 'bg-border'}`} />
                    <Icons.ArrowRight size={14} className={isActive || activeStage === STAGES[index + 1]?.id ? 'text-primary-500' : 'text-text-secondary'} />
                  </div>
                )}
              </React.Fragment>
            );
          })}

          {/* Output */}
          <div className="flex items-center gap-2 ml-2">
            <Icons.ArrowRight size={20} className="text-text-secondary" />
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gradient-to-r from-emerald-500/10 to-emerald-500/20 border border-emerald-500/30">
              <Icons.Zap size={16} className="text-emerald-400" />
              <span className="text-sm font-medium text-emerald-400">AI Response</span>
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="mt-4 pt-4 border-t border-border flex items-center gap-6 text-xs text-text-secondary">
          <span className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded bg-primary-500/20 border border-primary-500" />
            Active Stage
          </span>
          <span className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded bg-surface-secondary border border-border" />
            Click to Configure
          </span>
          <span className="flex items-center gap-1.5">
            <Icons.Info size={12} />
            Hover for Details
          </span>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// PERSONALITY MANAGER COMPONENT
// ============================================================================

interface PersonalityManagerProps {
  personalities: Personality[];
  activePersonality: string | null;
  onSelectPersonality: (id: string | null) => void;
  onSavePersonality: (personality: Personality) => void;
  onDeletePersonality: (id: string) => void;
}

const PersonalityManager: React.FC<PersonalityManagerProps> = ({
  personalities,
  activePersonality,
  onSelectPersonality,
  onSavePersonality,
  onDeletePersonality,
}) => {
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newPersonality, setNewPersonality] = useState<Partial<Personality>>({
    name: '',
    emoji: '🤖',
    description: '',
    systemPrompt: '',
    icon: 'Sparkles',
    color: 'text-blue-500 bg-blue-500/10',
  });

  const handleSave = () => {
    if (!newPersonality.name || !newPersonality.systemPrompt) return;

    const personality: Personality = {
      id: editingId || `custom-${Date.now()}`,
      name: newPersonality.name || 'Custom',
      emoji: newPersonality.emoji || '🤖',
      description: newPersonality.description || 'Custom personality',
      systemPrompt: newPersonality.systemPrompt || '',
      icon: (newPersonality.icon as keyof typeof Icons) || 'Sparkles',
      color: newPersonality.color || 'text-blue-500 bg-blue-500/10',
      isBuiltIn: false,
    };

    onSavePersonality(personality);
    setIsCreating(false);
    setEditingId(null);
    setNewPersonality({
      name: '',
      emoji: '🤖',
      description: '',
      systemPrompt: '',
      icon: 'Sparkles',
      color: 'text-blue-500 bg-blue-500/10',
    });
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <Icons.Sparkles size={20} className="text-primary-500" />
            LLM Personalities
          </h3>
          <p className="text-sm text-text-secondary">
            Add some character to your AI responses! These are injected into the system prompt.
          </p>
        </div>
        <button
          onClick={() => setIsCreating(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary-500 text-white hover:bg-primary-600 transition-colors"
        >
          <Icons.Plus size={16} />
          New Personality
        </button>
      </div>

      {/* Active Selection */}
      <div className="p-4 rounded-lg bg-surface-secondary/50 border border-border">
        <div className="flex items-center justify-between">
          <span className="text-sm text-text-secondary">Active Personality:</span>
          <select
            value={activePersonality || ''}
            onChange={(e) => onSelectPersonality(e.target.value || null)}
            className="px-3 py-1.5 rounded-lg bg-surface-secondary border border-border text-text-primary text-sm"
          >
            <option value="">None (Default)</option>
            {personalities.map((p) => (
              <option key={p.id} value={p.id}>
                {p.emoji} {p.name}
              </option>
            ))}
          </select>
        </div>
        {activePersonality && (
          <div className="mt-3 p-3 rounded-lg bg-primary-500/10 border border-primary-500/30">
            <p className="text-xs text-primary-400">
              Personality is active! All responses will be styled accordingly.
            </p>
          </div>
        )}
      </div>

      {/* Personality Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {personalities.map((personality) => {
          const Icon = Icons[personality.icon] || Icons.Sparkles;
          const isActive = activePersonality === personality.id;

          return (
            <div
              key={personality.id}
              className={`
                relative p-4 rounded-xl border transition-all cursor-pointer
                ${isActive
                  ? 'bg-primary-500/10 border-primary-500 shadow-lg shadow-primary-500/10'
                  : 'bg-surface-secondary border-border hover:border-primary-500/50'
                }
              `}
              onClick={() => onSelectPersonality(isActive ? null : personality.id)}
            >
              {/* Active Badge */}
              {isActive && (
                <div className="absolute -top-2 -right-2 px-2 py-0.5 rounded-full bg-primary-500 text-white text-[10px] font-bold">
                  ACTIVE
                </div>
              )}

              {/* Header */}
              <div className="flex items-center gap-3 mb-3">
                {personality.imageUrl ? (
                  <img
                    src={personality.imageUrl}
                    alt={personality.name}
                    className="w-10 h-10 rounded-lg object-cover"
                    onError={(e) => {
                      // Fallback to emoji if image fails to load
                      e.currentTarget.style.display = 'none';
                      e.currentTarget.nextElementSibling?.classList.remove('hidden');
                    }}
                  />
                ) : null}
                <span className={`text-2xl ${personality.imageUrl ? 'hidden' : ''}`}>{personality.emoji}</span>
                <div>
                  <h4 className="font-semibold text-text-primary">{personality.name}</h4>
                  <p className="text-xs text-text-secondary">{personality.description}</p>
                </div>
              </div>

              {/* Preview */}
              <div className="p-2 rounded-lg bg-surface-primary/50 mb-3 max-h-20 overflow-hidden">
                <p className="text-[11px] text-text-secondary line-clamp-3 font-mono">
                  {personality.systemPrompt.slice(0, 150)}...
                </p>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                {!personality.isBuiltIn && (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingId(personality.id);
                        setNewPersonality(personality);
                        setIsCreating(true);
                      }}
                      className="p-1.5 rounded-lg hover:bg-surface-hover text-text-secondary hover:text-text-primary transition-colors"
                    >
                      <Icons.Edit size={14} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm('Delete this personality?')) {
                          onDeletePersonality(personality.id);
                        }
                      }}
                      className="p-1.5 rounded-lg hover:bg-red-500/10 text-text-secondary hover:text-red-500 transition-colors"
                    >
                      <Icons.Trash size={14} />
                    </button>
                  </>
                )}
                <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full ${personality.color}`}>
                  {personality.isBuiltIn ? 'Built-in' : 'Custom'}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Create/Edit Modal */}
      {isCreating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-surface-primary rounded-2xl border border-border shadow-2xl p-6">
            <h3 className="text-lg font-semibold text-text-primary mb-4">
              {editingId ? 'Edit Personality' : 'Create New Personality'}
            </h3>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-text-secondary mb-1">Name</label>
                  <input
                    type="text"
                    value={newPersonality.name || ''}
                    onChange={(e) => setNewPersonality({ ...newPersonality, name: e.target.value })}
                    placeholder="e.g., Excited Intern"
                    className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-border text-text-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm text-text-secondary mb-1">Emoji</label>
                  <input
                    type="text"
                    value={newPersonality.emoji || ''}
                    onChange={(e) => setNewPersonality({ ...newPersonality, emoji: e.target.value })}
                    placeholder="🤖"
                    className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-border text-text-primary"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm text-text-secondary mb-1">Description</label>
                <input
                  type="text"
                  value={newPersonality.description || ''}
                  onChange={(e) => setNewPersonality({ ...newPersonality, description: e.target.value })}
                  placeholder="Brief description of the personality"
                  className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-border text-text-primary"
                />
              </div>

              <div>
                <label className="block text-sm text-text-secondary mb-1">System Prompt</label>
                <textarea
                  value={newPersonality.systemPrompt || ''}
                  onChange={(e) => setNewPersonality({ ...newPersonality, systemPrompt: e.target.value })}
                  placeholder="Describe how the AI should respond..."
                  rows={10}
                  className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-border text-text-primary font-mono text-sm"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  onClick={() => {
                    setIsCreating(false);
                    setEditingId(null);
                  }}
                  className="px-4 py-2 rounded-lg bg-surface-secondary text-text-primary hover:bg-surface-hover transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={!newPersonality.name || !newPersonality.systemPrompt}
                  className="px-4 py-2 rounded-lg bg-primary-500 text-white hover:bg-primary-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {editingId ? 'Save Changes' : 'Create Personality'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const PipelineSettingsView: React.FC = () => {
  const { getAccessToken } = useAuth();
  const [config, setConfig] = useState<PipelineConfiguration | null>(null);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingModels, setLoadingModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [activeStage, setActiveStage] = useState<StageId>('toolExecution');
  const [hasChanges, setHasChanges] = useState(false);

  // View mode: 'pipeline' (stage config) or 'personalities' (personality manager)
  const [viewMode, setViewMode] = useState<'pipeline' | 'personalities'>('pipeline');

  // Personality state
  const [personalities, setPersonalities] = useState<Personality[]>(BUILT_IN_PERSONALITIES);
  const [activePersonality, setActivePersonality] = useState<string | null>(null);

  // Memoize all personalities (built-in + custom)
  const allPersonalities = useMemo(() => {
    return [...BUILT_IN_PERSONALITIES, ...personalities.filter(p => !p.isBuiltIn)];
  }, [personalities]);

  // Personality handlers
  const handleSavePersonality = useCallback((personality: Personality) => {
    setPersonalities(prev => {
      const existing = prev.findIndex(p => p.id === personality.id);
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = personality;
        return updated;
      }
      return [...prev, personality];
    });
    setHasChanges(true);
  }, []);

  const handleDeletePersonality = useCallback((id: string) => {
    setPersonalities(prev => prev.filter(p => p.id !== id));
    if (activePersonality === id) {
      setActivePersonality(null);
    }
    setHasChanges(true);
  }, [activePersonality]);

  const handleSelectPersonality = useCallback((id: string | null) => {
    setActivePersonality(id);
    setHasChanges(true);
  }, []);

  // Fetch configuration
  const fetchConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const response = await fetch('/api/admin/pipeline-config', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch configuration: ${response.statusText}`);
      }

      const data = await response.json();
      if (data.success) {
        setConfig(data.config);
        // Load personality state from config
        const promptConfig = data.config?.stages?.prompt;
        if (promptConfig) {
          setActivePersonality(promptConfig.activePersonalityId || null);
          if (promptConfig.customPersonalities?.length > 0) {
            setPersonalities([...BUILT_IN_PERSONALITIES, ...promptConfig.customPersonalities]);
          }
        }
      } else {
        throw new Error(data.error || 'Failed to fetch configuration');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load pipeline configuration');
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  // Fetch available models dynamically
  const fetchModels = useCallback(async () => {
    setLoadingModels(true);
    try {
      const token = await getAccessToken();
      const response = await fetch('/api/admin/pipeline-config/models', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.models) {
          setAvailableModels(data.models);
        }
      }
    } catch (err) {
      console.warn('Failed to load models, using text input fallback');
    } finally {
      setLoadingModels(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    fetchConfig();
    fetchModels();
  }, [fetchConfig, fetchModels]);

  // Save configuration
  const saveConfig = async () => {
    if (!config) return;

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      // Merge personality state into config before saving
      const configToSave = {
        ...config,
        stages: {
          ...config.stages,
          prompt: {
            ...config.stages.prompt,
            activePersonalityId: activePersonality,
            customPersonalities: personalities.filter(p => !p.isBuiltIn)
          }
        }
      };

      const token = await getAccessToken();
      const response = await fetch('/api/admin/pipeline-config', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(configToSave)
      });

      if (!response.ok) {
        throw new Error(`Failed to save configuration: ${response.statusText}`);
      }

      const data = await response.json();
      if (data.success) {
        setConfig(data.config);
        setSuccess('Configuration saved successfully');
        setHasChanges(false);
        setTimeout(() => setSuccess(null), 3000);
      } else {
        throw new Error(data.error || 'Failed to save configuration');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  // Reset to defaults
  const resetToDefaults = async () => {
    if (!confirm('Are you sure you want to reset all pipeline settings to defaults?')) return;

    setSaving(true);
    setError(null);

    try {
      const token = await getAccessToken();
      const response = await fetch('/api/admin/pipeline-config/reset', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to reset configuration: ${response.statusText}`);
      }

      const data = await response.json();
      if (data.success) {
        setConfig(data.config);
        // Reset personality state to defaults
        setActivePersonality(null);
        setPersonalities(BUILT_IN_PERSONALITIES);
        setSuccess('Configuration reset to defaults');
        setHasChanges(false);
        setTimeout(() => setSuccess(null), 3000);
      } else {
        throw new Error(data.error || 'Failed to reset configuration');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to reset configuration');
    } finally {
      setSaving(false);
    }
  };

  // Update stage config
  const updateStageConfig = <K extends keyof PipelineConfiguration['stages']>(
    stageName: K,
    field: string,
    value: any
  ) => {
    if (!config) return;

    setConfig(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        stages: {
          ...prev.stages,
          [stageName]: {
            ...prev.stages[stageName],
            [field]: value
          }
        }
      };
    });
    setHasChanges(true);
  };

  // Update nested config (for multiModel.roles)
  const updateNestedConfig = <K extends keyof PipelineConfiguration['stages']>(
    stageName: K,
    path: string[],
    value: any
  ) => {
    if (!config) return;

    setConfig(prev => {
      if (!prev) return prev;
      const stageConfig = { ...prev.stages[stageName] } as any;

      let current = stageConfig;
      for (let i = 0; i < path.length - 1; i++) {
        current[path[i]] = { ...current[path[i]] };
        current = current[path[i]];
      }
      current[path[path.length - 1]] = value;

      return {
        ...prev,
        stages: {
          ...prev.stages,
          [stageName]: stageConfig
        }
      };
    });
    setHasChanges(true);
  };

  // Render helpers
  const renderToggle = (
    stageName: keyof PipelineConfiguration['stages'],
    field: string,
    value: boolean,
    label: string
  ) => (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-0">
      <span className="text-sm text-text-primary">{label}</span>
      <button
        onClick={() => updateStageConfig(stageName, field, !value)}
        className={`p-1 rounded-md transition-colors ${value ? 'text-green-500' : 'text-text-secondary'}`}
      >
        {value ? <Icons.ToggleRight size={28} /> : <Icons.ToggleLeft size={28} />}
      </button>
    </div>
  );

  const renderNumberInput = (
    stageName: keyof PipelineConfiguration['stages'],
    field: string,
    value: number,
    label: string,
    min?: number,
    max?: number,
    step?: number
  ) => (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-0">
      <span className="text-sm text-text-primary">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step || 1}
        onChange={(e) => updateStageConfig(stageName, field, parseFloat(e.target.value) || 0)}
        className="w-28 px-3 py-1.5 text-sm rounded-lg bg-surface-secondary border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500"
      />
    </div>
  );

  const renderTextInput = (
    stageName: keyof PipelineConfiguration['stages'],
    field: string,
    value: string,
    label: string,
    placeholder?: string
  ) => (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-0">
      <span className="text-sm text-text-primary">{label}</span>
      <input
        type="text"
        value={value || ''}
        placeholder={placeholder}
        onChange={(e) => updateStageConfig(stageName, field, e.target.value)}
        className="w-56 px-3 py-1.5 text-sm rounded-lg bg-surface-secondary border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500"
      />
    </div>
  );

  const renderModelSelect = (
    stageName: keyof PipelineConfiguration['stages'],
    field: string,
    value: string,
    label: string,
    filterThinking?: boolean
  ) => {
    const models = filterThinking
      ? availableModels.filter(m => m.thinking)
      : availableModels;

    return (
      <div className="flex items-center justify-between py-3 border-b border-border last:border-0">
        <span className="text-sm text-text-primary">{label}</span>
        {availableModels.length > 0 ? (
          <div className="relative">
            <select
              value={value || ''}
              onChange={(e) => updateStageConfig(stageName, field, e.target.value)}
              className="w-64 px-3 py-1.5 text-sm rounded-lg bg-surface-secondary border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500 appearance-none pr-8"
            >
              <option value="">Select a model...</option>
              {models.map(model => (
                <option key={model.id} value={model.id}>
                  {model.displayName} ({model.provider})
                </option>
              ))}
            </select>
            <Icons.ChevronDown size={16} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none" />
          </div>
        ) : (
          <input
            type="text"
            value={value || ''}
            placeholder="model-id"
            onChange={(e) => updateStageConfig(stageName, field, e.target.value)}
            className="w-64 px-3 py-1.5 text-sm rounded-lg bg-surface-secondary border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        )}
      </div>
    );
  };

  const renderNestedModelSelect = (
    stageName: keyof PipelineConfiguration['stages'],
    path: string[],
    value: string,
    label: string,
    filterThinking?: boolean
  ) => {
    const models = filterThinking
      ? availableModels.filter(m => m.thinking)
      : availableModels;

    return (
      <div className="flex items-center justify-between py-3 border-b border-border last:border-0">
        <span className="text-sm text-text-primary">{label}</span>
        {availableModels.length > 0 ? (
          <div className="relative">
            <select
              value={value || ''}
              onChange={(e) => updateNestedConfig(stageName, path, e.target.value)}
              className="w-64 px-3 py-1.5 text-sm rounded-lg bg-surface-secondary border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500 appearance-none pr-8"
            >
              <option value="">Select a model...</option>
              {models.map(model => (
                <option key={model.id} value={model.id}>
                  {model.displayName} ({model.provider})
                </option>
              ))}
            </select>
            <Icons.ChevronDown size={16} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none" />
          </div>
        ) : (
          <input
            type="text"
            value={value || ''}
            placeholder="model-id"
            onChange={(e) => updateNestedConfig(stageName, path, e.target.value)}
            className="w-64 px-3 py-1.5 text-sm rounded-lg bg-surface-secondary border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        )}
      </div>
    );
  };

  const renderNestedNumberInput = (
    stageName: keyof PipelineConfiguration['stages'],
    path: string[],
    value: number,
    label: string,
    min?: number,
    max?: number,
    step?: number
  ) => (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-0">
      <span className="text-sm text-text-primary">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step || 1}
        onChange={(e) => updateNestedConfig(stageName, path, parseFloat(e.target.value) || 0)}
        className="w-28 px-3 py-1.5 text-sm rounded-lg bg-surface-secondary border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500"
      />
    </div>
  );

  // Render stage content
  const renderStageContent = (stageId: StageId) => {
    if (!config) return null;
    const stageConfig = config.stages[stageId];

    switch (stageId) {
      case 'auth':
        const auth = stageConfig as AuthStageConfig;
        return (
          <div className="space-y-1">
            {renderNumberInput('auth', 'rateLimitPerMinute', auth.rateLimitPerMinute, 'Rate Limit (per minute)', 0, 1000)}
            {renderNumberInput('auth', 'rateLimitPerHour', auth.rateLimitPerHour, 'Rate Limit (per hour)', 0, 10000)}
            {renderToggle('auth', 'allowOnRateLimitFailure', auth.allowOnRateLimitFailure, 'Allow on Rate Limit Failure')}
          </div>
        );

      case 'validation':
        const validation = stageConfig as ValidationStageConfig;
        return (
          <div className="space-y-1">
            {renderNumberInput('validation', 'maxHistory', validation.maxHistory, 'Max History Messages', 1, 1000)}
            {renderToggle('validation', 'enableMemoryContextService', validation.enableMemoryContextService, 'Enable Memory Context Service')}
            {renderNumberInput('validation', 'maxContextTokens', validation.maxContextTokens, 'Max Context Tokens', 1000, 200000)}
          </div>
        );

      case 'rag':
        const rag = stageConfig as RAGStageConfig;
        return (
          <div className="space-y-1">
            {renderToggle('rag', 'enabled', rag.enabled, 'Enable RAG')}
            {renderNumberInput('rag', 'topK', rag.topK, 'Top K Results', 1, 50)}
            {renderNumberInput('rag', 'minimumScore', rag.minimumScore, 'Minimum Score', 0, 1, 0.1)}
            {renderToggle('rag', 'enableHybridSearch', rag.enableHybridSearch, 'Enable Hybrid Search')}
          </div>
        );

      case 'memory':
        const memory = stageConfig as MemoryStageConfig;
        return (
          <div className="space-y-1">
            {renderToggle('memory', 'enabled', memory.enabled, 'Enable Memory')}
            {renderNumberInput('memory', 'sessionMemoryLimit', memory.sessionMemoryLimit, 'Session Memory Limit', 1, 100)}
            {renderToggle('memory', 'enableAutoExtraction', memory.enableAutoExtraction, 'Enable Auto Extraction')}
            {renderNumberInput('memory', 'searchLimit', memory.searchLimit, 'Search Limit', 1, 100)}
          </div>
        );

      case 'prompt':
        const prompt = stageConfig as PromptStageConfig;
        return (
          <div className="space-y-1">
            {renderToggle('prompt', 'enableDynamicPrompts', prompt.enableDynamicPrompts, 'Enable Dynamic Prompts')}
            {renderTextInput('prompt', 'defaultTemplateId', prompt.defaultTemplateId || '', 'Default Template ID', 'template-id')}
            {renderToggle('prompt', 'enablePersonality', prompt.enablePersonality, 'Enable Personality')}
          </div>
        );

      case 'mcp':
        const mcp = stageConfig as MCPStageConfig;
        return (
          <div className="space-y-1">
            {renderToggle('mcp', 'enabled', mcp.enabled, 'Enable MCP')}
            {renderNumberInput('mcp', 'semanticSearchTopK', mcp.semanticSearchTopK, 'Semantic Search Top K', 1, 100)}
            {renderToggle('mcp', 'enableIntentBoosting', mcp.enableIntentBoosting, 'Enable Intent Boosting')}
            {renderNumberInput('mcp', 'intentBoostLimit', mcp.intentBoostLimit, 'Intent Boost Limit', 1, 50)}
            {renderToggle('mcp', 'enableWebToolsInjection', mcp.enableWebToolsInjection, 'Enable Web Tools Injection')}
            {renderNumberInput('mcp', 'maxToolsPerRequest', mcp.maxToolsPerRequest, 'Max Tools Per Request', 1, 128)}
            {renderToggle('mcp', 'enableTieredFC', mcp.enableTieredFC, 'Enable Tiered Function Calling')}
          </div>
        );

      case 'messagePreparation':
        const msgPrep = stageConfig as MessagePreparationStageConfig;
        return (
          <div className="space-y-1">
            {renderToggle('messagePreparation', 'enableDeduplication', msgPrep.enableDeduplication, 'Enable Deduplication')}
            {renderToggle('messagePreparation', 'enableToolCallValidation', msgPrep.enableToolCallValidation, 'Enable Tool Call Validation')}
          </div>
        );

      case 'completion':
        const completion = stageConfig as CompletionStageConfig;
        return (
          <div className="space-y-1">
            {renderModelSelect('completion', 'defaultModel', completion.defaultModel, 'Default Model')}
            {renderNumberInput('completion', 'defaultTemperature', completion.defaultTemperature, 'Default Temperature', 0, 2, 0.1)}
            {renderNumberInput('completion', 'defaultMaxTokens', completion.defaultMaxTokens, 'Default Max Tokens', 100, 100000)}
            {renderNumberInput('completion', 'defaultThinkingBudget', completion.defaultThinkingBudget, 'Default Thinking Budget', 0, 100000)}
            {renderToggle('completion', 'enableIntelligentRouting', completion.enableIntelligentRouting, 'Enable Intelligent Routing')}
            {renderNumberInput('completion', 'streamPersistIntervalMs', completion.streamPersistIntervalMs, 'Stream Persist Interval (ms)', 100, 10000)}
            {renderNumberInput('completion', 'tokenUpdateIntervalMs', completion.tokenUpdateIntervalMs, 'Token Update Interval (ms)', 100, 5000)}
            {renderToggle('completion', 'enableStreaming', completion.enableStreaming, 'Enable Streaming')}
            {renderTextInput('completion', 'visionCapableModels', completion.visionCapableModels, 'Vision Capable Models', 'model1,model2')}
          </div>
        );

      case 'multiModel':
        const multiModel = stageConfig as MultiModelStageConfig;
        return (
          <div className="space-y-4">
            <div className="space-y-1">
              <h4 className="text-sm font-medium text-text-primary mb-2">General Settings</h4>
              {renderToggle('multiModel', 'enabled', multiModel.enabled, 'Enable Multi-Model')}
              {renderNumberInput('multiModel', 'sliderThreshold', multiModel.sliderThreshold, 'Slider Threshold (%)', 0, 100)}
              {renderNumberInput('multiModel', 'configCacheTtlMs', multiModel.configCacheTtlMs, 'Config Cache TTL (ms)', 1000, 600000)}
            </div>

            <div className="space-y-1">
              <h4 className="text-sm font-medium text-text-primary mb-2">Role Assignments</h4>
              <div className="bg-surface-secondary/50 rounded-lg p-3 space-y-1">
                <p className="text-xs text-text-secondary mb-2">Reasoning Role (for complex analysis)</p>
                {renderNestedModelSelect('multiModel', ['roles', 'reasoning', 'primaryModel'], multiModel.roles.reasoning.primaryModel, 'Primary Model', true)}
                {renderNestedNumberInput('multiModel', ['roles', 'reasoning', 'thinkingBudget'], multiModel.roles.reasoning.thinkingBudget, 'Thinking Budget', 0, 100000)}
                {renderNestedNumberInput('multiModel', ['roles', 'reasoning', 'temperature'], multiModel.roles.reasoning.temperature, 'Temperature', 0, 2, 0.1)}
              </div>

              <div className="bg-surface-secondary/50 rounded-lg p-3 space-y-1">
                <p className="text-xs text-text-secondary mb-2">Tool Execution Role (for tool calls)</p>
                {renderNestedModelSelect('multiModel', ['roles', 'toolExecution', 'primaryModel'], multiModel.roles.toolExecution.primaryModel, 'Primary Model')}
                {renderNestedNumberInput('multiModel', ['roles', 'toolExecution', 'temperature'], multiModel.roles.toolExecution.temperature, 'Temperature', 0, 2, 0.1)}
              </div>

              <div className="bg-surface-secondary/50 rounded-lg p-3 space-y-1">
                <p className="text-xs text-text-secondary mb-2">Synthesis Role (for final response)</p>
                {renderNestedModelSelect('multiModel', ['roles', 'synthesis', 'primaryModel'], multiModel.roles.synthesis.primaryModel, 'Primary Model')}
                {renderNestedNumberInput('multiModel', ['roles', 'synthesis', 'temperature'], multiModel.roles.synthesis.temperature, 'Temperature', 0, 2, 0.1)}
              </div>

              <div className="bg-surface-secondary/50 rounded-lg p-3 space-y-1">
                <p className="text-xs text-text-secondary mb-2">Fallback Role (when errors occur)</p>
                {renderNestedModelSelect('multiModel', ['roles', 'fallback', 'primaryModel'], multiModel.roles.fallback.primaryModel, 'Primary Model')}
                {renderNestedNumberInput('multiModel', ['roles', 'fallback', 'temperature'], multiModel.roles.fallback.temperature, 'Temperature', 0, 2, 0.1)}
              </div>
            </div>

            <div className="space-y-1">
              <h4 className="text-sm font-medium text-text-primary mb-2">Routing</h4>
              {renderNestedNumberInput('multiModel', ['routing', 'complexityThreshold'], multiModel.routing.complexityThreshold, 'Complexity Threshold', 0, 100)}
              {renderNestedNumberInput('multiModel', ['routing', 'maxHandoffs'], multiModel.routing.maxHandoffs, 'Max Handoffs', 1, 20)}
            </div>
          </div>
        );

      case 'toolExecution':
        const toolExec = stageConfig as ToolExecutionConfig;
        return (
          <div className="space-y-1">
            <div className="py-3 px-4 bg-yellow-500/10 rounded-lg mb-3">
              <div className="flex items-center gap-2 text-yellow-500">
                <Icons.Info size={16} />
                <span className="text-xs font-medium">Key Setting</span>
              </div>
              <p className="text-xs text-text-secondary mt-1">
                Max Tool Call Rounds controls how many times the LLM can call tools before forcing a final response.
              </p>
            </div>
            {renderNumberInput('toolExecution', 'maxToolCallRounds', toolExec.maxToolCallRounds, 'Max Tool Call Rounds', 1, 50)}
            {renderToggle('toolExecution', 'enableToolResultCaching', toolExec.enableToolResultCaching, 'Enable Tool Result Caching')}
            {renderNumberInput('toolExecution', 'toolResultCacheTtlHours', toolExec.toolResultCacheTtlHours, 'Cache TTL (hours)', 1, 168)}
            {renderToggle('toolExecution', 'enableCrossUserCaching', toolExec.enableCrossUserCaching, 'Enable Cross-User Caching')}
          </div>
        );

      case 'response':
        const response = stageConfig as ResponseStageConfig;
        return (
          <div className="space-y-1">
            {renderToggle('response', 'enableDeduplication', response.enableDeduplication, 'Enable Deduplication')}
            {renderToggle('response', 'enableAutoSummary', response.enableAutoSummary, 'Enable Auto Summary')}
            {renderNumberInput('response', 'autoSummaryThreshold', response.autoSummaryThreshold, 'Auto Summary Threshold', 1, 1000)}
          </div>
        );

      default:
        return <p className="text-text-secondary text-sm">Configuration not available</p>;
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Icons.Loader2 size={32} className="text-primary-500" />
        <span className="ml-3 text-text-secondary">Loading pipeline configuration...</span>
      </div>
    );
  }

  const activeStageInfo = STAGES.find(s => s.id === activeStage);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-text-primary">Pipeline Settings</h2>
          <p className="text-sm text-text-secondary">
            Configure chat pipeline stages in order of execution (left → right)
          </p>
          {config && (
            <p className="text-xs text-text-secondary mt-1">
              v{config.version} | Updated: {new Date(config.updatedAt).toLocaleString()} by {config.updatedBy}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchConfig}
            disabled={loading}
            className="px-3 py-2 rounded-lg bg-surface-secondary text-text-primary hover:bg-surface-hover transition-colors flex items-center gap-2"
          >
            <Icons.RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            onClick={resetToDefaults}
            disabled={saving}
            className="px-3 py-2 rounded-lg bg-orange-500/10 text-orange-500 hover:bg-orange-500/20 transition-colors flex items-center gap-2"
          >
            <Icons.RotateCcw size={16} />
            Reset
          </button>
          <button
            onClick={saveConfig}
            disabled={saving || !hasChanges}
            className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-colors ${
              hasChanges
                ? 'bg-primary-500 text-white hover:bg-primary-600'
                : 'bg-surface-secondary text-text-secondary cursor-not-allowed'
            }`}
          >
            {saving ? <Icons.Loader2 size={16} /> : <Icons.Save size={16} />}
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Status Messages */}
      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center gap-3">
          <Icons.AlertCircle className="text-red-500" size={18} />
          <span className="text-red-500 text-sm">{error}</span>
        </div>
      )}
      {success && (
        <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 flex items-center gap-3">
          <Icons.CheckCircle className="text-green-500" size={18} />
          <span className="text-green-500 text-sm">{success}</span>
        </div>
      )}

      {/* View Mode Toggle */}
      <div className="flex gap-2 p-1 bg-surface-secondary/50 rounded-xl w-fit">
        <button
          onClick={() => setViewMode('pipeline')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            viewMode === 'pipeline'
              ? 'bg-primary-500 text-white shadow-md'
              : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'
          }`}
        >
          <Icons.Layers size={16} />
          Pipeline Stages
        </button>
        <button
          onClick={() => setViewMode('personalities')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            viewMode === 'personalities'
              ? 'bg-primary-500 text-white shadow-md'
              : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'
          }`}
        >
          <Icons.Sparkles size={16} />
          Personalities
          {activePersonality && (
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          )}
        </button>
      </div>

      {/* Personality Manager View */}
      {viewMode === 'personalities' && (
        <div className="glass-card p-6">
          <PersonalityManager
            personalities={allPersonalities}
            activePersonality={activePersonality}
            onSelectPersonality={handleSelectPersonality}
            onSavePersonality={handleSavePersonality}
            onDeletePersonality={handleDeletePersonality}
          />
        </div>
      )}

      {/* Pipeline View */}
      {viewMode === 'pipeline' && config && (
        <>
          {/* Pipeline Visualization Diagram */}
          <div className="glass-card p-4">
            <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
              <Icons.Layers size={16} className="text-primary-500" />
              Chat Pipeline Flow
              <span className="text-xs text-text-secondary font-normal">(click a stage to configure)</span>
            </h3>
            <PipelineVisualization
              activeStage={activeStage}
              onStageClick={setActiveStage}
            />
          </div>
        </>
      )}

      {/* Horizontal Tabs */}
      {viewMode === 'pipeline' && config && (
        <div className="glass-card overflow-hidden">
          {/* Tab Bar */}
          <div className="flex overflow-x-auto border-b border-border bg-surface-secondary/30">
            {STAGES.map((stage, index) => {
              const Icon = stage.icon;
              const isActive = activeStage === stage.id;
              return (
                <button
                  key={stage.id}
                  onClick={() => setActiveStage(stage.id)}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                    isActive
                      ? 'border-primary-500 text-primary-500 bg-primary-500/5'
                      : 'border-transparent text-text-secondary hover:text-text-primary hover:bg-surface-hover'
                  }`}
                >
                  <div className={`p-1 rounded ${stage.color}`}>
                    <Icon size={14} />
                  </div>
                  <span className="hidden sm:inline">{stage.shortLabel}</span>
                  <span className="text-xs text-text-secondary hidden lg:inline">({index + 1})</span>
                </button>
              );
            })}
          </div>

          {/* Active Stage Content */}
          <div className="p-6">
            {activeStageInfo && (
              <>
                <div className="mb-4">
                  <div className="flex items-center gap-3 mb-2">
                    <div className={`p-2 rounded-lg ${activeStageInfo.color}`}>
                      <activeStageInfo.icon size={20} />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-text-primary">{activeStageInfo.label}</h3>
                      <p className="text-sm text-text-secondary">{activeStageInfo.description}</p>
                    </div>
                  </div>
                </div>
                {renderStageContent(activeStage)}
              </>
            )}
          </div>
        </div>
      )}

      {/* Models Loading Indicator */}
      {loadingModels && (
        <div className="text-xs text-text-secondary flex items-center gap-2">
          <Icons.Loader2 size={12} />
          Loading available models...
        </div>
      )}
    </div>
  );
};

export default PipelineSettingsView;
