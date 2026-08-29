import {
  redactMetadataEvent,
  type MetadataLogEvent,
} from "./redaction.js";

export type { MetadataLogEvent, MetadataLogRecord } from "./redaction.js";

export type MetadataLogLevel = "off" | "metadata";

export type MetadataLogger = Readonly<{
  level: MetadataLogLevel;
  log(event: MetadataLogEvent): void;
}>;

export type MetadataLoggerOptions = Readonly<{
  level?: MetadataLogLevel;
  write?: (jsonl: string) => void;
  now?: () => Date;
}>;

export const NOOP_METADATA_LOGGER: MetadataLogger = Object.freeze({
  level: "off",
  log(): void {},
});

function writeToStderr(jsonl: string): void {
  process.stderr.write(jsonl);
}

export function createMetadataLogger(
  options: MetadataLoggerOptions = {},
): MetadataLogger {
  const level = options.level ?? "metadata";
  const write = options.write ?? writeToStderr;
  const now = options.now ?? (() => new Date());

  return {
    level,
    log(event): void {
      if (level === "off") return;
      const record = redactMetadataEvent(event, now());
      write(`${JSON.stringify(record)}\n`);
    },
  };
}
