export function startDesktopHarness(): Promise<Readonly<{
  url: string;
  close: () => Promise<void>;
}>>;
