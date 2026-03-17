import { Box, Text } from "ink";
import TextInput from "ink-text-input";

interface SearchBarProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

export function SearchBar({ label, value, onChange }: SearchBarProps) {
  return (
    <Box>
      <Text color="yellow">{label}: </Text>
      <TextInput value={value} onChange={onChange} />
    </Box>
  );
}
