import { Box, Text, useInput, useStdout } from "ink";
import { useState, useMemo, useEffect } from "react";
import { openSync, readSync, closeSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { listAllNativeProjects } from "@liwala/agent-sessions";
import type { SearchResult } from "../types.js";
import { SearchBar } from "../components/SearchBar.js";
import { StatusBar } from "../components/StatusBar.js";

interface SearchResultsProps {
  initialQuery?: string;
  onSelectSession: (slug: string, sessionId: string) => void;
  onBack: () => void;
  onQuit: () => void;
}

export function SearchResults({ initialQuery, onSelectSession, onBack, onQuit }: SearchResultsProps) {
  const [cursor, setCursor] = useState(0);
  const [query, setQuery] = useState(initialQuery || "");
  const [inputActive, setInputActive] = useState(!initialQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchDone, setSearchDone] = useState(false);
  const { stdout } = useStdout();
  const maxRows = (stdout?.rows ?? 24) - 8;

  const projects = useMemo(() => listAllNativeProjects(), []);

  // Trigger search when query is confirmed
  useEffect(() => {
    if (!query || inputActive) return;

    setSearching(true);
    setSearchDone(false);
    setResults([]);

    // Run search async to not block rendering
    const timer = setTimeout(() => {
      const found = searchTranscripts(projects, query);
      setResults(found);
      setSearching(false);
      setSearchDone(true);
      setCursor(0);
    }, 10);

    return () => clearTimeout(timer);
  }, [query, inputActive, projects]);

  useInput((input, key) => {
    if (inputActive) {
      if (key.escape) {
        if (query) {
          setInputActive(false);
          setQuery("");
        } else {
          onBack();
        }
      } else if (key.return && query) {
        setInputActive(false);
      }
      return;
    }

    if (input === "q") { onQuit(); return; }
    if (key.escape) { onBack(); return; }
    if (input === "/") { setInputActive(true); return; }

    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
    } else if (key.downArrow) {
      setCursor((c) => Math.min(results.length - 1, c + 1));
    } else if (key.return && results[cursor]) {
      const r = results[cursor];
      onSelectSession(r.slug, r.sessionId);
    }
  });

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Transcript Search</Text>
        {searchDone && <Text dimColor> ({results.length} results across {projects.length} projects)</Text>}
      </Box>

      {inputActive ? (
        <SearchBar label="Search transcripts" value={query} onChange={setQuery} />
      ) : (
        query && <Text dimColor>Query: "{query}" (/ to change)</Text>
      )}

      {searching && <Text color="yellow">Searching {projects.reduce((s, p) => s + p.sessionCount, 0)} sessions...</Text>}

      <Box flexDirection="column" height={maxRows}>
        {results.slice(0, maxRows).map((r, i) => (
          <Box key={`${r.slug}-${r.sessionId}`} flexDirection="column">
            <Box>
              <Text color={i === cursor ? "cyan" : undefined} bold={i === cursor}>
                {i === cursor ? "> " : "  "}
                {r.projectName}
              </Text>
              <Text dimColor> {r.sessionId.slice(0, 12)} {r.createdAt?.slice(0, 16)}</Text>
              <Text color="yellow"> ({r.matchCount} hits)</Text>
            </Box>
            {r.snippet && (
              <Text dimColor wrap="truncate">    {r.snippet.slice(0, 100)}</Text>
            )}
          </Box>
        ))}
        {searchDone && results.length === 0 && (
          <Text dimColor>  No matches found</Text>
        )}
      </Box>

      <StatusBar view="search-results" searchActive={inputActive} />
    </Box>
  );
}

/** Read the first `maxBytes` of a file and return complete lines. */
function readHeadBytes(path: string, maxBytes: number): string {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(maxBytes);
    const bytesRead = readSync(fd, buf, 0, maxBytes, 0);
    const raw = buf.toString("utf-8", 0, bytesRead);
    const lastNewline = raw.lastIndexOf("\n");
    return lastNewline >= 0 ? raw.slice(0, lastNewline) : raw;
  } finally {
    closeSync(fd);
  }
}

/**
 * Search all session JSONL files for a query string.
 * Does raw string matching on JSONL lines (no JSON parsing) for speed.
 * Reads only the first 128KB per file to avoid loading multi-MB sessions.
 */
function searchTranscripts(
  projects: ReturnType<typeof listAllNativeProjects>,
  query: string,
): SearchResult[] {
  const results: SearchResult[] = [];
  const q = query.toLowerCase();
  const projectsDir = join(homedir(), ".claude", "projects");

  for (const project of projects) {
    const dir = join(projectsDir, project.slug);
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }

    for (const file of files) {
      const sessionId = file.replace(".jsonl", "");
      try {
        // Read only first 128KB per session file for search (avoid loading multi-MB files)
        const content = readHeadBytes(join(dir, file), 128 * 1024);
        const lines = content.split("\n");
        let matchCount = 0;
        let firstSnippet = "";

        for (const line of lines) {
          if (line.toLowerCase().includes(q)) {
            matchCount++;
            if (!firstSnippet) {
              // Try to extract readable text from the matching line
              try {
                const obj = JSON.parse(line);
                if (obj.message?.content && typeof obj.message.content === "string") {
                  const idx = obj.message.content.toLowerCase().indexOf(q);
                  if (idx >= 0) {
                    const start = Math.max(0, idx - 40);
                    firstSnippet = obj.message.content.slice(start, start + 120);
                  }
                }
              } catch {
                // Use raw line snippet
                const idx = line.toLowerCase().indexOf(q);
                firstSnippet = line.slice(Math.max(0, idx - 40), idx + 80);
              }
            }
          }
        }

        if (matchCount > 0) {
          results.push({
            slug: project.slug,
            sessionId,
            projectName: project.name,
            createdAt: "", // We'd need to parse for this, skip for perf
            matchCount,
            snippet: firstSnippet,
          });
        }
      } catch {
        // skip unreadable files
      }
    }
  }

  results.sort((a, b) => b.matchCount - a.matchCount);
  return results;
}
