export class AlbomRuntimeError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "AlbomRuntimeError";
  }
}
