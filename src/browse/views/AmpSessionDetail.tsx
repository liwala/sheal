import { Box, Text, useInput, useStdout } from "ink";
import { useState, useMemo } from "react";
import { listAmpThreadFiles } from "@liwala/agent-sessions";
import type { AmpFileChange } from "@liwala/agent-sessions";
import { StatusBar } from "../components/StatusBar.js";

interface AmpSessionDetailProps {
  threadId: string;
  projectPath: string;
  onBack: () => void;
  onQuit: () => void;
}

export function AmpSessionDetail({ threadId, projectPath, onBack, onQuit }: AmpSessionDetailProps) {
  const [cursor, setCursor] = useState(0);
  const [showDiff, setShowDiff] = useState(false);
  const { stdout } = useStdout();
  const maxRows = (stdout?.rows ?? 24) - 10;

  const files = useMemo(() => listAmpThreadFiles(threadId), [threadId]);

  const selectedFile = files[cursor] as AmpFileChange | undefined;

  const relativePath = (f: AmpFileChange) => {
    if (f.filePath.startsWith(projectPath)) {
      return f.filePath.slice(projectPath.length + 1);
    }
    return f.filePath;
  };

  useInput((input, key) => {
    if (input === "q") { onQuit(); return; }
    if (key.escape) {
      if (showDiff) {
        setShowDiff(false);
      } else {
        onBack();
      }
      return;
    }

    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
      setShowDiff(false);
    } else if (key.downArrow) {
      setCursor((c) => Math.min(files.length - 1, c + 1));
      setShowDiff(false);
    } else if (key.return && selectedFile) {
      setShowDiff(!showDiff);
    }
  });

  if (files.length === 0) {
    return (
      <Box flexDirection="column">
        <Text color="red">No file changes found for thread: {threadId}</Text>
        <StatusBar view="detail" searchActive={false} />
      </Box>
    );
  }

  const revertedCount = files.filter((f) => f.reverted).length;
  const newCount = files.filter((f) => f.isNewFile).length;
  const earliest = files[0];
  const latest = files[files.length - 1];

  if (showDiff && selectedFile) {
    // Show diff view
    const diffLines = selectedFile.diff.split("\n");
    return (
      <Box flexDirection="column">
        <Box marginBottom={1} flexDirection="column">
          <Box>
            <Text bold>Amp Thread </Text>
            <Text bold color="cyan">{threadId}</Text>
            <Text dimColor> | Amp</Text>
          </Box>
          <Text bold>{relativePath(selectedFile)}</Text>
          {selectedFile.isNewFile && <Text color="green">[new file]</Text>}
          {selectedFile.reverted && <Text color="red">[reverted]</Text>}
          <Text dimColor>esc to go back to file list</Text>
        </Box>

        <Box flexDirection="column" height={maxRows}>
          {diffLines.slice(0, maxRows).map((line, i) => {
            let color: string | undefined;
            if (line.startsWith("+") && !line.startsWith("+++")) color = "green";
            else if (line.startsWith("-") && !line.startsWith("---")) color = "red";
            else if (line.startsWith("@@")) color = "cyan";
            return (
              <Text key={i} color={color as any} wrap="wrap">
                {line.slice(0, 120)}
              </Text>
            );
          })}
          {diffLines.length > maxRows && (
            <Text dimColor>... {diffLines.length - maxRows} more lines</Text>
          )}
        </Box>

        <StatusBar view="detail" searchActive={false} info="esc Back to files  q Quit" />
      </Box>
    );
  }

  // File list view
  return (
    <Box flexDirection="column">
      <Box marginBottom={1} flexDirection="column">
        <Box>
          <Text bold>Amp Thread </Text>
          <Text bold color="cyan">{threadId}</Text>
          <Text dimColor> | Amp</Text>
        </Box>
        <Text dimColor>
          {new Date(earliest.timestamp).toISOString().slice(0, 16)}
          {latest.timestamp !== earliest.timestamp && ` — ${new Date(latest.timestamp).toISOString().slice(0, 16)}`}
        </Text>
        <Text dimColor>
          {files.length} file(s)
          {newCount > 0 && ` (${newCount} new)`}
          {revertedCount > 0 && ` (${revertedCount} reverted)`}
        </Text>
      </Box>

      <Box flexDirection="column" height={maxRows}>
        {files.slice(0, maxRows).map((f, i) => (
          <Box key={f.id}>
            <Text color={i === cursor ? "cyan" : undefined} bold={i === cursor}>
              {i === cursor ? "> " : "  "}
            </Text>
            {f.isNewFile && <Text color="green">[new] </Text>}
            {f.reverted && <Text color="red">[reverted] </Text>}
            <Text color={i === cursor ? "cyan" : undefined} bold={i === cursor}>
              {relativePath(f)}
            </Text>
            <Text dimColor> {new Date(f.timestamp).toISOString().slice(11, 19)}</Text>
          </Box>
        ))}
        {files.length > maxRows && (
          <Text dimColor>  ... {files.length - maxRows} more files</Text>
        )}
      </Box>

      <StatusBar view="detail" searchActive={false} info="^/v Navigate  enter View diff  esc Back  q Quit" />
    </Box>
  );
}
