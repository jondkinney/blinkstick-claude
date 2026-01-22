#!/usr/bin/env node
/**
 * Detect if Claude's last message is asking the user a question
 * Reads hook input JSON from stdin, analyzes transcript
 * Outputs JSON: { "is_question": true/false, "type": "..." }
 */

import { readFileSync } from "fs";
import { createInterface } from "readline";

async function readStdin() {
  const rl = createInterface({ input: process.stdin });
  const lines = [];
  for await (const line of rl) {
    lines.push(line);
  }
  return lines.join("\n");
}

function getLastAssistantMessage(transcriptPath) {
  try {
    const content = readFileSync(transcriptPath, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);

    // Find the last assistant message (iterate backwards)
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if (entry.type === "assistant" && entry.message?.content) {
          // Extract text from content array
          const textParts = entry.message.content
            .filter((c) => c.type === "text")
            .map((c) => c.text);
          return textParts.join("\n");
        }
      } catch (e) {
        // Skip malformed lines
      }
    }
  } catch (e) {
    // File doesn't exist or can't be read
  }
  return null;
}

function analyzeForQuestion(text) {
  if (!text) {
    return { is_question: false, type: null };
  }

  // Get the last 500 characters to focus on the ending
  const ending = text.slice(-500);

  // Plan mode / approval patterns
  const planPatterns = [
    /would you like (?:me )?to proceed/i,
    /should I (?:proceed|continue|go ahead)/i,
    /do you want me to/i,
    /shall I/i,
    /ready (?:to|for) (?:proceed|continue|implement)/i,
    /approve (?:this|the) plan/i,
    /is (?:this|the) plan (?:ok|okay|good|acceptable)/i,
    /let me know (?:if|when)/i,
    /awaiting (?:your )?(?:approval|confirmation)/i,
  ];

  for (const pattern of planPatterns) {
    if (pattern.test(ending)) {
      return { is_question: true, type: "plan_approval" };
    }
  }

  // Choice/option patterns
  const choicePatterns = [
    /which (?:option|approach|method) (?:would you|do you)/i,
    /(?:option|choice) \d+/i,
    /would you (?:prefer|like|want)/i,
    /what would you (?:prefer|like)/i,
  ];

  for (const pattern of choicePatterns) {
    if (pattern.test(ending)) {
      return { is_question: true, type: "choice" };
    }
  }

  // Check if ends with a question mark (common case)
  // Look at last 200 chars, strip whitespace, check ending
  const trimmed = ending.trim();
  if (trimmed.endsWith("?")) {
    // Determine type based on content
    if (/clarif|understand|mean/i.test(ending)) {
      return { is_question: true, type: "clarification" };
    }
    if (/example|implement|create|build/i.test(ending)) {
      return { is_question: true, type: "implementation" };
    }
    return { is_question: true, type: "general" };
  }

  return { is_question: false, type: null };
}

async function main() {
  try {
    const input = await readStdin();
    const hookInput = JSON.parse(input);

    const transcriptPath = hookInput.transcript_path;
    if (!transcriptPath) {
      console.log(JSON.stringify({ is_question: false, type: null, error: "no_transcript" }));
      process.exit(0);
    }

    const lastMessage = getLastAssistantMessage(transcriptPath);
    const result = analyzeForQuestion(lastMessage);

    console.log(JSON.stringify(result));
    process.exit(0);
  } catch (e) {
    console.log(JSON.stringify({ is_question: false, type: null, error: e.message }));
    process.exit(0);
  }
}

main();
