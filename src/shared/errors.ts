export class HumanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HumanError";
  }
}

export function toHumanMessage(error: unknown): string {
  if (error instanceof HumanError) {
    return error.message;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unable to continue.";
}
